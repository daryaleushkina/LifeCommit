import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { stream } from 'hono/streaming';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  autoStep,
  FREE_TASK_LIMIT,
  type ArchivedTask,
  type HeatDay,
  type TaskInput,
  type TaskKind,
  type TaskTemplate,
  type Todo,
  type TodoDetails,
  type TodoInput,
  sortTodos,
  type TodayResponse,
  type UserSettings,
  VOICE_DAILY_LIMIT,
  type VoiceAction,
  type VoiceEvent,
} from '../shared/types';
import type { TaskHistory } from '../shared/stats';
import { summarize, type SummaryLog, type SummaryTask } from '../shared/summary';
import { cleanText } from '../shared/text';
import { requireTelegram, type AuthVars } from './auth';
import { addDays, isValidTimeZone, logicalDay, weekStart } from './day';
import { byTelegram, db, type Env } from './env';
import { MAX_HABITS, MAX_TODOS, transcribe } from './voice';
import { routeVoice, voiceGroups } from './voiceRoute';
import { occurrences, parseRRule } from '../shared/rrule';
import { confirmGoogle, connectApple, deleteRemote, disconnect, moveOwnEvents, pullAccount, pushTodo, retimeCalendars, type AccountRow } from './calsync';
import { DavError, isAuthError } from './caldav';
import { authUrl } from './gcal';
import { signState } from './secret';
import { groups, groupsRange, groupsToday, handOver } from './groups';
import { shareApi } from './share';
import { toTodayTasks, type ScreenLog, type TaskRow, type TodayRow } from './habits';
import { friends } from './friends';

export type App = { Bindings: Env; Variables: AuthVars & { sb: SupabaseClient; user: UserRow } };

export interface UserRow {
  id: number;
  first_name: string;
  username: string | null;
  photo_url: string | null;
  language_code: string;
  timezone: string;
  day_start_hour: number;
  remind_morning: string | null;
  remind_evening: string | null;
  bot_chat_ok: boolean;
  premium_until: string | null;
}


export const USER_COLS =
  'id, first_name, username, photo_url, language_code, timezone, day_start_hour, remind_morning, remind_evening, bot_chat_ok, premium_until';
const TASK_COLS = 'id, title, emoji, kind, unit, step, schedule, weekdays, per_week, visibility, challenge_id, position, last_slip_on';

export const isPremium = (u: UserRow) => u.premium_until !== null && new Date(u.premium_until) > new Date();
/** Сегодняшний логический день человека (день кончается в day_start_hour). */
export const today = (u: UserRow) => logicalDay(u.timezone, u.day_start_hour);

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new HTTPException(500, { message: res.error.message });
  return res.data as T;
}

function toSettings(u: UserRow): UserSettings {
  return {
    id: u.id,
    first_name: u.first_name,
    username: u.username,
    photo_url: u.photo_url,
    language_code: u.language_code,
    timezone: u.timezone,
    day_start_hour: u.day_start_hour,
    remind_morning: u.remind_morning?.slice(0, 5) ?? null,
    remind_evening: u.remind_evening?.slice(0, 5) ?? null,
    bot_chat_ok: u.bot_chat_ok,
    premium: isPremium(u),
  };
}

export const api = new Hono<App>();

api.use('*', requireTelegram);
api.use('*', async (c, next) => {
  c.set('sb', db(c.env));
  await next();
});

// Сессия: создаёт/обновляет пользователя по проверенной initData. Вызывается первым.
api.post('/session', async (c) => {
  const tgUser = c.get('tgUser');
  const body = await c.req.json<{ timezone?: string }>().catch(() => ({}) as { timezone?: string });
  const sb = c.get('sb');

  const existing = must(await sb.from('users').select(USER_COLS).or(byTelegram(tgUser.id)).limit(1).maybeSingle<UserRow>());
  // Часовой пояс — всегда пояс телефона: человек уехал — дни и время дел живут по-новому.
  const tz = body.timezone && isValidTimeZone(body.timezone) ? body.timezone : undefined;
  // Вошли со связанного аккаунта (другой Telegram того же человека): профиль остаётся от основного.
  if (existing && existing.id !== tgUser.id) {
    const user = must(await sb.from('users').update({ last_seen_at: new Date().toISOString(), ...(tz && { timezone: tz }) }).eq('id', existing.id).select(USER_COLS).single<UserRow>());
    if (tz && tz !== existing.timezone) await retimeCalendars(sb, user.id);
    return c.json({ user: toSettings(user), start_param: c.get('startParam') ?? null, is_new: false });
  }
  const profile = {
    id: tgUser.id,
    first_name: cleanText(tgUser.first_name ?? '', 64),
    last_name: cleanText(tgUser.last_name ?? '', 64) || null,
    username: tgUser.username ?? null,
    photo_url: tgUser.photo_url ?? null,
    last_seen_at: new Date().toISOString(),
  };
  const fresh = existing
    ? { ...profile, ...(tz && { timezone: tz }) }
    : { ...profile, language_code: tgUser.language_code?.startsWith('ru') ? 'ru' : 'en', ...(tz && { timezone: tz }) };

  const user = must(await sb.from('users').upsert(fresh).select(USER_COLS).single<UserRow>());
  if (existing && tz && tz !== existing.timezone) await retimeCalendars(sb, user.id);
  return c.json({ user: toSettings(user), start_param: c.get('startParam') ?? null, is_new: !existing });
});

// Всё ниже — только для уже созданного пользователя.
api.use('*', async (c, next) => {
  const user = must(
    await c.get('sb').from('users').select(USER_COLS).or(byTelegram(c.get('tgUser').id)).limit(1).maybeSingle<UserRow>(),
  );
  if (!user) throw new HTTPException(401, { message: 'no_session' });
  c.set('user', user);
  await next();
});

api.get('/templates', async (c) => {
  const lang = c.get('user').language_code === 'ru' ? 'ru' : 'en';
  // Вида «Лимит» в приложении больше нет (такую привычку не создать) — его шаблон не предлагаем.
  const rows = must(await c.get('sb').from('task_templates').select('*').neq('kind', 'limit').order('position'));
  const templates: TaskTemplate[] = (rows as Record<string, unknown>[]).map((r) => ({
    slug: r.slug as string,
    emoji: r.emoji as string,
    title: r[`title_${lang}`] as string,
    kind: r.kind as TaskKind,
    unit: (r[`unit_${lang}`] as string | null) ?? null,
    target: Number(r.target),
    subtasks: r[`subtasks_${lang}`] as string[],
  }));
  return c.json(templates);
});

api.get('/today', async (c) => c.json(await loadToday(c.get('sb'), c.get('user'))));


async function loadToday(sb: SupabaseClient, user: UserRow): Promise<TodayResponse> {
  const day = today(user);
  // Весь экран — один запрос к базе (в Франкфурт), а не три круга подряд.
  const [screenRes, groupBlocks] = await Promise.all([sb.rpc('today_screen', { p_user: user.id, p_day: day, p_from: weekStart(day) }), groupsToday(sb, user, day)]);
  const screen = must(screenRes) as {
    tasks: TodayRow[];
    archived: ArchivedTask[];
    logs: ScreenLog[];
    todos: (Omit<TodoRow, 'rrule' | 'exdates'> & { done: boolean })[];
    todos_recurring: (TodoRow & { done: boolean })[];
    todos_later: number;
  };
  const { tasks, archived, logs: logRows } = screen;
  const result = toTodayTasks(tasks, logRows, day);

  const personal = tasks.filter((t) => t.challenge_id === null).length;
  return {
    day,
    tasks: result,
    archived,
    limits: { max_tasks: isPremium(user) ? null : FREE_TASK_LIMIT, active: personal },
    // Несделанные со временем — по часам, потом без времени (переехавшие — первыми), сделанные — вниз.
    todos: sortTodos([
      ...screen.todos.map((r) => asTodo(r, r.day, r.done, false)),
      ...expandRecurring(screen.todos_recurring, day, day, new Set(screen.todos_recurring.filter((r) => r.done).map((r) => `${r.id}:${day}`))),
    ]),
    todos_later: Number(screen.todos_later),
    groups: groupBlocks,
  };
}

/** Дата последнего срыва: не позже сегодняшнего логического дня. */
function cleanSlipDate(value: string | null | undefined, day: string): string | null {
  if (!value) return null;
  if (!isDay(value)) throw new HTTPException(400, { message: 'bad_date' });
  return value > day ? day : value;
}

/** Значение из известного списка; другое — 400 (а не 500 от проверки в базе). */
function known<T extends string>(value: T, list: readonly string[], error: string): T {
  if (!list.includes(value)) throw new HTTPException(400, { message: error });
  return value;
}
const SCHEDULES = ['daily', 'weekdays', 'per_week'];
const VISIBILITIES = ['private', 'friends'];

function cleanTask(input: TaskInput, day: string) {
  const title = cleanText(String(input.title ?? ''), 80);
  if (!title) throw new HTTPException(400, { message: 'title_required' });
  if (!['count', 'check', 'abstain'].includes(input.kind)) throw new HTTPException(400, { message: 'bad_kind' });
  const binary = input.kind === 'check' || input.kind === 'abstain';
  const target = binary ? 1 : Number(input.target);
  if (!(target > 0)) throw new HTTPException(400, { message: 'bad_target' });
  const schedule = known(input.schedule ?? 'daily', SCHEDULES, 'bad_schedule');
  return {
    row: {
      title,
      emoji: input.emoji?.slice(0, 16) || null,
      kind: input.kind,
      unit: binary ? null : cleanText(input.unit ?? '', 20) || null,
      step: binary ? 1 : autoStep(target),
      schedule,
      weekdays: schedule === 'weekdays' ? Math.min(127, Math.max(1, input.weekdays ?? 127)) : 127,
      per_week: schedule === 'per_week' ? Math.min(7, Math.max(1, input.per_week ?? 3)) : null,
      visibility: known(input.visibility ?? 'private', VISIBILITIES, 'bad_visibility'),
      last_slip_on: input.kind === 'abstain' ? cleanSlipDate(input.last_slip_on, day) : null,
    },
    target,
    subtasks: (input.subtasks ?? []).map((s) => cleanText(s, 80)).filter(Boolean).slice(0, 20),
  };
}

export async function countActive(sb: SupabaseClient, user: UserRow): Promise<number> {
  const { count, error } = await sb
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('archived_at', null)
    .is('challenge_id', null);
  if (error) throw new HTTPException(500, { message: error.message });
  return count ?? 0;
}

/** Взять попытку из дневного лимита голосовых разборов. false — на сегодня кончились. */
export async function takeVoiceQuota(sb: SupabaseClient, userId: number): Promise<boolean> {
  return must(await sb.rpc('take_voice_quota', { p_user: userId, p_limit: VOICE_DAILY_LIMIT })) as boolean;
}

async function assertCanAdd(sb: SupabaseClient, user: UserRow, adding: number) {
  if (FREE_TASK_LIMIT === null || isPremium(user)) return;
  if ((await countActive(sb, user)) + adding > FREE_TASK_LIMIT) throw new HTTPException(402, { message: 'task_limit' });
}

export async function insertTasks(sb: SupabaseClient, user: UserRow, inputs: TaskInput[]) {
  const day = today(user);
  const cleaned = inputs.map((input) => cleanTask(input, day));
  const created = must(
    await sb
      .from('tasks')
      .insert(cleaned.map((t, i) => ({ ...t.row, user_id: user.id, position: (Date.now() % 1e9) + i })))
      .select('id'),
  ) as { id: number }[];
  await Promise.all([
    sb.from('task_goals').insert(created.map((t, i) => ({ task_id: t.id, effective_from: day, target: cleaned[i]!.target }))),
    sb.from('task_subtasks').insert(
      created.flatMap((t, i) => cleaned[i]!.subtasks.map((title, position) => ({ task_id: t.id, title, position }))),
    ),
  ]).then((rs) => rs.forEach(must));
  return created.map((t) => t.id);
}

api.post('/tasks', async (c) => {
  const input = await c.req.json<TaskInput>();
  await assertCanAdd(c.get('sb'), c.get('user'), 1);
  const [id] = await insertTasks(c.get('sb'), c.get('user'), [input]);
  return c.json({ id }, 201);
});

// Несколько привычек сразу — из голосового разбора. Лимит бесплатных проверяется на всю пачку.
api.post('/tasks/batch', async (c) => {
  const { tasks } = await c.req.json<{ tasks: TaskInput[] }>();
  const list = (Array.isArray(tasks) ? tasks : []).slice(0, MAX_HABITS);
  if (!list.length) throw new HTTPException(400, { message: 'no_tasks' });
  await assertCanAdd(c.get('sb'), c.get('user'), list.length);
  const ids = await insertTasks(c.get('sb'), c.get('user'), list);
  return c.json({ ids }, 201);
});

/** Больше не принимаем: 90 секунд речи в любом из форматов браузеров заметно меньше. */
const MAX_AUDIO_BYTES = 3_000_000;

// Голос в мини-аппе: запись → расслышанная фраза → список действий. В базу ничего не пишет —
// человек сначала смотрит список и только потом добавляет (POST /tasks/batch).
// Ответ построчный (NDJSON): фраза приходит сразу после распознавания, пока модель ещё разбирает её.
api.post('/voice', async (c) => {
  const user = c.get('user');
  const audio = await c.req.arrayBuffer();
  if (audio.byteLength === 0) throw new HTTPException(400, { message: 'no_audio' });
  if (audio.byteLength > MAX_AUDIO_BYTES) throw new HTTPException(413, { message: 'too_long' });
  if (!(await takeVoiceQuota(c.get('sb'), user.id))) throw new HTTPException(429, { message: 'voice_limit' });

  const lang = user.language_code === 'en' ? 'en' : 'ru';
  // Микрофон нажали на экране группы — сказанное без названия группы скорее всего для неё.
  const screenGroup = Number(c.req.query('group')) || null;
  c.header('content-type', 'application/x-ndjson; charset=utf-8');
  return stream(c, async (out) => {
    const send = (event: VoiceEvent) => out.write(`${JSON.stringify(event)}\n`);
    try {
      const text = await transcribe(c.env, audio, lang);
      await send({ text });
      // Себе или в группу (и кому в ней) — решает worker/voiceRoute.ts.
      const parsed = text ? await routeVoice(c.env, text, today(user), user.id, await voiceGroups(c.get('sb'), user.id), screenGroup) : { habits: [], todos: [], groups: [], by: 'none' };
      // Ничего не нашли — в лог фразу, чтобы потом разобрать почему (02.10.2026: голосовое «не распозналось»).
      if (!parsed.habits.length && !parsed.todos.length && !parsed.groups.length) console.warn('voice: nothing parsed', { bytes: audio.byteLength, chars: text.length, by: parsed.by, text: text.slice(0, 400) });
      await send({
        actions: [
          ...parsed.groups.flatMap((g) => g.items.map(({ names, ...item }): VoiceAction => ({ type: 'create_group_item', group: g.group, item, names }))),
          ...parsed.todos.map((todo): VoiceAction => ({ type: 'create_todo', todo })),
          ...parsed.habits.map((habit): VoiceAction => ({ type: 'create_habit', habit })),
        ],
      });
    } catch (e) {
      console.error('voice parse failed', e);
      await send({ error: 'failed' });
    }
  });
});

/** Дальше этого дело не планируем: почти наверняка ошибка в дате. */
const TODO_MAX_DAYS_AHEAD = 366;
/** Сколько дней можно запросить для вкладки «Календарь» за раз (месяц с хвостами недель). */
const CALENDAR_MAX_DAYS = 62;

/** id из адреса: не целое положительное — 404 (иначе база ответит ошибкой разбора, и было бы 500). */
function idOf(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(404, { message: 'not_found' });
  return id;
}

/** YYYY-MM-DD, и такой день есть в календаре: «30 февраля» V8 молча считает 2 марта, а база его не примет (500). */
const isDay = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};

/** Дата дела: не раньше сегодня и не позже чем через год; нет или битая — сегодня. */
function todoDay(value: string | null | undefined, today: string): string {
  if (!isDay(value) || value < today) return today;
  const last = addDays(today, TODO_MAX_DAYS_AHEAD);
  return value > last ? last : value;
}

/** «HH:MM» или null; всё остальное — ошибка запроса. */
function todoTime(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new HTTPException(400, { message: 'bad_time' });
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

function cleanTodo(input: TodoInput, today: string) {
  const title = cleanText(String(input.title ?? ''), 120);
  if (!title) throw new HTTPException(400, { message: 'title_required' });
  const d = Number(input.duration_min);
  const location = cleanLocation(input.location);
  return { title, day: todoDay(input.day, today), time: todoTime(input.time), duration_min: d > 0 && d <= 20160 ? Math.round(d) : null, details: location ? { location } : null };
}

const cleanLocation = (v: unknown) => (typeof v === 'string' ? cleanText(v, 200) : '');

export async function insertTodos(sb: SupabaseClient, user: UserRow, inputs: TodoInput[]): Promise<number[]> {
  const day = today(user);
  const rows = inputs.slice(0, MAX_TODOS).map((input, i) => ({ ...cleanTodo(input, day), user_id: user.id, position: (Date.now() % 1e9) + i }));
  if (!rows.length) return [];
  return (must(await sb.from('todos').insert(rows).select('id')) as { id: number }[]).map((r) => r.id);
}

/** Строка `todos` из базы — как её читают экраны. */
interface TodoRow {
  id: number;
  title: string;
  day: string;
  done_on?: string | null;
  time: string | null;
  duration_min: number | null;
  rrule: string | null;
  exdates: string[] | null;
  source: Todo['source'];
  details: TodoDetails | null;
}
const TODO_COLS = 'id, title, day, done_on, time, duration_min, rrule, exdates, source, details';
const hm = (t: string | null) => (t ? t.slice(0, 5) : null);

const asTodo = (r: Omit<TodoRow, 'rrule' | 'exdates'>, day: string, done: boolean, recurring: boolean): Todo => ({
  id: r.id,
  title: r.title,
  day,
  done,
  time: hm(r.time),
  duration_min: r.duration_min,
  recurring,
  source: r.source,
  details: r.details ?? null,
});

/** Повторяющиеся дела → их разы в промежутке дней; правило, которое не поняли, — один раз в день начала. */
function expandRecurring(rows: TodoRow[], from: string, to: string, doneDays: Set<string>): Todo[] {
  const out: Todo[] = [];
  for (const r of rows) {
    const rule = r.rrule ? parseRRule(r.rrule) : null;
    const days = rule ? occurrences(rule, r.day, from, to, r.exdates ?? []) : r.day >= from && r.day <= to ? [r.day] : [];
    for (const d of days) out.push(asTodo(r, d, doneDays.has(`${r.id}:${d}`), true));
  }
  return out;
}

// Разовые дела. Лимита нет (решение 01.10.2026).
/** Дела поменялись — в фоне отправляем в подключённый календарь (ответ человеку не ждёт). */
function pushLater(c: Context<App>, ids: number[]) {
  const { sb, user } = { sb: c.get('sb'), user: c.get('user') };
  c.executionCtx.waitUntil((async () => {
    for (const id of ids) await pushTodo(c.env, sb, user, id);
  })().catch((e) => console.error('push failed', e)));
}

api.post('/todos', async (c) => {
  const [id] = await insertTodos(c.get('sb'), c.get('user'), [await c.req.json<TodoInput>()]);
  if (id) pushLater(c, [id]);
  return c.json({ id }, 201);
});

api.post('/todos/batch', async (c) => {
  const { todos } = await c.req.json<{ todos: TodoInput[] }>();
  if (!Array.isArray(todos) || !todos.length) throw new HTTPException(400, { message: 'no_todos' });
  const ids = await insertTodos(c.get('sb'), c.get('user'), todos);
  pushLater(c, ids);
  return c.json({ ids }, 201);
});

// Правка: название, дата, время, «сделано». У повторяющегося дела «сделано» ставится на конкретный день (on);
// у разового — на сегодняшний логический день.
api.patch('/todos/:id', async (c) => {
  const id = idOf(c.req.param('id'));
  const user = c.get('user');
  const sb = c.get('sb');
  const body = await c.req.json<{ title?: string; day?: string; time?: string | null; done?: boolean; on?: string; location?: string | null; hidden?: boolean }>();
  const day = today(user);
  const todo = must(await sb.from('todos').select('id, rrule, source, details').eq('id', id).eq('user_id', user.id).maybeSingle<{ id: number; rrule: string | null; source: Todo['source']; details: TodoDetails | null }>());
  if (!todo) throw new HTTPException(404, { message: 'not_found' });
  // События из календаря не отмечают: это «что сегодня будет», а не дело.
  if (body.done !== undefined && todo.source) throw new HTTPException(400, { message: 'event_not_checkable' });

  if (body.done !== undefined && todo.rrule) {
    const on = isDay(body.on) ? body.on : day;
    must(
      body.done
        ? await sb.from('todo_done').upsert({ todo_id: id, day: on, user_id: user.id })
        : await sb.from('todo_done').delete().eq('todo_id', id).eq('day', on),
    );
  }
  const fields: Record<string, unknown> = {};
  if (body.title !== undefined) fields.title = cleanTodo({ title: body.title }, day).title;
  // У повторяющегося дела день начала не двигаем: он задаёт, в какие дни оно бывает.
  if (body.day !== undefined && !todo.rrule) fields.day = todoDay(body.day, day);
  if (body.time !== undefined) fields.time = todoTime(body.time);
  if (body.done !== undefined && !todo.rrule) fields.done_on = body.done ? day : null;
  // «Скрыть» свайпом — только у событий из календаря (своё дело удаляют, а не прячут).
  if (body.hidden !== undefined && todo.source) fields.hidden = body.hidden === true;
  // Место правится только у своих дел: у событий из календаря его меняют в самом календаре.
  if (body.location !== undefined && !todo.source) {
    const { location: _old, ...rest } = todo.details ?? {};
    const location = cleanLocation(body.location);
    const next = location ? { ...rest, location } : rest;
    fields.details = Object.keys(next).length ? next : null;
  }
  if (Object.keys(fields).length) must(await sb.from('todos').update(fields).eq('id', id).eq('user_id', user.id));
  // «Сделано» в календарь не уходит; название, день и время — уходят.
  if (fields.title !== undefined || fields.day !== undefined || fields.time !== undefined || fields.details !== undefined) pushLater(c, [id]);
  return c.json({ ok: true });
});

api.delete('/todos/:id', async (c) => {
  const id = idOf(c.req.param('id'));
  const user = c.get('user');
  const sb = c.get('sb');
  // Связь с событием читаем до удаления: потом её уже не будет.
  const row = must(await sb.from('todos').select('external_href').eq('id', id).eq('user_id', user.id).maybeSingle<{ external_href: string | null }>());
  must(await sb.from('todos').delete().eq('id', id).eq('user_id', user.id));
  if (row?.external_href) c.executionCtx.waitUntil(deleteRemote(c.env, sb, user.id, row));
  return c.json({ ok: true });
});

// ── Подключённые календари ──

interface CalendarInfo {
  id: number;
  provider: 'apple' | 'google';
  login: string;
  status: AccountRow['status'];
  last_sync_at: string | null;
  /** Куда пишем наши дела. */
  default_url: string | null;
  collections: { url: string; name: string; color: string | null; enabled: boolean; writable: boolean }[];
}

api.get('/calendars', async (c) => {
  const sb = c.get('sb');
  const accounts = must(await sb.from('calendar_accounts').select('id, provider, login, status, last_sync_at, default_url').eq('user_id', c.get('user').id).order('created_at')) as Omit<CalendarInfo, 'collections'>[];
  const cols = accounts.length
    ? (must(await sb.from('calendar_collections').select('account_id, url, name, color, enabled, writable').in('account_id', accounts.map((a) => a.id)).order('name')) as (CalendarInfo['collections'][number] & { account_id: number })[])
    : [];
  return c.json(accounts.map((a): CalendarInfo => ({ ...a, collections: cols.filter((x) => x.account_id === a.id).map(({ account_id: _a, ...rest }) => rest) })));
});

// Адрес входа Google — заранее, пока открыта шторка: ссылку надо открыть прямо из нажатия,
// иначе Telegram на iOS не считает её ответом на жест и не откроет.
api.get('/calendars/google/url', async (c) => {
  if (!c.env.CALENDAR_KEY || !c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) throw new HTTPException(503, { message: 'calendar_unavailable' });
  const redirect = `${new URL(c.req.url).origin}/google/callback`;
  return c.json({ url: authUrl(c.env, redirect, await signState(c.env.CALENDAR_KEY, c.get('user').id)) });
});

// Google подключён, человек выбрал календари — забираем события.
api.post('/calendars/:id/confirm', async (c) => {
  const sb = c.get('sb');
  const user = c.get('user');
  const acc = must(await sb.from('calendar_accounts').select('*').eq('id', Number(c.req.param('id'))).eq('user_id', user.id).maybeSingle()) as AccountRow | null;
  if (!acc) throw new HTTPException(404, { message: 'not_found' });
  if (acc.status !== 'setup') return c.json({ ok: true });
  try {
    await confirmGoogle(c.env, sb, user, acc);
  } catch {
    throw new HTTPException(502, { message: 'google_unreachable' });
  }
  return c.json({ ok: true });
});

// Подключить Apple: Apple ID и пароль приложения (не основной пароль!).
api.post('/calendars/apple', async (c) => {
  if (!c.env.CALENDAR_KEY) throw new HTTPException(503, { message: 'calendar_unavailable' });
  const { login, password } = await c.req.json<{ login?: string; password?: string }>();
  if (!login?.includes('@') || !password || password.replace(/[\s-]/g, '').length < 12) throw new HTTPException(400, { message: 'apple_bad_input' });
  try {
    await connectApple(c.env, c.get('sb'), c.get('user'), login, password);
  } catch (e) {
    if (isAuthError(e)) throw new HTTPException(401, { message: 'apple_auth' });
    if (e instanceof DavError || e instanceof TypeError) throw new HTTPException(502, { message: 'apple_unreachable' });
    throw e;
  }
  return c.json({ ok: true }, 201);
});

api.patch('/calendars/:id/collections', async (c) => {
  const id = Number(c.req.param('id'));
  const { url, enabled } = await c.req.json<{ url: string; enabled: boolean }>();
  const sb = c.get('sb');
  const acc = must(await sb.from('calendar_accounts').select('id').eq('id', id).eq('user_id', c.get('user').id).maybeSingle());
  if (!acc) throw new HTTPException(404, { message: 'not_found' });
  // Выключили календарь — его дела убираем; включили — заберём заново с нуля.
  must(await sb.from('calendar_collections').update({ enabled: Boolean(enabled), sync_token: null }).eq('account_id', id).eq('url', url));
  if (!enabled) must(await sb.from('todos').delete().eq('user_id', c.get('user').id).eq('calendar_url', url).not('source', 'is', null));
  return c.json({ ok: true });
});

// Куда писать наши дела: выбрал сам человек — переносим уже выгруженные и дальше не двигаем.
api.patch('/calendars/:id/default', async (c) => {
  const id = Number(c.req.param('id'));
  const { url } = await c.req.json<{ url: string }>();
  const sb = c.get('sb');
  const user = c.get('user');
  const acc = must(await sb.from('calendar_accounts').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()) as AccountRow | null;
  if (!acc) throw new HTTPException(404, { message: 'not_found' });
  const known = must(await sb.from('calendar_collections').select('url').eq('account_id', id).eq('url', url).eq('writable', true).maybeSingle());
  if (!known) throw new HTTPException(400, { message: 'unknown_calendar' });
  await moveOwnEvents(c.env, sb, user, acc, url, true);
  return c.json({ ok: true });
});

api.delete('/calendars/:provider', async (c) => {
  const provider = c.req.param('provider');
  if (provider !== 'apple' && provider !== 'google') throw new HTTPException(400, { message: 'bad_provider' });
  await disconnect(c.env, c.get('sb'), c.get('user').id, provider);
  return c.json({ ok: true });
});

// Забрать изменения из календарей сейчас (открыли вкладку, нажали «обновить»). Чаще раза в минуту не ходим.
api.post('/calendars/sync', async (c) => {
  const sb = c.get('sb');
  const user = c.get('user');
  const accounts = must(await sb.from('calendar_accounts').select('*').eq('user_id', user.id).eq('status', 'ok')) as AccountRow[];
  const fresh = (a: AccountRow) => a.last_sync_at && Date.now() - Date.parse(a.last_sync_at) < 60_000;
  const results = await Promise.allSettled(accounts.filter((a) => !fresh(a)).map((a) => pullAccount(c.env, sb, user, a)));
  return c.json({ ok: results.every((r) => r.status === 'fulfilled') });
});

// Запланированные на потом — список открывают редко, поэтому отдельным запросом.
api.get('/todos/later', async (c) => {
  const user = c.get('user');
  const rows = must(
    await c.get('sb').from('todos').select(TODO_COLS).eq('user_id', user.id).eq('hidden', false).is('done_on', null).is('rrule', null).gt('day', today(user)).order('day').order('position').order('id'),
  ) as TodoRow[];
  return c.json(rows.map((r) => asTodo(r, r.day, false, false)));
});

// Вкладка «Календарь»: дела по дням в промежутке. Разовые — в свой день (сделанные тоже),
// повторяющиеся — в каждый день, когда они бывают, со своей отметкой «сделано».
api.get('/calendar', async (c) => {
  const user = c.get('user');
  const sb = c.get('sb');
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!isDay(from) || !isDay(to) || to < from || Date.parse(to) - Date.parse(from) > CALENDAR_MAX_DAYS * 86_400_000) {
    throw new HTTPException(400, { message: 'bad_range' });
  }
  const [oneOff, recurring, done, groupDays] = await Promise.all([
    sb.from('todos').select(TODO_COLS).eq('user_id', user.id).eq('hidden', false).is('rrule', null).gte('day', from).lte('day', to).order('position').order('id'),
    sb.from('todos').select(TODO_COLS).eq('user_id', user.id).eq('hidden', false).not('rrule', 'is', null).lte('day', to),
    sb.from('todo_done').select('todo_id, day').eq('user_id', user.id).gte('day', from).lte('day', to),
    // Дела групп, которые касаются меня, — в те же дни.
    groupsRange(sb, user, from, to, { mine: true }),
  ]);
  const doneDays = new Set((must(done) as { todo_id: number; day: string }[]).map((x) => `${x.todo_id}:${x.day}`));
  const todos = [
    ...(must(oneOff) as TodoRow[]).map((r) => asTodo(r, r.day, r.done_on != null, false)),
    ...expandRecurring(must(recurring) as TodoRow[], from, to, doneDays),
  ];
  return c.json({ today: today(user), todos, groups: groupDays });
});

// Онбординг: выбор из шаблонов.
api.post('/tasks/from-templates', async (c) => {
  const { slugs } = await c.req.json<{ slugs: string[] }>();
  const user = c.get('user');
  const sb = c.get('sb');
  const picked = [...new Set(slugs ?? [])].slice(0, 12);
  if (!picked.length) throw new HTTPException(400, { message: 'no_templates' });
  await assertCanAdd(sb, user, picked.length);
  const lang = user.language_code === 'ru' ? 'ru' : 'en';
  const rows = must(await sb.from('task_templates').select('*').in('slug', picked).neq('kind', 'limit')) as Record<string, unknown>[];
  const ids = await insertTasks(
    sb,
    user,
    rows.map((r) => ({
      title: r[`title_${lang}`] as string,
      emoji: r.emoji as string,
      kind: r.kind as TaskKind,
      unit: r[`unit_${lang}`] as string | null,
      target: Number(r.target),
      subtasks: r[`subtasks_${lang}`] as string[],
    })),
  );
  return c.json({ ids }, 201);
});

// Правка задачи. Цель: «сложнее» — сразу сегодня, «легче» — с завтрашнего дня
// (защита от накрутки рейтинга снижением цели вечером).
api.patch('/tasks/:id', async (c) => {
  const id = idOf(c.req.param('id'));
  const user = c.get('user');
  const sb = c.get('sb');
  const patch = await c.req.json<Partial<TaskInput>>();
  const task = must(await sb.from('tasks').select(TASK_COLS).eq('id', id).eq('user_id', user.id).maybeSingle<TaskRow>());
  if (!task) throw new HTTPException(404, { message: 'not_found' });

  const fields: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = cleanText(patch.title, 80);
    if (!title) throw new HTTPException(400, { message: 'title_required' });
    fields.title = title;
  }
  if (patch.emoji !== undefined) fields.emoji = patch.emoji?.slice(0, 16) || null;
  if (patch.unit !== undefined) fields.unit = cleanText(patch.unit ?? '', 20) || null;
  if (patch.visibility !== undefined) fields.visibility = known(patch.visibility, VISIBILITIES, 'bad_visibility');
  if (patch.last_slip_on !== undefined && task.kind === 'abstain') fields.last_slip_on = cleanSlipDate(patch.last_slip_on, today(user));
  if (patch.schedule !== undefined) {
    fields.schedule = known(patch.schedule, SCHEDULES, 'bad_schedule');
    fields.weekdays = patch.schedule === 'weekdays' ? Math.min(127, Math.max(1, patch.weekdays ?? task.weekdays)) : 127;
    fields.per_week = patch.schedule === 'per_week' ? Math.min(7, Math.max(1, patch.per_week ?? task.per_week ?? 3)) : null;
  }

  let goalFrom: string | null = null;
  if (patch.target !== undefined && task.kind === 'count') {
    const target = Number(patch.target);
    if (!(target > 0)) throw new HTTPException(400, { message: 'bad_target' });
    const day = today(user);
    const current = must(await sb.rpc('goal_on', { p_task: id, p_day: day })) as { target: string }[];
    const cur = Number(current[0]?.target ?? 1);
    if (target !== cur) {
      const easier = target < cur;
      goalFrom = easier ? addDays(day, 1) : day;
      // Последнее решение главнее: отложенные на будущее цели больше не нужны.
      must(await sb.from('task_goals').delete().eq('task_id', id).gt('effective_from', goalFrom));
      must(await sb.from('task_goals').upsert({ task_id: id, effective_from: goalFrom, target }));
      fields.step = autoStep(target);
    }
  }
  if (Object.keys(fields).length) must(await sb.from('tasks').update(fields).eq('id', id));
  return c.json({ ok: true, goal_effective_from: goalFrom });
});

// «Отложить» = архив: дело пропадает из «Сегодня», история остаётся на карте.
api.post('/tasks/:id/archive', async (c) => {
  const id = idOf(c.req.param('id'));
  must(
    await c.get('sb').from('tasks').update({ archived_at: new Date().toISOString() }).eq('id', id).eq('user_id', c.get('user').id),
  );
  return c.json({ ok: true });
});

api.post('/tasks/:id/restore', async (c) => {
  const id = idOf(c.req.param('id'));
  const user = c.get('user');
  const sb = c.get('sb');
  await assertCanAdd(sb, user, 1);
  must(await sb.from('tasks').update({ archived_at: null }).eq('id', id).eq('user_id', user.id));
  return c.json({ ok: true });
});

// Удалить совсем, вместе с историей: из редактора дела или из отложенных.
api.delete('/tasks/:id', async (c) => {
  const id = idOf(c.req.param('id'));
  must(
    await c.get('sb').from('tasks').delete().eq('id', id).eq('user_id', c.get('user').id),
  );
  return c.json({ ok: true });
});

/** Задним числом отмечаем не дальше двух лет назад. */
const PAST_LOG_DAYS = 731;

// Отметка за сегодняшний логический день или задним числом (day — с экрана привычки). value — абсолютное значение.
api.put('/logs', async (c) => {
  const { task_id, value, status, day: dayIn } = await c.req.json<{ task_id: number; value?: number | null; status?: 'clean' | 'slip' | null; day?: string }>();
  const user = c.get('user');
  const sb = c.get('sb');
  const task = must(
    await sb.from('tasks').select('id, kind, last_slip_on').eq('id', task_id).eq('user_id', user.id).maybeSingle<{ id: number; kind: TaskKind; last_slip_on: string | null }>(),
  );
  if (!task) throw new HTTPException(404, { message: 'not_found' });
  const now = today(user);
  if (dayIn !== undefined && (!isDay(dayIn) || dayIn > now || dayIn < addDays(now, -PAST_LOG_DAYS))) throw new HTTPException(400, { message: 'bad_day' });
  const day = dayIn ?? now;
  // У отказа статус — «чисто», «срыв» или пусто; другое база отвергла бы с 500.
  if (task.kind === 'abstain' && status != null && status !== 'clean' && status !== 'slip') throw new HTTPException(400, { message: 'bad_status' });

  let clearing =
    task.kind === 'abstain' ? status == null : !(Number(value) > 0);
  // Отказ, день между «последним разом» и первым днём привычки: он и так чистый (его считает «последний раз»),
  // поэтому «чисто» там — убрать отметку, а не записать вторую.
  if (task.kind === 'abstain' && status === 'clean' && task.last_slip_on && day > task.last_slip_on) {
    const first = (must(await sb.from('task_goals').select('effective_from').eq('task_id', task_id).order('effective_from').limit(1).maybeSingle()) as { effective_from: string } | null)?.effective_from;
    if (first && day < first) clearing = true;
  }
  if (clearing) {
    must(await sb.from('task_logs').delete().eq('task_id', task_id).eq('day', day));
    return c.json({ ok: true });
  }
  const row =
    task.kind === 'abstain'
      ? { value: status === 'clean' ? 1 : 0, status }
      : { value: Math.min(Number(value), 1_000_000), status: null };
  must(await sb.from('task_logs').upsert({ task_id, day, user_id: user.id, ...row, updated_at: new Date().toISOString() }));
  return c.json({ ok: true });
});

// История одной привычки для её экрана: все отметки, история целей и первый день.
api.get('/tasks/:id/history', async (c) => {
  const id = idOf(c.req.param('id'));
  const user = c.get('user');
  const sb = c.get('sb');
  const task = must(await sb.from('tasks').select('id').eq('id', id).eq('user_id', user.id).maybeSingle<{ id: number }>());
  if (!task) throw new HTTPException(404, { message: 'not_found' });
  const day = today(user);
  const [goalRes, logRes] = await Promise.all([
    sb.from('task_goals').select('effective_from, target').eq('task_id', id).lte('effective_from', day).order('effective_from'),
    // Свежие первыми: если отметок станет больше лимита, обрежутся самые старые.
    sb.from('task_logs').select('day, value, status').eq('task_id', id).lte('day', day).order('day', { ascending: false }).limit(1000),
  ]);
  const goals = (must(goalRes) as { effective_from: string; target: string }[]).map((g) => ({ effective_from: g.effective_from, target: Number(g.target) }));
  const logs = (must(logRes) as { day: string; value: string; status: 'clean' | 'slip' | null }[]).map((l) => ({ day: l.day, value: Number(l.value), status: l.status }));
  const history: TaskHistory = { start: goals[0]?.effective_from ?? day, goals, logs: logs.reverse() };
  return c.json(history);
});

api.get('/heatmap', async (c) => {
  const user = c.get('user');
  // Не число — год (иначе addDays(NaN) падает с 500).
  const days = Math.min(Number(c.req.query('days') ?? 365) || 365, 371);
  const to = today(user);
  const rows = must(await c.get('sb').rpc('user_heatmap', { p_user: user.id, p_from: addDays(to, -days + 1), p_to: to })) as {
    day: string;
    score: string;
  }[];
  const heat: HeatDay[] = rows.map((r) => ({ day: r.day, score: Number(r.score) }));
  return c.json({ today: to, days: heat });
});

// Итог по всем привычкам за период (картинки «Поделиться», круг 23). Отметки берём порциями: больше 1000 строк
// за раз база не отдаёт, а за год у человека с десятком привычек их несколько тысяч.
api.get('/summary', async (c) => {
  const user = c.get('user');
  const sb = c.get('sb');
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  if (!isDay(from) || !isDay(to) || from > to || Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw new HTTPException(400, { message: 'bad_range' });
  const tasks = must(await sb.from('tasks').select('id, title, kind, unit').eq('user_id', user.id).order('position').order('id')) as SummaryTask[];
  const logs: SummaryLog[] = [];
  for (let page = 0; page < 20; page++) {
    const rows = must(
      await sb.from('task_logs').select('task_id, day, value, status').eq('user_id', user.id).gte('day', from).lte('day', to).order('day').order('task_id').range(page * 1000, page * 1000 + 999),
    ) as { task_id: number; day: string; value: string | number; status: SummaryLog['status'] }[];
    logs.push(...rows.map((r) => ({ ...r, value: Number(r.value) })));
    if (rows.length < 1000) break;
  }
  return c.json(summarize(tasks, logs));
});

api.get('/me', (c) => c.json(toSettings(c.get('user'))));

api.patch('/settings', async (c) => {
  const body = await c.req.json<Partial<UserSettings>>();
  // Время — настоящее «ЧЧ:ММ»: «25:00» база не примет (500).
  const time = (v: unknown) => (v === null ? null : typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined);
  const fields: Record<string, unknown> = {};
  if (body.language_code === 'ru' || body.language_code === 'en') fields.language_code = body.language_code;
  if (body.timezone && isValidTimeZone(body.timezone)) fields.timezone = body.timezone;
  if (body.day_start_hour !== undefined && Number.isFinite(Number(body.day_start_hour))) fields.day_start_hour = Math.min(12, Math.max(0, Math.floor(body.day_start_hour)));
  if (time(body.remind_morning) !== undefined) fields.remind_morning = time(body.remind_morning);
  if (time(body.remind_evening) !== undefined) fields.remind_evening = time(body.remind_evening);
  // Менять нечего — база на пустую правку не вернёт строку (и было бы 500): отдаём как есть.
  const user = Object.keys(fields).length
    ? must(await c.get('sb').from('users').update(fields).eq('id', c.get('user').id).select(USER_COLS).single<UserRow>())
    : c.get('user');
  return c.json(toSettings(user));
});

// Человек разрешил боту писать (requestWriteAccess в мини-аппе) — можно слать напоминания.
api.post('/write-access', async (c) => {
  must(await c.get('sb').from('users').update({ bot_chat_ok: true }).eq('id', c.get('user').id));
  return c.json({ ok: true });
});

// Полное удаление аккаунта: каскадом уходят задачи, отметки и связи.
api.delete('/account', async (c) => {
  // Со связанного аккаунта удалить общего пользователя нельзя — только с основного.
  if (c.get('user').id !== c.get('tgUser').id) throw new HTTPException(403, { message: 'linked_account' });
  // Свои группы — дальше участникам (или в архив), иначе они остаются без владельца и ломаются.
  const sb = c.get('sb');
  const owned = must(await sb.from('groups').select('id').eq('owner_id', c.get('user').id).is('archived_at', null)) as { id: number }[];
  for (const g of owned) await handOver(sb, g.id, c.get('user').id);
  must(await sb.from('users').delete().eq('id', c.get('user').id));
  return c.json({ ok: true });
});

// Группы: участники, приглашения, групповые дела (worker/groups.ts).
api.route('/', groups);
api.route('/', friends);
api.route('/', shareApi);
