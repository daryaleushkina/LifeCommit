// Группы: семья, команда, пара — участники, приглашения, групповые дела и отметки.
// Архитектура — docs/groups-architecture.md; кто что делает сегодня — shared/groups.ts.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dayCount, dayItem, type GoalUnit, type GroupItemRow, type GroupKind, type GroupMember, type GroupMode, type GroupRole, type GroupToday } from '../shared/groups';
import { parseRRule } from '../shared/rrule';
import type { App, UserRow } from './api';
import { addDays, logicalDay } from './day';
import { refreshChat } from './groupBot';

export const groups = new Hono<App>();

const KINDS: GroupKind[] = ['family', 'sport', 'pair', 'friends', 'work', 'other'];
const MODES: GroupMode[] = ['one', 'assign', 'goal', 'event'];
/** Ссылка-приглашение живёт неделю. */
const INVITE_DAYS = 7;

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const todayOf = (u: UserRow) => logicalDay(u.timezone, u.day_start_hour);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const bad = (message: string) => new HTTPException(400, { message });

interface RawGroup {
  id: number;
  title: string;
  kind: GroupKind;
  color: string | null;
  role: GroupRole;
  members: GroupMember[] | null;
  items: GroupItemRow[];
}

/** Мои группы с делами на день — глазами `user` (кому что, очередь, сделано). */
export async function groupsToday(sb: SupabaseClient, user: UserRow, day = todayOf(user)): Promise<GroupToday[]> {
  const raw = must(await sb.rpc('groups_today', { p_user: user.id, p_day: day })) as RawGroup[];
  return raw.map((g) => {
    const members = g.members ?? [];
    const ids = members.map((m) => m.id);
    const items = g.items.map((it) => dayItem(it, ids, user.id, day)).filter((x) => x !== null);
    let planned = 0;
    let done = 0;
    for (const it of items) {
      const c = dayCount(it);
      planned += c.planned;
      done += c.done;
    }
    return { id: g.id, title: g.title, kind: g.kind, color: g.color, role: g.role, members, items, planned, done };
  });
}

/** Участник ли я и с какой ролью. Не участник — 404 (не выдаём, что группа существует). */
async function membership(sb: SupabaseClient, groupId: number, userId: number) {
  const row = must(
    await sb.from('group_members').select('role, groups!inner(id, title, admins_only_edit, archived_at)').eq('group_id', groupId).eq('user_id', userId).maybeSingle(),
  ) as { role: GroupRole; groups: { id: number; title: string; admins_only_edit: boolean; archived_at: string | null } } | null;
  if (!row || row.groups.archived_at) throw new HTTPException(404, { message: 'not_found' });
  return { role: row.role, group: row.groups, canEdit: !row.groups.admins_only_edit || row.role !== 'member' };
}

const groupId = (v: string | undefined) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new HTTPException(404, { message: 'not_found' });
  return id;
};

// ── Группы ──

groups.get('/groups', async (c) => c.json(await groupsToday(c.get('sb'), c.get('user'))));

groups.post('/groups', async (c) => {
  const body = await c.req.json<{ title?: string; kind?: GroupKind }>();
  const title = (body.title ?? '').trim().slice(0, 60);
  if (!title) throw bad('no_title');
  const kind = KINDS.includes(body.kind as GroupKind) ? body.kind : 'other';
  const sb = c.get('sb');
  const user = c.get('user');
  const g = must(await sb.from('groups').insert({ title, kind, owner_id: user.id }).select('id').single()) as { id: number };
  must(await sb.from('group_members').insert({ group_id: g.id, user_id: user.id, role: 'owner' }));
  return c.json({ id: g.id }, 201);
});

groups.get('/groups/:id', async (c) => {
  const id = groupId(c.req.param('id'));
  const sb = c.get('sb');
  const user = c.get('user');
  const { role } = await membership(sb, id, user.id);
  const [today, settings] = await Promise.all([
    groupsToday(sb, user),
    sb.from('groups').select('admins_only_edit, rating_enabled, chat_digest, chat_reminders, tg_chat_title').eq('id', id).single(),
  ]);
  const g = today.find((x) => x.id === id);
  if (!g) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ ...g, role, settings: must(settings) });
});

groups.patch('/groups/:id', async (c) => {
  const id = groupId(c.req.param('id'));
  const sb = c.get('sb');
  const { role } = await membership(sb, id, c.get('user').id);
  if (role === 'member') throw new HTTPException(403, { message: 'forbidden' });
  const body = await c.req.json<Record<string, unknown>>();
  const fields: Record<string, unknown> = {};
  if (typeof body.title === 'string' && body.title.trim()) fields.title = body.title.trim().slice(0, 60);
  if (KINDS.includes(body.kind as GroupKind)) fields.kind = body.kind;
  for (const k of ['admins_only_edit', 'rating_enabled', 'chat_digest', 'chat_reminders'] as const) if (typeof body[k] === 'boolean') fields[k] = body[k];
  if (Object.keys(fields).length) must(await sb.from('groups').update(fields).eq('id', id));
  return c.json({ ok: true });
});

// Удалить группу может только создатель: группа уходит в архив, дела и отметки остаются в базе.
groups.delete('/groups/:id', async (c) => {
  const id = groupId(c.req.param('id'));
  const sb = c.get('sb');
  const { role } = await membership(sb, id, c.get('user').id);
  if (role !== 'owner') throw new HTTPException(403, { message: 'forbidden' });
  must(await sb.from('groups').update({ archived_at: new Date().toISOString() }).eq('id', id));
  return c.json({ ok: true });
});

// Выйти из группы. Создатель уходит — группа переходит самому давнему участнику; ушёл последний — в архив.
groups.post('/groups/:id/leave', async (c) => {
  const id = groupId(c.req.param('id'));
  const sb = c.get('sb');
  const user = c.get('user');
  const { role } = await membership(sb, id, user.id);
  must(await sb.from('group_members').delete().eq('group_id', id).eq('user_id', user.id));
  if (role === 'owner') {
    const next = must(await sb.from('group_members').select('user_id').eq('group_id', id).order('joined_at').limit(1).maybeSingle()) as { user_id: number } | null;
    if (next) {
      must(await sb.from('group_members').update({ role: 'owner' }).eq('group_id', id).eq('user_id', next.user_id));
      must(await sb.from('groups').update({ owner_id: next.user_id }).eq('id', id));
    } else must(await sb.from('groups').update({ archived_at: new Date().toISOString() }).eq('id', id));
  }
  return c.json({ ok: true });
});

// ── Приглашения ──

const inviteCode = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => abc[b % abc.length]).join('');
};

groups.post('/groups/:id/invite', async (c) => {
  const id = groupId(c.req.param('id'));
  const sb = c.get('sb');
  const user = c.get('user');
  await membership(sb, id, user.id);
  const code = inviteCode();
  const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  must(await sb.from('invites').insert({ code, inviter_id: user.id, group_id: id, expires_at: expires }));
  return c.json({ code, link: `https://t.me/${c.env.BOT_USERNAME}?startapp=g_${code}`, expires_at: expires }, 201);
});

async function openInvite(sb: SupabaseClient, code: string) {
  const inv = must(
    await sb.from('invites').select('group_id, expires_at, inviter:users!invites_inviter_id_fkey(first_name), groups!inner(id, title, kind, color, archived_at)').eq('code', code).not('group_id', 'is', null).maybeSingle(),
  ) as { group_id: number; expires_at: string | null; inviter: { first_name: string } | null; groups: { id: number; title: string; kind: GroupKind; color: string | null; archived_at: string | null } } | null;
  if (!inv || inv.groups.archived_at) throw new HTTPException(404, { message: 'invite_not_found' });
  if (inv.expires_at && Date.parse(inv.expires_at) < Date.now()) throw new HTTPException(410, { message: 'invite_expired' });
  return inv;
}

groups.get('/invites/:code', async (c) => {
  const sb = c.get('sb');
  const inv = await openInvite(sb, c.req.param('code'));
  const members = must(await sb.from('group_members').select('user_id, users(first_name)').eq('group_id', inv.group_id).order('joined_at').limit(12)) as unknown as { user_id: number; users: { first_name: string } }[];
  return c.json({
    group: { id: inv.groups.id, title: inv.groups.title, kind: inv.groups.kind, color: inv.groups.color },
    inviter: inv.inviter?.first_name ?? null,
    members: members.map((m) => ({ id: m.user_id, name: m.users.first_name })),
    member: members.some((m) => m.user_id === c.get('user').id),
  });
});

groups.post('/invites/:code/join', async (c) => {
  const sb = c.get('sb');
  const inv = await openInvite(sb, c.req.param('code'));
  must(await sb.from('group_members').upsert({ group_id: inv.group_id, user_id: c.get('user').id, role: 'member' }, { onConflict: 'group_id,user_id', ignoreDuplicates: true }));
  return c.json({ id: inv.group_id });
});

// ── Групповые дела ──

interface ItemInput {
  title?: string;
  mode?: GroupMode;
  day?: string | null;
  time?: string | null;
  duration_min?: number | null;
  rrule?: string | null;
  due_day?: string | null;
  assignees?: number[];
  all_members?: boolean;
  rotate?: boolean;
  target?: number | null;
  unit?: GoalUnit | null;
  goal_until?: string | null;
}

/** Проверить и привести поля дела. Участники — только из этой группы. */
function cleanItem(body: ItemInput, today: string, memberIds: number[], partial: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body.title !== undefined || !partial) {
    const title = (body.title ?? '').trim().slice(0, 120);
    if (!title) throw bad('no_title');
    out.title = title;
  }
  if (body.mode !== undefined || !partial) {
    if (!MODES.includes(body.mode as GroupMode)) throw bad('bad_mode');
    out.mode = body.mode;
  }
  if (body.day !== undefined || !partial) out.day = isDay(body.day) ? body.day : today;
  if (body.time !== undefined) out.time = body.time === null ? null : isTime(body.time) ? body.time : (() => { throw bad('bad_time'); })();
  if (body.duration_min !== undefined) out.duration_min = body.duration_min === null ? null : Math.min(20160, Math.max(1, Math.round(Number(body.duration_min) || 0))) || null;
  if (body.rrule !== undefined) {
    if (body.rrule !== null && !parseRRule(body.rrule)) throw bad('bad_repeat');
    out.rrule = body.rrule;
  }
  if (body.due_day !== undefined) out.due_day = isDay(body.due_day) ? body.due_day : null;
  if (body.assignees !== undefined) out.assignees = [...new Set((body.assignees ?? []).map(Number))].filter((id) => memberIds.includes(id));
  if (body.all_members !== undefined) out.all_members = Boolean(body.all_members);
  if (body.rotate !== undefined) out.rotate = Boolean(body.rotate);
  if (body.target !== undefined) {
    const t = body.target === null ? null : Number(body.target);
    if (t !== null && !(t > 0 && t < 1e12)) throw bad('bad_target');
    out.target = t;
  }
  if (body.unit !== undefined) out.unit = body.unit;
  if (body.goal_until !== undefined) out.goal_until = isDay(body.goal_until) ? body.goal_until : null;
  if (out.mode === 'goal' && !partial && !out.target) throw bad('no_target');
  // Очередь имеет смысл только у назначенного на нескольких.
  if (out.mode !== undefined && out.mode !== 'assign') out.rotate = false;
  return out;
}

async function memberIds(sb: SupabaseClient, groupId: number): Promise<number[]> {
  return (must(await sb.from('group_members').select('user_id').eq('group_id', groupId).order('joined_at')) as { user_id: number }[]).map((m) => m.user_id);
}

groups.post('/groups/:id/items', async (c) => {
  const id = groupId(c.req.param('id'));
  const sb = c.get('sb');
  const user = c.get('user');
  const { canEdit } = await membership(sb, id, user.id);
  if (!canEdit) throw new HTTPException(403, { message: 'admins_only' });
  const fields = cleanItem(await c.req.json<ItemInput>(), todayOf(user), await memberIds(sb, id), false);
  const row = must(await sb.from('group_items').insert({ ...fields, group_id: id, created_by: user.id }).select('id').single()) as { id: number };
  c.executionCtx.waitUntil(refreshChat(c.env, id));
  return c.json({ id: row.id }, 201);
});

groups.patch('/groups/:id/items/:item', async (c) => {
  const id = groupId(c.req.param('id'));
  const itemId = groupId(c.req.param('item'));
  const sb = c.get('sb');
  const user = c.get('user');
  const { canEdit } = await membership(sb, id, user.id);
  if (!canEdit) throw new HTTPException(403, { message: 'admins_only' });
  const fields = cleanItem(await c.req.json<ItemInput>(), todayOf(user), await memberIds(sb, id), true);
  if (Object.keys(fields).length) must(await sb.from('group_items').update(fields).eq('id', itemId).eq('group_id', id));
  return c.json({ ok: true });
});

groups.delete('/groups/:id/items/:item', async (c) => {
  const id = groupId(c.req.param('id'));
  const sb = c.get('sb');
  const { canEdit } = await membership(sb, id, c.get('user').id);
  if (!canEdit) throw new HTTPException(403, { message: 'admins_only' });
  must(await sb.from('group_items').update({ archived_at: new Date().toISOString() }).eq('id', groupId(c.req.param('item'))).eq('group_id', id));
  return c.json({ ok: true });
});

/** Отметить или снять отметку. Кто может — по правилу shared/groups.ts (dayItem.can_mark). */
export async function markItem(sb: SupabaseClient, user: UserRow, groupIdNum: number, itemId: number, done: boolean, dayIn?: string): Promise<'ok' | 'forbidden' | 'taken'> {
  const day = isDay(dayIn) && dayIn <= todayOf(user) && dayIn >= addDays(todayOf(user), -7) ? dayIn : todayOf(user);
  const g = (await groupsToday(sb, user, day)).find((x) => x.id === groupIdNum);
  const it = g?.items.find((x) => x.id === itemId);
  if (!it || !it.can_mark) return 'forbidden';
  const solo = it.mode === 'one' || it.turn !== null;
  if (done) {
    const res = await sb.from('group_item_marks').insert({ item_id: itemId, day, user_id: user.id, solo });
    // Кто-то успел отметить «кто-то один» раньше — это не ошибка, просто уже сделано.
    if (res.error) return res.error.code === '23505' ? 'taken' : (() => { throw new Error(res.error.message); })();
  } else must(await sb.from('group_item_marks').delete().eq('item_id', itemId).eq('day', day).eq('user_id', user.id));
  return 'ok';
}

groups.put('/groups/:id/items/:item/mark', async (c) => {
  const body = await c.req.json<{ done?: boolean; day?: string }>();
  const gid = groupId(c.req.param('id'));
  const res = await markItem(c.get('sb'), c.get('user'), gid, groupId(c.req.param('item')), body.done !== false, body.day);
  if (res === 'forbidden') throw new HTTPException(403, { message: 'not_yours' });
  // Сообщение «Сегодня в группе» в чате — тоже обновить.
  c.executionCtx.waitUntil(refreshChat(c.env, gid));
  return c.json({ ok: true, taken: res === 'taken' });
});

groups.post('/groups/:id/items/:item/entries', async (c) => {
  const id = groupId(c.req.param('id'));
  const itemId = groupId(c.req.param('item'));
  const sb = c.get('sb');
  const user = c.get('user');
  await membership(sb, id, user.id);
  const { amount } = await c.req.json<{ amount?: number }>();
  const a = Number(amount);
  if (!(a > 0 && a < 1e12)) throw bad('bad_amount');
  const item = must(await sb.from('group_items').select('mode').eq('id', itemId).eq('group_id', id).is('archived_at', null).maybeSingle()) as { mode: GroupMode } | null;
  if (item?.mode !== 'goal') throw new HTTPException(404, { message: 'not_found' });
  must(await sb.from('group_goal_entries').insert({ item_id: itemId, user_id: user.id, amount: a, day: todayOf(user) }));
  return c.json({ ok: true }, 201);
});
