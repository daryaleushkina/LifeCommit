import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  autoStep,
  cleanDaysBeforeStart,
  FREE_TASK_LIMIT,
  type ArchivedTask,
  type HeatDay,
  type TaskInput,
  type TaskKind,
  type TaskTemplate,
  type TodayResponse,
  type TodayTask,
  type UserSettings,
} from '../shared/types';
import { requireTelegram, type AuthVars } from './auth';
import { addDays, isValidTimeZone, logicalDay, weekdayIndex, weekStart } from './day';
import { db, type Env } from './env';

type App = { Bindings: Env; Variables: AuthVars & { sb: SupabaseClient; user: UserRow } };

interface UserRow {
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
  profile_mode: 'open' | 'closed';
  premium_until: string | null;
}

interface TaskRow {
  id: number;
  title: string;
  emoji: string | null;
  kind: TaskKind;
  unit: string | null;
  step: number;
  schedule: TodayTask['schedule'];
  weekdays: number;
  per_week: number | null;
  visibility: TodayTask['visibility'];
  challenge_id: number | null;
  position: number;
  last_slip_on: string | null;
}

const USER_COLS =
  'id, first_name, username, photo_url, language_code, timezone, day_start_hour, remind_morning, remind_evening, bot_chat_ok, profile_mode, premium_until';
const TASK_COLS = 'id, title, emoji, kind, unit, step, schedule, weekdays, per_week, visibility, challenge_id, position, last_slip_on';

const isPremium = (u: UserRow) => u.premium_until !== null && new Date(u.premium_until) > new Date();
const today = (u: UserRow) => logicalDay(u.timezone, u.day_start_hour);

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
    profile_mode: u.profile_mode,
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

  const existing = must(await sb.from('users').select(USER_COLS).eq('id', tgUser.id).maybeSingle<UserRow>());
  const profile = {
    id: tgUser.id,
    first_name: tgUser.first_name ?? '',
    last_name: tgUser.last_name ?? null,
    username: tgUser.username ?? null,
    photo_url: tgUser.photo_url ?? null,
    last_seen_at: new Date().toISOString(),
  };
  const tz = body.timezone && isValidTimeZone(body.timezone) ? body.timezone : undefined;
  const fresh = existing
    ? profile
    : { ...profile, language_code: tgUser.language_code?.startsWith('ru') ? 'ru' : 'en', ...(tz && { timezone: tz }) };

  const user = must(await sb.from('users').upsert(fresh).select(USER_COLS).single<UserRow>());
  return c.json({ user: toSettings(user), start_param: c.get('startParam') ?? null, is_new: !existing });
});

// Всё ниже — только для уже созданного пользователя.
api.use('*', async (c, next) => {
  const user = must(
    await c.get('sb').from('users').select(USER_COLS).eq('id', c.get('tgUser').id).maybeSingle<UserRow>(),
  );
  if (!user) throw new HTTPException(401, { message: 'no_session' });
  c.set('user', user);
  await next();
});

api.get('/templates', async (c) => {
  const lang = c.get('user').language_code === 'ru' ? 'ru' : 'en';
  const rows = must(await c.get('sb').from('task_templates').select('*').order('position'));
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
  const from = weekStart(day);
  const [taskRes, archivedRes] = await Promise.all([
    sb.from('tasks').select(TASK_COLS).eq('user_id', user.id).is('archived_at', null).order('position').order('id'),
    sb.from('tasks').select('id, title, emoji').eq('user_id', user.id).not('archived_at', 'is', null).order('archived_at', { ascending: false }),
  ]);
  const tasks = must(taskRes) as TaskRow[];
  const archived = must(archivedRes) as ArchivedTask[];
  const ids = tasks.map((t) => t.id);

  const empty = { data: [], error: null };
  const [goals, logs, subtasks] = await Promise.all([
    ids.length
      ? sb.from('task_goals').select('task_id, effective_from, target').in('task_id', ids).lte('effective_from', day).order('effective_from', { ascending: false })
      : empty,
    ids.length ? sb.from('task_logs').select('task_id, day, value, status').in('task_id', ids).gte('day', from).lte('day', day) : empty,
    ids.length ? sb.from('task_subtasks').select('id, task_id, title').in('task_id', ids).order('position') : empty,
  ]);

  const goalOf = new Map<number, number>();
  // Первый день дела = самая ранняя цель (цели идут от новых к старым).
  const startOf = new Map<number, string>();
  for (const g of must(goals) as { task_id: number; effective_from: string; target: string }[]) {
    if (!goalOf.has(g.task_id)) goalOf.set(g.task_id, Number(g.target));
    startOf.set(g.task_id, g.effective_from);
  }
  // «N дней без…»: чистые дни до сегодня считаем в базе — строк может быть больше одной страницы.
  const cleanBefore = new Map<number, number>();
  await Promise.all(
    tasks
      .filter((t) => t.kind === 'abstain')
      .map(async (t) => {
        const { count, error } = await sb
          .from('task_logs')
          .select('day', { count: 'exact', head: true })
          .eq('task_id', t.id)
          .eq('status', 'clean')
          .lt('day', day);
        if (error) throw new HTTPException(500, { message: error.message });
        cleanBefore.set(t.id, (count ?? 0) + cleanDaysBeforeStart(startOf.get(t.id) ?? day, t.last_slip_on));
      }),
  );
  const logRows = must(logs) as { task_id: number; day: string; value: string; status: 'clean' | 'slip' | null }[];
  const subRows = must(subtasks) as { id: number; task_id: number; title: string }[];

  const result: TodayTask[] = tasks.map((t) => {
    const todayLog = logRows.find((l) => l.task_id === t.id && l.day === day);
    const weekDone = logRows.filter(
      (l) => l.task_id === t.id && l.day !== day && (Number(l.value) > 0 || l.status === 'clean'),
    ).length;
    const due =
      t.schedule === 'daily' ||
      (t.schedule === 'weekdays' && (t.weekdays & (1 << weekdayIndex(day))) !== 0) ||
      (t.schedule === 'per_week' && (weekDone < (t.per_week ?? 7) || todayLog !== undefined));
    return {
      id: t.id,
      title: t.title,
      emoji: t.emoji,
      kind: t.kind,
      unit: t.unit,
      step: t.step,
      schedule: t.schedule,
      weekdays: t.weekdays,
      per_week: t.per_week,
      visibility: t.visibility,
      challenge_id: t.challenge_id,
      target: goalOf.get(t.id) ?? 1,
      value: todayLog ? Number(todayLog.value) : 0,
      logged: todayLog !== undefined,
      status: todayLog?.status ?? null,
      week_done: weekDone,
      due,
      subtasks: subRows.filter((s) => s.task_id === t.id).map(({ id, title }) => ({ id, title })),
      clean_before: cleanBefore.get(t.id) ?? 0,
      last_slip_on: t.last_slip_on,
    };
  });

  const personal = tasks.filter((t) => t.challenge_id === null).length;
  return {
    day,
    tasks: result,
    archived,
    limits: { max_tasks: isPremium(user) ? null : FREE_TASK_LIMIT, active: personal },
  };
}

/** Дата последнего срыва: не позже сегодняшнего логического дня. */
function cleanSlipDate(value: string | null | undefined, day: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HTTPException(400, { message: 'bad_date' });
  }
  return value > day ? day : value;
}

function cleanTask(input: TaskInput, day: string) {
  const title = String(input.title ?? '').trim().slice(0, 80);
  if (!title) throw new HTTPException(400, { message: 'title_required' });
  if (!['count', 'check', 'abstain'].includes(input.kind)) throw new HTTPException(400, { message: 'bad_kind' });
  const binary = input.kind === 'check' || input.kind === 'abstain';
  const target = binary ? 1 : Number(input.target);
  if (!(target > 0)) throw new HTTPException(400, { message: 'bad_target' });
  const schedule = input.schedule ?? 'daily';
  return {
    row: {
      title,
      emoji: input.emoji?.slice(0, 16) || null,
      kind: input.kind,
      unit: binary ? null : input.unit?.trim().slice(0, 20) || null,
      step: binary ? 1 : autoStep(target),
      schedule,
      weekdays: schedule === 'weekdays' ? Math.min(127, Math.max(1, input.weekdays ?? 127)) : 127,
      per_week: schedule === 'per_week' ? Math.min(7, Math.max(1, input.per_week ?? 3)) : null,
      visibility: input.visibility ?? 'private',
      last_slip_on: input.kind === 'abstain' ? cleanSlipDate(input.last_slip_on, day) : null,
    },
    target,
    subtasks: (input.subtasks ?? []).map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, 20),
  };
}

async function countActive(sb: SupabaseClient, user: UserRow): Promise<number> {
  const { count, error } = await sb
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('archived_at', null)
    .is('challenge_id', null);
  if (error) throw new HTTPException(500, { message: error.message });
  return count ?? 0;
}

async function assertCanAdd(sb: SupabaseClient, user: UserRow, adding: number) {
  if (isPremium(user)) return;
  if ((await countActive(sb, user)) + adding > FREE_TASK_LIMIT) throw new HTTPException(402, { message: 'task_limit' });
}

async function insertTasks(sb: SupabaseClient, user: UserRow, inputs: TaskInput[]) {
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

// Онбординг: выбор из шаблонов.
api.post('/tasks/from-templates', async (c) => {
  const { slugs } = await c.req.json<{ slugs: string[] }>();
  const user = c.get('user');
  const sb = c.get('sb');
  const picked = [...new Set(slugs ?? [])].slice(0, FREE_TASK_LIMIT);
  if (!picked.length) throw new HTTPException(400, { message: 'no_templates' });
  await assertCanAdd(sb, user, picked.length);
  const lang = user.language_code === 'ru' ? 'ru' : 'en';
  const rows = must(await sb.from('task_templates').select('*').in('slug', picked)) as Record<string, unknown>[];
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
  const id = Number(c.req.param('id'));
  const user = c.get('user');
  const sb = c.get('sb');
  const patch = await c.req.json<Partial<TaskInput>>();
  const task = must(await sb.from('tasks').select(TASK_COLS).eq('id', id).eq('user_id', user.id).maybeSingle<TaskRow>());
  if (!task) throw new HTTPException(404, { message: 'not_found' });

  const fields: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, 80);
    if (!title) throw new HTTPException(400, { message: 'title_required' });
    fields.title = title;
  }
  if (patch.emoji !== undefined) fields.emoji = patch.emoji?.slice(0, 16) || null;
  if (patch.unit !== undefined) fields.unit = patch.unit?.trim().slice(0, 20) || null;
  if (patch.visibility !== undefined) fields.visibility = patch.visibility;
  if (patch.last_slip_on !== undefined && task.kind === 'abstain') fields.last_slip_on = cleanSlipDate(patch.last_slip_on, today(user));
  if (patch.schedule !== undefined) {
    fields.schedule = patch.schedule;
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
  const id = Number(c.req.param('id'));
  must(
    await c.get('sb').from('tasks').update({ archived_at: new Date().toISOString() }).eq('id', id).eq('user_id', c.get('user').id),
  );
  return c.json({ ok: true });
});

api.post('/tasks/:id/restore', async (c) => {
  const id = Number(c.req.param('id'));
  const user = c.get('user');
  const sb = c.get('sb');
  await assertCanAdd(sb, user, 1);
  must(await sb.from('tasks').update({ archived_at: null }).eq('id', id).eq('user_id', user.id));
  return c.json({ ok: true });
});

// Удалить совсем, вместе с историей: из редактора дела или из отложенных.
api.delete('/tasks/:id', async (c) => {
  const id = Number(c.req.param('id'));
  must(
    await c.get('sb').from('tasks').delete().eq('id', id).eq('user_id', c.get('user').id),
  );
  return c.json({ ok: true });
});

// Отметка за сегодняшний логический день. value — абсолютное значение.
api.put('/logs', async (c) => {
  const { task_id, value, status } = await c.req.json<{ task_id: number; value?: number | null; status?: 'clean' | 'slip' | null }>();
  const user = c.get('user');
  const sb = c.get('sb');
  const task = must(
    await sb.from('tasks').select('id, kind').eq('id', task_id).eq('user_id', user.id).maybeSingle<{ id: number; kind: TaskKind }>(),
  );
  if (!task) throw new HTTPException(404, { message: 'not_found' });
  const day = today(user);

  const clearing =
    task.kind === 'abstain' ? status == null : !(Number(value) > 0);
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

api.get('/heatmap', async (c) => {
  const user = c.get('user');
  const days = Math.min(Number(c.req.query('days') ?? 365), 371);
  const to = today(user);
  const rows = must(await c.get('sb').rpc('user_heatmap', { p_user: user.id, p_from: addDays(to, -days + 1), p_to: to })) as {
    day: string;
    score: string;
  }[];
  const heat: HeatDay[] = rows.map((r) => ({ day: r.day, score: Number(r.score) }));
  return c.json({ today: to, days: heat });
});

api.get('/me', (c) => c.json(toSettings(c.get('user'))));

api.patch('/settings', async (c) => {
  const body = await c.req.json<Partial<UserSettings>>();
  const time = (v: unknown) => (v === null ? null : typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : undefined);
  const fields: Record<string, unknown> = {};
  if (body.language_code === 'ru' || body.language_code === 'en') fields.language_code = body.language_code;
  if (body.timezone && isValidTimeZone(body.timezone)) fields.timezone = body.timezone;
  if (body.day_start_hour !== undefined) fields.day_start_hour = Math.min(12, Math.max(0, Math.floor(body.day_start_hour)));
  if (body.profile_mode === 'open' || body.profile_mode === 'closed') fields.profile_mode = body.profile_mode;
  if (time(body.remind_morning) !== undefined) fields.remind_morning = time(body.remind_morning);
  if (time(body.remind_evening) !== undefined) fields.remind_evening = time(body.remind_evening);
  const user = must(await c.get('sb').from('users').update(fields).eq('id', c.get('user').id).select(USER_COLS).single<UserRow>());
  return c.json(toSettings(user));
});

// Человек разрешил боту писать (requestWriteAccess в мини-аппе) — можно слать напоминания.
api.post('/write-access', async (c) => {
  must(await c.get('sb').from('users').update({ bot_chat_ok: true }).eq('id', c.get('user').id));
  return c.json({ ok: true });
});

// Полное удаление аккаунта: каскадом уходят задачи, отметки и связи.
api.delete('/account', async (c) => {
  must(await c.get('sb').from('users').delete().eq('id', c.get('user').id));
  return c.json({ ok: true });
});
