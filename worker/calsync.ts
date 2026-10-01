// Синхронизация дел с календарём Apple (iCloud CalDAV) в обе стороны.
//  • Из календаря: все события из включённых календарей становятся делами (source = 'apple').
//    Повторяющиеся — одним делом с RRULE. Изменили или удалили в календаре — меняется и у нас.
//  • В календарь: наши дела пишутся в основной календарь человека событиями с UID «lifecommit-<id>»;
//    по этому UID при чтении узнаём свои и не задваиваем. Правки дел из календаря уходят в то же событие.
//  • «Сделано» в календарь не уходит: у событий нет галочки.
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, logicalDay } from './day';
import { deleteEvent, discover, getEvent, isAuthError, listCollections, multiget, pickDefault, putEvent, SyncTokenExpired, syncCollection, DavError, type DavAuth } from './caldav';
import type { Env } from './env';
import { buildEvent, parseEvents, patchEvent, type CalEvent } from './ics';
import { open, seal } from './secret';

export const APPLE_CALDAV = 'https://caldav.icloud.com/';
const OWN_UID = /^lifecommit-(\d+)$/;
/** Событий за один запрос «дай тексты»: пачкой — чтобы не упереться в лимит запросов Worker'а. */
const MULTIGET_BATCH = 100;
/** Разовые события старше этого — уже не дела: не забираем, чтобы не тащить годы истории. */
const PAST_DAYS = 30;

interface UserLite {
  id: number;
  timezone: string;
  day_start_hour: number;
}

export interface AccountRow {
  id: number;
  user_id: number;
  provider: 'apple' | 'google';
  login: string;
  secret: string;
  home_url: string | null;
  default_url: string | null;
  status: 'ok' | 'auth_failed' | 'error';
  last_sync_at: string | null;
  /** Календарь для наших дел выбрал сам человек — тогда не двигаем его сами. */
  default_manual?: boolean;
  /** Сменился часовой пояс — перезаписать наши дела со временем. */
  retime?: boolean;
}

interface TodoSyncRow {
  id: number;
  title: string;
  day: string;
  time: string | null;
  duration_min: number | null;
  rrule: string | null;
  done_on: string | null;
  source: 'apple' | 'google' | null;
  external_uid: string | null;
  external_href: string | null;
  external_etag: string | null;
}

const baseUrl = (env: Env) => env.CALDAV_APPLE_URL || APPLE_CALDAV;

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

async function authOf(env: Env, acc: AccountRow): Promise<DavAuth> {
  return { login: acc.login, password: await open(env.CALENDAR_KEY, acc.secret) };
}

async function markFailed(sb: SupabaseClient, acc: AccountRow, e: unknown) {
  const status = isAuthError(e) ? 'auth_failed' : 'error';
  await sb.from('calendar_accounts').update({ status, last_error: String(e).slice(0, 300) }).eq('id', acc.id);
}

// ── Подключение ──

/**
 * Подключить Apple: проверить пароль (найти календари), сохранить зашифрованно, забрать события
 * и выгрузить в календарь наши несделанные дела. Неверный пароль — DavError 401.
 */
export async function connectApple(env: Env, sb: SupabaseClient, user: UserLite, login: string, password: string): Promise<number> {
  const auth = { login: login.trim(), password: password.trim() };
  const found = await discover(baseUrl(env), auth);
  const acc = check(
    await sb
      .from('calendar_accounts')
      .upsert(
        { user_id: user.id, provider: 'apple', login: auth.login, secret: await seal(env.CALENDAR_KEY, auth.password), home_url: found.homeUrl, default_url: found.defaultUrl, status: 'ok', last_error: null },
        { onConflict: 'user_id,provider' },
      )
      .select('*')
      .single(),
  ) as AccountRow;
  // Решение владелицы: забираем все календари (включая дни рождения и праздники, если они есть в CalDAV).
  check(await sb.from('calendar_collections').delete().eq('account_id', acc.id));
  if (found.collections.length) {
    check(await sb.from('calendar_collections').insert(found.collections.map((c) => ({ account_id: acc.id, url: c.url, name: c.name, color: c.color, enabled: true }))));
  }
  await pullAccount(env, sb, user, acc);
  await exportPending(env, sb, user, acc);
  return acc.id;
}

// ── Из календаря к нам ──

/** Забрать изменения из всех включённых календарей подключения. */
export async function pullAccount(env: Env, sb: SupabaseClient, user: UserLite, acc: AccountRow): Promise<void> {
  let needExport = false;
  try {
    const auth = await authOf(env, acc);
    // Новые календари, которые человек завёл после подключения, тоже забираем.
    if (acc.home_url) {
      const known = new Set((check(await sb.from('calendar_collections').select('url').eq('account_id', acc.id)) as { url: string }[]).map((c) => c.url));
      const all = await listCollections(acc.home_url, auth);
      const fresh = all.filter((c) => !known.has(c.url));
      if (fresh.length) check(await sb.from('calendar_collections').insert(fresh.map((c) => ({ account_id: acc.id, url: c.url, name: c.name, color: c.color, enabled: true }))));
      // Основной календарь не нашёлся при подключении (раньше не распознавали календари iCloud) — выберем сейчас.
      if (!acc.default_url && all.length) {
        acc.default_url = pickDefault(all);
        await sb.from('calendar_accounts').update({ default_url: acc.default_url }).eq('id', acc.id);
        needExport = true;
      }
    }
    const collections = check(await sb.from('calendar_collections').select('url, sync_token').eq('account_id', acc.id).eq('enabled', true)) as { url: string; sync_token: string | null }[];
    for (const col of collections) await pullCollection(sb, user, auth, col.url, col.sync_token, acc.id, Boolean(acc.retime));
    await sb.from('calendar_accounts').update({ status: 'ok', last_error: null, last_sync_at: new Date().toISOString() }).eq('id', acc.id);
    // Пока человек не выбрал сам, наши дела пишем туда, где живёт больше всего его событий.
    if (!acc.default_manual) {
      const busiest = await busiestCalendar(sb, user.id);
      if (busiest && busiest !== acc.default_url) {
        await moveOwnEvents(env, sb, user, acc, busiest, false);
        needExport = true;
      }
    }
    if (needExport) await exportPending(env, sb, user, acc);
    if (acc.retime) await rewriteTimed(env, sb, user, acc);
    await removeUntimed(sb, auth, user.id);
  } catch (e) {
    console.error('calendar pull failed', acc.id, e);
    await markFailed(sb, acc, e);
    throw e;
  }
}

async function pullCollection(sb: SupabaseClient, user: UserLite, auth: DavAuth, url: string, token: string | null, accountId: number, retime: boolean) {
  let sync;
  let full = !token;
  try {
    sync = await syncCollection(url, auth, token);
  } catch (e) {
    if (!(e instanceof SyncTokenExpired)) throw e;
    sync = await syncCollection(url, auth, null);
    full = true;
  }
  const oldest = addDays(logicalDay(user.timezone, user.day_start_hour), -PAST_DAYS);
  for (let i = 0; i < sync.changed.length; i += MULTIGET_BATCH) {
    const batch = await multiget(url, auth, sync.changed.slice(i, i + MULTIGET_BATCH).map((c) => c.href));
    await applyBatch(sb, user, url, batch.map((item) => ({ href: item.href, etag: item.etag, events: parseEvents(item.data, user.timezone).filter((e) => e.rrule || e.day >= oldest) })), retime);
  }
  if (sync.removed.length) await removeHrefs(sb, user.id, sync.removed);
  // Полная перечитка не сообщает об удалённом — убираем всё из этого календаря, чего в нём больше нет.
  if (full) {
    const present = new Set(sync.changed.map((c) => c.href));
    const ours = check(await sb.from('todos').select('id, external_href').eq('user_id', user.id).eq('calendar_url', url).not('external_href', 'is', null)) as { id: number; external_href: string }[];
    const gone = ours.filter((t) => !present.has(t.external_href)).map((t) => t.external_href);
    if (gone.length) await removeHrefs(sb, user.id, gone);
  }
  check(await sb.from('calendar_collections').update({ sync_token: sync.token }).eq('account_id', accountId).eq('url', url));
}

/**
 * Пачка событий из календаря → дела. Своё (lifecommit-<id>) обновляет наше дело, чужое — создаёт
 * или правит «пришедшее». Всё чужое пишется одним запросом, лишнее (пропавшие изменённые разы) — одним удалением.
 */
async function applyBatch(sb: SupabaseClient, user: UserLite, calendarUrl: string, items: { href: string; etag: string | null; events: CalEvent[] }[], retime = false) {
  const foreign: Record<string, unknown>[] = [];
  const keep = new Set<string>();
  for (const { href, etag, events } of items) {
    const link = { external_href: href, external_etag: etag, calendar_url: calendarUrl };
    for (const e of events) {
      keep.add(e.uid);
      const own = OWN_UID.exec(e.uid);
      if (own) {
        // Своих событий в пачке мало — это наши же дела, поправленные в календаре.
        // После смены пояса событие ещё в старом поясе: время дела главнее, его и перезапишем в календарь.
        const fields = retime ? { external_uid: e.uid, ...link } : { title: e.title, day: e.day, time: e.time, duration_min: e.durationMin, external_uid: e.uid, ...link };
        await sb.from('todos').update(fields).eq('id', Number(own[1])).eq('user_id', user.id);
        continue;
      }
      foreign.push({ user_id: user.id, external_uid: e.uid, source: 'apple', title: e.title, day: e.day, time: e.time, duration_min: e.durationMin, rrule: e.rrule, exdates: e.exdates, ...link });
    }
  }
  if (foreign.length) check(await sb.from('todos').upsert(foreign, { onConflict: 'user_id,external_uid' }));
  // Из этих событий пропали изменённые разы (или событие ушло в прошлое) — их дела больше не нужны.
  const hrefs = items.map((i) => i.href);
  const existing = check(await sb.from('todos').select('id, external_uid').eq('user_id', user.id).eq('source', 'apple').in('external_href', hrefs)) as { id: number; external_uid: string }[];
  const drop = existing.filter((t) => !keep.has(t.external_uid)).map((t) => t.id);
  if (drop.length) check(await sb.from('todos').delete().in('id', drop));
}

/** Событие удалили в календаре — удаляем и дело (и пришедшее, и наше выгруженное). */
async function removeHrefs(sb: SupabaseClient, userId: number, hrefs: string[]) {
  for (let i = 0; i < hrefs.length; i += 100) check(await sb.from('todos').delete().eq('user_id', userId).in('external_href', hrefs.slice(i, i + 100)));
}

// ── От нас в календарь ──

async function appleAccount(sb: SupabaseClient, userId: number): Promise<AccountRow | null> {
  return check(await sb.from('calendar_accounts').select('*').eq('user_id', userId).eq('provider', 'apple').eq('status', 'ok').maybeSingle()) as AccountRow | null;
}

const TODO_SYNC_COLS = 'id, title, day, time, duration_min, rrule, done_on, source, external_uid, external_href, external_etag';

/** Записать дело в календарь (создать или поправить событие). Без подключения — ничего не делает. */
export async function pushTodo(env: Env, sb: SupabaseClient, user: UserLite, todoId: number): Promise<void> {
  const acc = await appleAccount(sb, user.id);
  if (!acc?.default_url) return;
  const todo = check(await sb.from('todos').select(TODO_SYNC_COLS).eq('id', todoId).eq('user_id', user.id).maybeSingle()) as TodoSyncRow | null;
  if (!todo) return;
  try {
    await writeTodo(sb, user, await authOf(env, acc), acc, todo);
  } catch (e) {
    console.error('calendar push failed', todoId, e);
    if (isAuthError(e)) await markFailed(sb, acc, e);
  }
}

async function writeTodo(sb: SupabaseClient, user: UserLite, auth: DavAuth, acc: AccountRow, todo: TodoSyncRow) {
  const time = todo.time ? todo.time.slice(0, 5) : null;
  // Дело из календаря: правим само событие — только название и время, остальное не трогаем.
  if (todo.source === 'apple' && todo.external_href) {
    const href = todo.external_href;
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await getEvent(href, auth);
      const patched = patchEvent(current.data, { title: todo.title, day: todo.day, time, durationMin: todo.duration_min, tz: user.timezone, recurring: Boolean(todo.rrule) });
      try {
        const etag = await putEvent(href, auth, patched, current.etag);
        await sb.from('todos').update({ external_etag: etag }).eq('id', todo.id);
        return;
      } catch (e) {
        // 412 — кто-то поменял событие между чтением и записью: перечитаем и попробуем ещё раз.
        if (!(e instanceof DavError && e.status === 412) || attempt === 1) throw e;
      }
    }
    return;
  }
  if (todo.source) return;
  // Наше дело. Повторяющихся своих дел пока нет — их не выгружаем.
  if (todo.rrule) return;
  // Дела без времени в календарь не пишем (решение владелицы: «Напоминания» Apple закрыты для приложений,
  // а событие «на весь день» — не то). Время убрали — убираем и событие.
  if (!time) {
    if (todo.external_href) await unlinkAndDelete(sb, auth, todo);
    return;
  }
  const uid = `lifecommit-${todo.id}`;
  const href = todo.external_href ?? `${acc.default_url}${uid}.ics`;
  const ics = buildEvent({ uid, title: todo.title, day: todo.day, time, durationMin: todo.duration_min, tz: user.timezone });
  let etag: string | null;
  try {
    etag = await putEvent(href, auth, ics, todo.external_href ? todo.external_etag : null);
  } catch (e) {
    // Событие поменяли в календаре — наша правка новее, перезаписываем по свежему ETag.
    if (!(e instanceof DavError && e.status === 412)) throw e;
    etag = await putEvent(href, auth, ics, (await getEvent(href, auth)).etag);
  }
  await sb.from('todos').update({ external_uid: uid, external_href: href, external_etag: etag, calendar_url: todo.external_href ? undefined : acc.default_url }).eq('id', todo.id);
}

/** Сначала забываем связь (чтобы синхронизация не приняла удаление за удаление дела), потом удаляем событие. */
async function unlinkAndDelete(sb: SupabaseClient, auth: DavAuth, todo: Pick<TodoSyncRow, 'id' | 'external_href'>) {
  await sb.from('todos').update({ external_uid: null, external_href: null, external_etag: null, calendar_url: null }).eq('id', todo.id);
  if (todo.external_href) await deleteEvent(todo.external_href, auth, null).catch((e) => console.error('untimed delete failed', e));
}

/** Наши дела без времени, выгруженные раньше (когда выгружали всё), убираем из календаря. */
async function removeUntimed(sb: SupabaseClient, auth: DavAuth, userId: number) {
  const rows = check(await sb.from('todos').select('id, external_href').eq('user_id', userId).is('source', null).is('time', null).not('external_href', 'is', null).limit(60)) as Pick<TodoSyncRow, 'id' | 'external_href'>[];
  for (const t of rows) await unlinkAndDelete(sb, auth, t);
}

/** Дело удаляют у нас — удаляем и событие (для повторяющегося — всю серию). Строку дела передают до удаления. */
export async function deleteRemote(env: Env, sb: SupabaseClient, userId: number, todo: { external_href: string | null }): Promise<void> {
  if (!todo.external_href) return;
  const acc = await appleAccount(sb, userId);
  if (!acc) return;
  try {
    await deleteEvent(todo.external_href, await authOf(env, acc), null);
  } catch (e) {
    console.error('calendar delete failed', e);
    if (isAuthError(e)) await markFailed(sb, acc, e);
  }
}

/** После подключения: выгрузить наши несделанные разовые дела с сегодняшнего дня. */
async function exportPending(env: Env, sb: SupabaseClient, user: UserLite, acc: AccountRow) {
  if (!acc.default_url) return;
  const today = logicalDay(user.timezone, user.day_start_hour);
  const rows = check(
    await sb.from('todos').select(TODO_SYNC_COLS).eq('user_id', user.id).is('source', null).is('external_href', null).is('done_on', null).is('rrule', null).not('time', 'is', null).gte('day', today).lte('day', addDays(today, 366)).limit(40),
  ) as TodoSyncRow[];
  const auth = await authOf(env, acc);
  for (const t of rows) {
    try {
      await writeTodo(sb, user, auth, acc, t);
    } catch (e) {
      console.error('export failed', t.id, e);
    }
  }
}

/** Календарь, из которого пришло больше всего событий. */
async function busiestCalendar(sb: SupabaseClient, userId: number): Promise<string | null> {
  const rows = check(await sb.from('todos').select('calendar_url').eq('user_id', userId).eq('source', 'apple').not('calendar_url', 'is', null).limit(2000)) as { calendar_url: string }[];
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.calendar_url, (count.get(r.calendar_url) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Писать наши дела в другой календарь: уже выгруженные переезжают (удаляем старое событие,
 * создаём в новом календаре). manual — выбрал сам человек, дальше не двигаем.
 */
export async function moveOwnEvents(env: Env, sb: SupabaseClient, user: UserLite, acc: AccountRow, url: string, manual: boolean): Promise<void> {
  const from = acc.default_url;
  acc.default_url = url;
  acc.default_manual = manual || acc.default_manual;
  check(await sb.from('calendar_accounts').update({ default_url: url, default_manual: acc.default_manual }).eq('id', acc.id));
  if (!from || from === url) return;
  const auth = await authOf(env, acc);
  const moved = check(await sb.from('todos').select(TODO_SYNC_COLS).eq('user_id', user.id).is('source', null).eq('calendar_url', from).limit(60)) as TodoSyncRow[];
  for (const t of moved) {
    try {
      if (t.external_href) await deleteEvent(t.external_href, auth, null);
      const fresh = { ...t, external_href: null, external_etag: null };
      await sb.from('todos').update({ external_href: null, external_etag: null, calendar_url: null }).eq('id', t.id);
      await writeTodo(sb, user, auth, acc, fresh);
    } catch (e) {
      console.error('move failed', t.id, e);
    }
  }
}

/**
 * Сменился часовой пояс человека. Здесь только пометка — это быстро: при следующей синхронизации
 * календарь перечитается целиком в новом поясе, а наши дела со временем перезапишутся
 * («18:00» значит 18:00 там, где человек сейчас). Делать это прямо при входе — слишком долго.
 */
export async function retimeCalendars(sb: SupabaseClient, userId: number): Promise<void> {
  const accounts = check(await sb.from('calendar_accounts').update({ retime: true, last_sync_at: null }).eq('user_id', userId).select('id')) as { id: number }[];
  if (accounts.length) check(await sb.from('calendar_collections').update({ sync_token: null }).in('account_id', accounts.map((a) => a.id)));
}

/** Перезаписать в календаре наши дела со временем — после смены пояса. */
async function rewriteTimed(env: Env, sb: SupabaseClient, user: UserLite, acc: AccountRow) {
  const auth = await authOf(env, acc);
  const timed = check(await sb.from('todos').select(TODO_SYNC_COLS).eq('user_id', user.id).is('source', null).not('external_href', 'is', null).not('time', 'is', null).limit(60)) as TodoSyncRow[];
  for (const t of timed) await writeTodo(sb, user, auth, acc, t).catch((e) => console.error('retime write failed', t.id, e));
  await sb.from('calendar_accounts').update({ retime: false }).eq('id', acc.id);
}

// ── Отключение ──

/** Отключить: пришедшие из календаря дела убираем, наши остаются (связь с событиями забываем). */
export async function disconnect(sb: SupabaseClient, userId: number, provider: 'apple' | 'google'): Promise<void> {
  check(await sb.from('todos').delete().eq('user_id', userId).eq('source', provider));
  check(await sb.from('todos').update({ external_uid: null, external_href: null, external_etag: null, calendar_url: null }).eq('user_id', userId).is('source', null).not('external_href', 'is', null));
  check(await sb.from('calendar_accounts').delete().eq('user_id', userId).eq('provider', provider));
}

// ── По расписанию ──

/** Сколько подключений обновлять за один запуск cron: у Worker'а ограничено число запросов наружу. */
const CRON_ACCOUNTS = 4;

export async function syncDue(env: Env, sb: SupabaseClient): Promise<void> {
  if (!env.CALENDAR_KEY) return;
  const due = check(await sb.from('calendar_accounts').select('*').eq('status', 'ok').order('last_sync_at', { ascending: true, nullsFirst: true }).limit(CRON_ACCOUNTS)) as AccountRow[];
  for (const acc of due) {
    const user = check(await sb.from('users').select('id, timezone, day_start_hour').eq('id', acc.user_id).maybeSingle()) as UserLite | null;
    if (!user) continue;
    await pullAccount(env, sb, user, acc).catch(() => {});
  }
}
