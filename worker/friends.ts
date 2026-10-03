// Друзья (допрос владелицы 03.10.2026). Дружба взаимная и всегда через заявку: по @username или по личной
// постоянной ссылке (открыл ссылку — её владельцу приходит заявка). Бот присылает заявку с кнопками
// «Принять / Отклонить / Заблокировать» (worker/bot.ts → friendCallback). Отклонённая заявка удаляется — ничего не помним.
// Друг видит общую карту (все привычки и дела) без названий и только открытые друзьям привычки — только смотреть:
// реакций и «поддержать» нет (решение владелицы 03.10.2026). Заблокированный не находит по @username, по ссылке и не шлёт заявки.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AbstainStatus, FriendCard, FriendHabit, FriendProfile, FriendsResponse, HeatDay, Person, PersonStatus } from '../shared/types';
import type { App, UserRow } from './api';
import { habitsToday, toTodayTasks, type TodayRow } from './habits';
import { addDays, logicalDay, weekStart } from './day';
import { tg, type Env } from './env';

export const friends = new Hono<App>();

/** Сколько дней отметок открытой привычки видно на экране друга. */
const HABIT_DAYS = 35;
/** Полоска карты в карточке друга. */
const STRIP_DAYS = 14;
const PERSON_COLS = 'id, first_name, username, photo_url';

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const notFound = () => new HTTPException(404, { message: 'not_found' });

/** id из адреса; не целое положительное — 404, как и несуществующий. */
function personId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
}

interface Pair {
  requester_id: number;
  addressee_id: number;
  status: 'pending' | 'accepted';
  accepted_at: string | null;
  via: 'username' | 'link';
}

/** Строка дружбы или заявки между двумя людьми — в какую сторону ни просили. */
async function pairOf(sb: SupabaseClient, a: number, b: number): Promise<Pair | null> {
  return must(
    await sb
      .from('friendships')
      .select('requester_id, addressee_id, status, accepted_at, via')
      .or(`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`)
      .maybeSingle(),
  ) as Pair | null;
}

/** Кто кого заблокировал: by — я его, of — он меня. */
async function blocksBetween(sb: SupabaseClient, me: number, other: number): Promise<{ byMe: boolean; byThem: boolean }> {
  const rows = must(
    await sb.from('blocks').select('blocker_id').or(`and(blocker_id.eq.${me},blocked_id.eq.${other}),and(blocker_id.eq.${other},blocked_id.eq.${me})`),
  ) as { blocker_id: number }[];
  return { byMe: rows.some((r) => r.blocker_id === me), byThem: rows.some((r) => r.blocker_id === other) };
}

function statusOf(pair: Pair | null, me: number): PersonStatus {
  if (!pair) return 'none';
  if (pair.status === 'accepted') return 'friends';
  return pair.requester_id === me ? 'sent' : 'incoming';
}

const codeAbc = 'abcdefghjkmnpqrstuvwxyz23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => codeAbc[b % codeAbc.length]).join('');

/** Моя постоянная ссылка: код заводится при первом открытии «Друзей». */
async function myCode(sb: SupabaseClient, me: number): Promise<{ code: string; prompted: boolean }> {
  const row = must(await sb.from('users').select('friend_code, friends_prompted').eq('id', me).single()) as { friend_code: string | null; friends_prompted: boolean };
  if (row.friend_code) return { code: row.friend_code, prompted: row.friends_prompted };
  // Совпадение кодов почти невероятно, но уникальность проверяет база — тогда пробуем ещё раз.
  for (let attempt = 0; ; attempt++) {
    const code = newCode();
    const { error } = await sb.from('users').update({ friend_code: code }).eq('id', me).is('friend_code', null);
    if (!error) return { code: (must(await sb.from('users').select('friend_code').eq('id', me).single()) as { friend_code: string }).friend_code, prompted: row.friends_prompted };
    if (attempt === 2) throw new Error(error.message);
  }
}

const link = (env: Env, code: string) => `https://t.me/${env.BOT_USERNAME}?startapp=f_${code}`;

/** «@masha», «masha», «t.me/masha» → masha; не похоже на имя Telegram — null. */
export function cleanUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? name : null;
}

/** Человек по @username (без учёта регистра) или по коду ссылки. */
async function findPerson(sb: SupabaseClient, by: { username?: string; code?: string }): Promise<(Person & { language_code: string; bot_chat_ok: boolean }) | null> {
  const cols = `${PERSON_COLS}, language_code, bot_chat_ok`;
  // В ilike «_» — любой символ: экранируем, чтобы a_b не нашёл acb.
  const q = by.username ? sb.from('users').select(cols).ilike('username', by.username.replace(/_/g, '\\_')) : sb.from('users').select(cols).eq('friend_code', by.code ?? '');
  return must(await q.limit(1).maybeSingle()) as (Person & { language_code: string; bot_chat_ok: boolean }) | null;
}

/** Найти и проверить, можно ли ему писать: он меня заблокировал — для меня его нет. */
async function reachable(sb: SupabaseClient, me: number, by: { username?: string; code?: string }) {
  const person = await findPerson(sb, by);
  if (!person) throw notFound();
  const blocks = person.id === me ? { byMe: false, byThem: false } : await blocksBetween(sb, me, person.id);
  if (blocks.byThem) throw notFound();
  return { person, blockedByMe: blocks.byMe };
}

const asPerson = (p: Person): Person => ({ id: p.id, first_name: p.first_name, username: p.username, photo_url: p.photo_url });

// ── Список ──

interface FriendTask {
  id: number;
  user_id: number;
  kind: TodayRow['kind'];
  schedule: TodayRow['schedule'];
  weekdays: number;
  per_week: number | null;
  task_goals: { target: number; effective_from: string }[];
}

/** «N из M» за сегодня друга по открытым мне привычкам — тем же правилом, что «Сегодня» у него самого. */
function progress(tasks: FriendTask[], logs: { task_id: number; day: string; value: number; status: AbstainStatus }[], day: string) {
  const rows = tasks.map(
    (t) =>
      ({
        ...t,
        title: '',
        emoji: null,
        unit: null,
        step: 1,
        visibility: 'friends',
        challenge_id: null,
        last_slip_on: null,
        target: [...t.task_goals].filter((g) => g.effective_from <= day).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]?.target ?? 1,
        start: null,
        clean_count: 0,
        pre_slips: 0,
        subtasks: [],
      }) as unknown as TodayRow,
  );
  const states = toTodayTasks(rows, logs, day).filter((t) => t.due);
  return { due: states.length, done: states.filter((t) => (t.kind === 'abstain' ? t.status !== null : t.value >= (t.kind === 'check' ? 1 : t.target))).length };
}

friends.get('/friends', async (c) => {
  const sb = c.get('sb');
  const me = c.get('user').id;
  const [pairs, mine] = await Promise.all([
    sb
      .from('friendships')
      .select(`requester_id, addressee_id, status, accepted_at, via, requester:users!friendships_requester_id_fkey(${PERSON_COLS}, timezone, day_start_hour), addressee:users!friendships_addressee_id_fkey(${PERSON_COLS}, timezone, day_start_hour)`)
      .or(`requester_id.eq.${me},addressee_id.eq.${me}`),
    myCode(sb, me),
  ]);
  type Who = Person & { timezone: string; day_start_hour: number };
  const rows = must(pairs) as unknown as (Pair & { requester: Who; addressee: Who })[];
  const other = (r: (typeof rows)[number]) => (r.requester_id === me ? r.addressee : r.requester);
  const accepted = rows.filter((r) => r.status === 'accepted');

  // Открытые привычки всех друзей и их отметки с начала недели — двумя запросами на весь список.
  const ids = accepted.map((r) => other(r).id);
  const days = new Map(accepted.map((r) => [other(r).id, logicalDay(other(r).timezone, other(r).day_start_hour)]));
  const from = [...days.values()].map(weekStart).sort()[0];
  const latest = [...days.values()].sort().at(-1);
  const [tasksRes, logsRes, heatRes] = ids.length
    ? await Promise.all([
        sb.from('tasks').select('id, user_id, kind, schedule, weekdays, per_week, task_goals(target, effective_from)').in('user_id', ids).eq('visibility', 'friends').is('archived_at', null),
        sb.from('task_logs').select('task_id, user_id, day, value, status').in('user_id', ids).gte('day', from!),
        // Полоска общей карты — по всем привычкам и делам, без названий.
        sb.rpc('users_heatmap', { p_users: ids, p_from: addDays([...days.values()].sort()[0]!, -(STRIP_DAYS - 1)), p_to: latest }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  const tasks = must(tasksRes) as FriendTask[];
  const logs = must(logsRes) as { task_id: number; user_id: number; day: string; value: number; status: AbstainStatus }[];
  const heat = must(heatRes) as { user_id: number; day: string; score: number }[];
  const strip = (id: number, day: string) =>
    Array.from({ length: STRIP_DAYS }, (_, i) => {
      const d = addDays(day, i - (STRIP_DAYS - 1));
      return Number(heat.find((h) => h.user_id === id && h.day === d)?.score ?? 0);
    });

  const list: FriendCard[] = accepted
    .map((r) => {
      const p = other(r);
      const day = days.get(p.id)!;
      const own = tasks.filter((t) => t.user_id === p.id);
      const shown = new Set(own.map((t) => t.id));
      return { ...asPerson(p), since: r.accepted_at, ...progress(own, logs.filter((l) => shown.has(l.task_id) && l.day >= weekStart(day) && l.day <= day), day), days: strip(p.id, day) };
    })
    .sort((a, b) => a.first_name.localeCompare(b.first_name, 'ru') || a.id - b.id);
  const body: FriendsResponse = {
    friends: list,
    incoming: rows.filter((r) => r.status === 'pending' && r.addressee_id === me).map((r) => ({ ...asPerson(r.requester), via: r.via })),
    outgoing: rows.filter((r) => r.status === 'pending' && r.requester_id === me).map((r) => asPerson(r.addressee)),
    link: link(c.env, mine.code),
    prompt: list.length > 0 && !mine.prompted,
  };
  return c.json(body);
});

// ── Найти, позвать, принять ──

// Поиск по @username в «Позвать друга»: кто это и кто он мне. Нет такого или он меня заблокировал — 404.
friends.get('/friends/find', async (c) => {
  const username = cleanUsername(c.req.query('username'));
  if (!username) throw new HTTPException(400, { message: 'bad_username' });
  const sb = c.get('sb');
  const me = c.get('user').id;
  const { person, blockedByMe } = await reachable(sb, me, { username });
  const status: PersonStatus = person.id === me ? 'self' : blockedByMe ? 'blocked' : statusOf(await pairOf(sb, me, person.id), me);
  return c.json({ person: asPerson(person), status });
});

// Открыли чужую ссылку «Позвать друга»: кто зовёт.
friends.get('/friends/link/:code', async (c) => {
  const sb = c.get('sb');
  const me = c.get('user').id;
  const { person, blockedByMe } = await reachable(sb, me, { code: c.req.param('code') });
  const status: PersonStatus = person.id === me ? 'self' : blockedByMe ? 'blocked' : statusOf(await pairOf(sb, me, person.id), me);
  return c.json({ person: asPerson(person), status });
});

const texts = {
  ru: {
    request: (who: string) => `${who} хочет дружить в LifeCommit`,
    accept: 'Принять',
    decline: 'Отклонить',
    block: 'Заблокировать',
  },
  en: {
    request: (who: string) => `${who} wants to be friends on LifeCommit`,
    accept: 'Accept',
    decline: 'Decline',
    block: 'Block',
  },
};

/** Заявка: бот пишет тому, кому её прислали (если он открывал бота), с кнопками прямо в чате. */
async function notifyRequest(env: Env, from: Person, to: { id: number; language_code: string; bot_chat_ok: boolean }) {
  if (!to.bot_chat_ok) return;
  const t = to.language_code === 'en' ? texts.en : texts.ru;
  const who = from.username ? `${from.first_name} (@${from.username})` : from.first_name;
  await tg(env, 'sendMessage', {
    chat_id: to.id,
    text: t.request(who),
    reply_markup: {
      inline_keyboard: [
        [
          { text: t.accept, callback_data: `fr:a:${from.id}` },
          { text: t.decline, callback_data: `fr:d:${from.id}` },
        ],
        [{ text: t.block, callback_data: `fr:b:${from.id}` }],
      ],
    },
  }).catch((e) => console.error('friend request message failed', e));
}

/** Принять заявку from → me. Заявки нет — false. */
export async function acceptRequest(sb: SupabaseClient, me: number, from: number): Promise<boolean> {
  const rows = must(
    await sb.from('friendships').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('requester_id', from).eq('addressee_id', me).eq('status', 'pending').select('requester_id'),
  ) as unknown[];
  return rows.length > 0;
}

/** Отклонить заявку from → me: строка удаляется, ничего не помним. */
export async function declineRequest(sb: SupabaseClient, me: number, from: number): Promise<boolean> {
  const rows = must(await sb.from('friendships').delete().eq('requester_id', from).eq('addressee_id', me).eq('status', 'pending').select('requester_id')) as unknown[];
  return rows.length > 0;
}

/** Заблокировать: дружба и заявки в обе стороны пропадают. */
export async function blockPerson(sb: SupabaseClient, me: number, other: number): Promise<void> {
  must(await sb.from('friendships').delete().or(`and(requester_id.eq.${me},addressee_id.eq.${other}),and(requester_id.eq.${other},addressee_id.eq.${me})`));
  must(await sb.from('blocks').upsert({ blocker_id: me, blocked_id: other }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }));
}

// Позвать: по @username ({ username }) или открыв чужую ссылку ({ code }).
friends.post('/friends/requests', async (c) => {
  const body = await c.req.json<{ username?: string; code?: string }>();
  const username = body.username === undefined ? undefined : cleanUsername(body.username);
  if (username === null || (username === undefined && typeof body.code !== 'string')) throw new HTTPException(400, { message: 'bad_username' });
  const sb = c.get('sb');
  const user = c.get('user');
  const { person, blockedByMe } = await reachable(sb, user.id, username ? { username } : { code: body.code });
  if (person.id === user.id) throw new HTTPException(400, { message: 'self' });
  if (blockedByMe) throw new HTTPException(409, { message: 'blocked' });
  const pair = await pairOf(sb, user.id, person.id);
  // Уже друзья или заявка уже ушла — повторно не пишем.
  if (pair?.status === 'accepted') return c.json({ status: 'friends' });
  if (pair && pair.requester_id === user.id) return c.json({ status: 'sent' });
  // Он сам уже звал меня — это взаимно: сразу друзья.
  if (pair) {
    await acceptRequest(sb, user.id, person.id);
    return c.json({ status: 'friends' });
  }
  const { error } = await sb.from('friendships').insert({ requester_id: user.id, addressee_id: person.id, status: 'pending', via: username ? 'username' : 'link' });
  // Встречная заявка успела появиться одновременно — уникальность пары не даст задвоить.
  if (error?.code === '23505') return c.json({ status: 'sent' });
  must({ data: null, error });
  c.executionCtx.waitUntil(notifyRequest(c.env, asPerson(user), person));
  return c.json({ status: 'sent' }, 201);
});

friends.post('/friends/requests/:id/accept', async (c) => {
  if (!(await acceptRequest(c.get('sb'), c.get('user').id, personId(c.req.param('id'))))) throw notFound();
  return c.json({ ok: true });
});

// Отклонить заявку ко мне или отменить свою — строка просто удаляется.
friends.delete('/friends/requests/:id', async (c) => {
  const sb = c.get('sb');
  const me = c.get('user').id;
  const other = personId(c.req.param('id'));
  if (await declineRequest(sb, me, other)) return c.json({ ok: true });
  must(await sb.from('friendships').delete().eq('requester_id', me).eq('addressee_id', other).eq('status', 'pending'));
  return c.json({ ok: true });
});

// Убрать из друзей — тихо: у второго я просто пропадаю из списка.
friends.delete('/friends/:id', async (c) => {
  const sb = c.get('sb');
  const me = c.get('user').id;
  const other = personId(c.req.param('id'));
  must(await sb.from('friendships').delete().eq('status', 'accepted').or(`and(requester_id.eq.${me},addressee_id.eq.${other}),and(requester_id.eq.${other},addressee_id.eq.${me})`));
  return c.json({ ok: true });
});

// ── Блок ──

friends.post('/friends/:id/block', async (c) => {
  const other = personId(c.req.param('id'));
  if (other === c.get('user').id) throw new HTTPException(400, { message: 'self' });
  await blockPerson(c.get('sb'), c.get('user').id, other);
  return c.json({ ok: true });
});

friends.get('/blocks', async (c) => {
  const rows = must(await c.get('sb').from('blocks').select(`created_at, blocked:users!blocks_blocked_id_fkey(${PERSON_COLS})`).eq('blocker_id', c.get('user').id).order('created_at', { ascending: false })) as unknown as {
    blocked: Person;
  }[];
  return c.json(rows.map((r) => asPerson(r.blocked)));
});

friends.delete('/blocks/:id', async (c) => {
  must(await c.get('sb').from('blocks').delete().eq('blocker_id', c.get('user').id).eq('blocked_id', personId(c.req.param('id'))));
  return c.json({ ok: true });
});

// ── Что показать друзьям ──

// Шторка «Что показать друзьям?»: отмеченные — друзьям, остальные — только мне. Шторку больше не показываем.
friends.put('/friends/shown', async (c) => {
  const { task_ids } = await c.req.json<{ task_ids?: unknown }>();
  if (!Array.isArray(task_ids) || !task_ids.every((id) => Number.isSafeInteger(id) && id > 0)) throw new HTTPException(400, { message: 'bad_tasks' });
  const sb = c.get('sb');
  const me = c.get('user').id;
  must(await sb.from('tasks').update({ visibility: 'private' }).eq('user_id', me).not('id', 'in', `(${[0, ...task_ids].join(',')})`));
  if (task_ids.length) must(await sb.from('tasks').update({ visibility: 'friends' }).eq('user_id', me).in('id', task_ids));
  must(await sb.from('users').update({ friends_prompted: true }).eq('id', me));
  return c.json({ ok: true });
});

// Закрыли шторку, ничего не меняя.
friends.post('/friends/prompted', async (c) => {
  must(await c.get('sb').from('users').update({ friends_prompted: true }).eq('id', c.get('user').id));
  return c.json({ ok: true });
});

// ── Экран друга ──

async function friendRow(sb: SupabaseClient, me: number, other: number) {
  const pair = await pairOf(sb, me, other);
  if (pair?.status !== 'accepted') throw notFound();
  const user = must(await sb.from('users').select('*').eq('id', other).single()) as UserRow;
  return { pair, user };
}

friends.get('/friends/:id', async (c) => {
  const sb = c.get('sb');
  const me = c.get('user').id;
  const { pair, user } = await friendRow(sb, me, personId(c.req.param('id')));
  const day = logicalDay(user.timezone, user.day_start_hour);
  const [habits, heat, logs] = await Promise.all([
    habitsToday(sb, user),
    sb.rpc('user_heatmap', { p_user: user.id, p_from: addDays(day, -370), p_to: day }),
    sb.from('task_logs').select('task_id, day, value, status').eq('user_id', user.id).gte('day', addDays(day, -(HABIT_DAYS - 1))).order('day'),
  ]);
  const logRows = must(logs) as { task_id: number; day: string; value: number; status: AbstainStatus }[];
  const shown: FriendHabit[] = habits
    .filter((t) => t.visibility === 'friends' && t.challenge_id === null)
    .map((t) => ({
      id: t.id,
      title: t.title,
      emoji: t.emoji,
      kind: t.kind,
      unit: t.unit,
      target: t.target,
      value: t.value,
      status: t.status,
      due: t.due,
      clean_days: t.kind === 'abstain' ? t.clean_before + (t.status === 'clean' ? 1 : 0) : 0,
      logs: logRows.filter((l) => l.task_id === t.id).map((l) => ({ day: l.day, value: Number(l.value), status: l.status })),
    }));
  const body: FriendProfile = {
    person: asPerson(user),
    since: pair.accepted_at,
    today: day,
    heat: (must(heat) as { day: string; score: number }[]).map((h): HeatDay => ({ day: h.day, score: Number(h.score) })),
    habits: shown,
  };
  return c.json(body);
});
