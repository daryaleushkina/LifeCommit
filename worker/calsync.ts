// Синхронизация дел с календарями Apple (iCloud CalDAV) и Google (Calendar API) в обе стороны.
//  • Из календаря: события из включённых календарей становятся делами (source = 'apple' | 'google').
//    Повторяющиеся — одним делом с RRULE. Изменили или удалили в календаре — меняется и у нас.
//  • В календарь: наши дела со временем пишутся в основной календарь человека; своё узнаём по UID
//    «lifecommit-<id>» (Apple) или по метке lifecommit в скрытых свойствах события (Google) и не задваиваем.
//    Правки дел из календаря уходят в то же событие.
//  • «Сделано» в календарь не уходит: у событий нет галочки.
//  • Подключены оба — наши дела пишутся в подключённый последним; уже выгруженные остаются, где были.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TodoDetails } from '../shared/types';
import { addDays, logicalDay } from './day';
import { deleteEvent, discover, getEvent, isAuthError, listCollections, multiget, pickDefault, putEvent, SyncTokenExpired, syncCollection, DavError, type DavAuth } from './caldav';
import type { Env } from './env';
import {
  accessToken,
  deleteGoogleEvent,
  exchangeCode,
  GoogleError,
  GoogleSyncExpired,
  isGoogleAuthError,
  isGoogleHref,
  listCalendars,
  listEvents,
  loginOf,
  originalDay,
  patchForeignEvent,
  putOwnEvent,
  revoke,
  toCalEvent,
  GOOGLE_SCOPES,
  type GoogleCalendar,
} from './gcal';
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
  /** Apple — пароль приложения, Google — refresh token; оба зашифрованы ключом CALENDAR_KEY. */
  secret: string;
  home_url: string | null;
  default_url: string | null;
  /** setup — Google подключён, но человек ещё не выбрал, какие календари забирать. */
  status: 'ok' | 'auth_failed' | 'error' | 'setup';
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
  calendar_url: string | null;
  details: TodoDetails | null;
}

const TODO_SYNC_COLS = 'id, title, day, time, duration_min, rrule, done_on, source, external_uid, external_href, external_etag, calendar_url, details';

const baseUrl = (env: Env) => env.CALDAV_APPLE_URL || APPLE_CALDAV;

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const providerOf = (href: string): AccountRow['provider'] => (isGoogleHref(href) ? 'google' : 'apple');
export const isCalendarAuthError = (e: unknown) => isAuthError(e) || isGoogleAuthError(e);

async function markFailed(sb: SupabaseClient, acc: AccountRow, e: unknown) {
  const status = isCalendarAuthError(e) ? 'auth_failed' : 'error';
  await sb.from('calendar_accounts').update({ status, last_error: String(e).slice(0, 300) }).eq('id', acc.id);
}

// ── Связь с календарём: одно и то же для Apple и Google ──

interface Conn {
  acc: AccountRow;
  /** Адрес события — из этого подключения (у человека может быть и Apple, и Google). */
  owns(href: string): boolean;
  /** Наше дело → событие в календаре calUrl (создать или поправить). */
  putOwn(todo: TodoSyncRow, calUrl: string, tz: string): Promise<{ href: string; etag: string | null }>;
  /** Дело из календаря поправили у нас → правим само событие (только название и время). */
  patchForeign(todo: TodoSyncRow, tz: string): Promise<string | null>;
  remove(href: string): Promise<void>;
}

type AppleConn = Conn & { auth: DavAuth };
type GoogleConn = Conn & { token: string };

function appleConn(acc: AccountRow, auth: DavAuth): AppleConn {
  return {
    acc,
    auth,
    owns: (href) => !isGoogleHref(href),
    async putOwn(todo, calUrl, tz) {
      const uid = `lifecommit-${todo.id}`;
      const href = todo.external_href ?? `${calUrl}${uid}.ics`;
      const ics = buildEvent({ uid, title: todo.title, day: todo.day, time: todo.time?.slice(0, 5) ?? null, durationMin: todo.duration_min, tz, location: todo.details?.location });
      try {
        return { href, etag: await putEvent(href, auth, ics, todo.external_href ? todo.external_etag : null) };
      } catch (e) {
        // Событие поменяли в календаре — наша правка новее, перезаписываем по свежему ETag.
        if (!(e instanceof DavError && e.status === 412)) throw e;
        return { href, etag: await putEvent(href, auth, ics, (await getEvent(href, auth)).etag) };
      }
    },
    async patchForeign(todo, tz) {
      const href = todo.external_href!;
      for (let attempt = 0; ; attempt++) {
        const current = await getEvent(href, auth);
        const patched = patchEvent(current.data, { title: todo.title, day: todo.day, time: todo.time?.slice(0, 5) ?? null, durationMin: todo.duration_min, tz, recurring: Boolean(todo.rrule) });
        try {
          return await putEvent(href, auth, patched, current.etag);
        } catch (e) {
          // 412 — кто-то поменял событие между чтением и записью: перечитаем и попробуем ещё раз.
          if (!(e instanceof DavError && e.status === 412) || attempt === 1) throw e;
        }
      }
    },
    remove: (href) => deleteEvent(href, auth, null),
  };
}

function googleConn(acc: AccountRow, token: string): GoogleConn {
  return {
    acc,
    token,
    owns: isGoogleHref,
    putOwn: (todo, calUrl, tz) => putOwnEvent(token, calUrl, todo.external_href, { todoId: todo.id, title: todo.title, day: todo.day, time: todo.time?.slice(0, 5) ?? null, durationMin: todo.duration_min, tz, location: todo.details?.location }),
    patchForeign: (todo, tz) => patchForeignEvent(token, todo.external_href!, { title: todo.title, day: todo.day, time: todo.time?.slice(0, 5) ?? null, durationMin: todo.duration_min, tz }),
    remove: (href) => deleteGoogleEvent(token, href),
  };
}

async function connect(env: Env, acc: AccountRow): Promise<AppleConn | GoogleConn> {
  const secret = await open(env.CALENDAR_KEY, acc.secret);
  if (acc.provider === 'google') return googleConn(acc, await accessToken(env, secret));
  return appleConn(acc, { login: acc.login, password: secret });
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
  // Первая синхронизация заодно выгрузит наши дела.
  await pullAccount(env, sb, user, acc);
  return acc.id;
}

const googleCollection = (accountId: number, c: GoogleCalendar) => ({ account_id: accountId, url: c.url, name: c.name, color: c.color, enabled: c.owned, writable: c.writable });

/**
 * Google вернул человека с кодом: обменять на токены, сохранить и показать список календарей.
 * Первое подключение — статус setup: события забираем после того, как человек выберет календари.
 * Подключение заново (доступ истёк) — выбор прежний, сразу синхронизируем.
 */
export async function connectGoogle(env: Env, sb: SupabaseClient, user: UserLite, code: string, redirectUri: string): Promise<{ account: AccountRow; fresh: boolean }> {
  const tokens = await exchangeCode(env, code, redirectUri);
  // На экране согласия Google галочки можно снять — без доступа к событиям подключать нечего.
  const granted = tokens.scope?.split(' ') ?? GOOGLE_SCOPES;
  if (!GOOGLE_SCOPES.every((s) => granted.includes(s))) throw new GoogleError(403, 'scope_denied');
  if (!tokens.refresh_token) throw new GoogleError(400, 'no_refresh_token');
  const calendars = await listCalendars(tokens.access_token);
  const before = check(await sb.from('calendar_accounts').select('id, status').eq('user_id', user.id).eq('provider', 'google').maybeSingle()) as { id: number; status: AccountRow['status'] } | null;
  const fresh = !before || before.status === 'setup';
  const primary = calendars.find((c) => c.primary) ?? calendars.find((c) => c.writable);
  const account = check(
    await sb
      .from('calendar_accounts')
      .upsert(
        {
          user_id: user.id,
          provider: 'google',
          login: loginOf(calendars) || 'Google',
          secret: await seal(env.CALENDAR_KEY, tokens.refresh_token),
          home_url: null,
          status: fresh ? 'setup' : 'ok',
          last_error: null,
          ...(fresh && { default_url: primary?.url ?? null, default_manual: false }),
        },
        { onConflict: 'user_id,provider' },
      )
      .select('*')
      .single(),
  ) as AccountRow;
  if (fresh) {
    check(await sb.from('calendar_collections').delete().eq('account_id', account.id));
    if (calendars.length) check(await sb.from('calendar_collections').insert(calendars.map((c) => googleCollection(account.id, c))));
  }
  return { account, fresh };
}

/** Человек выбрал календари Google — забираем события и выгружаем наши дела. */
export async function confirmGoogle(env: Env, sb: SupabaseClient, user: UserLite, acc: AccountRow): Promise<void> {
  acc.status = 'ok';
  check(await sb.from('calendar_accounts').update({ status: 'ok' }).eq('id', acc.id));
  await pullAccount(env, sb, user, acc);
}

// ── Из календаря к нам ──

/** Забрать изменения из всех включённых календарей подключения. */
export async function pullAccount(env: Env, sb: SupabaseClient, user: UserLite, acc: AccountRow): Promise<void> {
  if (acc.status === 'setup') return;
  try {
    const conn = await connect(env, acc);
    let needExport = 'auth' in conn ? await pullApple(sb, user, conn.auth, acc) : await pullGoogle(sb, user, conn, acc);
    // Первая синхронизация (и перечитка после смены пояса) — заодно выгрузить наши дела.
    if (!acc.last_sync_at) needExport = true;
    await sb.from('calendar_accounts').update({ status: 'ok', last_error: null, last_sync_at: new Date().toISOString() }).eq('id', acc.id);
    // Пока человек не выбрал сам, наши дела пишем туда, где живёт больше всего его событий.
    if (!acc.default_manual) {
      const busiest = await busiestCalendar(sb, user.id, acc);
      if (busiest && busiest !== acc.default_url) {
        await moveOwnEvents(env, sb, user, acc, busiest, false, conn);
        needExport = true;
      }
    }
    if (needExport) await exportPending(sb, user, conn);
    if (acc.retime) await rewriteTimed(sb, user, conn);
    await removeUntimed(sb, conn, user.id);
  } catch (e) {
    console.error('calendar pull failed', acc.id, e);
    await markFailed(sb, acc, e);
    throw e;
  }
}

// ── Apple ──

/** Возвращает true, если основной календарь выбрался только сейчас — тогда пора выгрузить наши дела. */
async function pullApple(sb: SupabaseClient, user: UserLite, auth: DavAuth, acc: AccountRow): Promise<boolean> {
  let needExport = false;
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
  for (const col of collections) await pullCollection(sb, user, auth, col.url, col.sync_token, acc.id, Boolean(acc.retime), acc.login);
  return needExport;
}

async function pullCollection(sb: SupabaseClient, user: UserLite, auth: DavAuth, url: string, token: string | null, accountId: number, retime: boolean, selfEmail: string) {
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
    await applyBatch(sb, user, url, batch.map((item) => ({ href: item.href, etag: item.etag, events: parseEvents(item.data, user.timezone, selfEmail).filter((e) => e.rrule || e.day >= oldest) })), retime);
  }
  if (sync.removed.length) await removeHrefs(sb, user.id, sync.removed);
  // Полная перечитка не сообщает об удалённом — убираем всё из этого календаря, чего в нём больше нет.
  if (full) await removeMissing(sb, user.id, url, new Set(sync.changed.map((c) => c.href)));
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
        await updateOwn(sb, user.id, Number(own[1]), e, link, retime);
        continue;
      }
      foreign.push(foreignRow(user.id, 'apple', e, link));
    }
  }
  if (foreign.length) check(await sb.from('todos').upsert(foreign, { onConflict: 'user_id,external_uid' }));
  // Из этих событий пропали изменённые разы (или событие ушло в прошлое) — их дела больше не нужны.
  const hrefs = items.map((i) => i.href);
  const existing = check(await sb.from('todos').select('id, external_uid').eq('user_id', user.id).eq('source', 'apple').in('external_href', hrefs)) as { id: number; external_uid: string }[];
  const drop = existing.filter((t) => !keep.has(t.external_uid)).map((t) => t.id);
  if (drop.length) check(await sb.from('todos').delete().in('id', drop));
}

type Link = { external_href: string; external_etag: string | null; calendar_url: string };

const foreignRow = (userId: number, source: 'apple' | 'google', e: CalEvent, link: Link) => ({
  user_id: userId,
  external_uid: e.uid,
  source,
  title: e.title,
  day: e.day,
  time: e.time,
  duration_min: e.durationMin,
  rrule: e.rrule,
  exdates: e.exdates,
  details: e.details,
  ...link,
});

/**
 * Наше же дело, поправленное в календаре. Своих событий в пачке мало, поэтому по одному.
 * После смены пояса событие ещё в старом поясе: время дела главнее, его и перезапишем в календарь.
 */
async function updateOwn(sb: SupabaseClient, userId: number, todoId: number, e: CalEvent, link: Link, retime: boolean) {
  const uid = `lifecommit-${todoId}`;
  const fields = retime ? { external_uid: uid, ...link } : { title: e.title, day: e.day, time: e.time, duration_min: e.durationMin, details: e.details, external_uid: uid, ...link };
  await sb.from('todos').update(fields).eq('id', todoId).eq('user_id', userId);
}

/** Событие удалили в календаре — удаляем и дело (и пришедшее, и наше выгруженное). */
async function removeHrefs(sb: SupabaseClient, userId: number, hrefs: string[]) {
  for (let i = 0; i < hrefs.length; i += 100) check(await sb.from('todos').delete().eq('user_id', userId).in('external_href', hrefs.slice(i, i + 100)));
}

/** После полной перечитки календаря: всё, чего в нём больше нет. */
async function removeMissing(sb: SupabaseClient, userId: number, calendarUrl: string, present: Set<string>) {
  const ours = check(await sb.from('todos').select('external_href').eq('user_id', userId).eq('calendar_url', calendarUrl).not('external_href', 'is', null)) as { external_href: string }[];
  const gone = ours.filter((t) => !present.has(t.external_href)).map((t) => t.external_href);
  if (gone.length) await removeHrefs(sb, userId, gone);
}

// ── Google ──

async function pullGoogle(sb: SupabaseClient, user: UserLite, conn: GoogleConn, acc: AccountRow): Promise<boolean> {
  // Календари, заведённые после подключения: свои забираем сразу, чужие и подписные — только если включат.
  const all = await listCalendars(conn.token);
  const known = new Set((check(await sb.from('calendar_collections').select('url').eq('account_id', acc.id)) as { url: string }[]).map((c) => c.url));
  const fresh = all.filter((c) => !known.has(c.url));
  if (fresh.length) check(await sb.from('calendar_collections').insert(fresh.map((c) => googleCollection(acc.id, c))));
  const collections = check(await sb.from('calendar_collections').select('url, sync_token').eq('account_id', acc.id).eq('enabled', true)) as { url: string; sync_token: string | null }[];
  for (const col of collections) await pullGoogleCalendar(sb, user, conn.token, col.url, col.sync_token, acc.id, Boolean(acc.retime));
  return false;
}

/**
 * Изменения одного календаря Google → дела. Изменённый раз повтора — отдельное дело «<повтор>#<день>»,
 * а у самого повтора этот день исключается (как у Apple с RECURRENCE-ID); отменённый раз — только исключается.
 */
async function pullGoogleCalendar(sb: SupabaseClient, user: UserLite, token: string, url: string, syncToken: string | null, accountId: number, retime: boolean) {
  let res;
  let full = !syncToken;
  try {
    res = await listEvents(token, url, syncToken);
  } catch (e) {
    if (!(e instanceof GoogleSyncExpired)) throw e;
    res = await listEvents(token, url, null);
    full = true;
  }
  const tz = user.timezone;
  const oldest = addDays(logicalDay(tz, user.day_start_hour), -PAST_DAYS);
  const foreign: ReturnType<typeof foreignRow>[] = [];
  const removed: string[] = [];
  const dropUids: string[] = [];
  const dropSeries: string[] = [];
  /** Повтор → дни, исключённые изменёнными и отменёнными разами. */
  const skipped = new Map<string, Set<string>>();
  const present = new Set<string>();

  for (const e of res.items) {
    const href = `${url}/events/${encodeURIComponent(e.id)}`;
    const link = { external_href: href, external_etag: e.etag ?? null, calendar_url: url };
    if (e.recurringEventId) {
      const orig = originalDay(e, tz);
      if (!orig) continue;
      const series = `g:${e.recurringEventId}`;
      skipped.set(series, (skipped.get(series) ?? new Set()).add(orig));
      const uid = `${series}#${orig}`;
      if (e.status === 'cancelled') {
        dropUids.push(uid);
        continue;
      }
      const ev = toCalEvent(e, uid, tz);
      if (!ev || ev.day < oldest) continue;
      present.add(href);
      foreign.push(foreignRow(user.id, 'google', { ...ev, rrule: null, exdates: [] }, link));
      continue;
    }
    if (e.status === 'cancelled') {
      removed.push(href);
      dropSeries.push(`g:${e.id}#`);
      continue;
    }
    const own = e.extendedProperties?.private?.lifecommit;
    const ev = toCalEvent(e, own ? `lifecommit-${own}` : `g:${e.id}`, tz);
    if (!ev) continue;
    present.add(href);
    if (own) {
      await updateOwn(sb, user.id, Number(own), ev, link, retime);
      continue;
    }
    if (!ev.rrule && ev.day < oldest) continue;
    foreign.push(foreignRow(user.id, 'google', ev, link));
  }

  // Исключённые дни повтора копятся из разных пачек — не теряем уже известные.
  const seriesUids = [...new Set([...foreign.filter((r) => r.rrule).map((r) => r.external_uid), ...skipped.keys()])];
  const known = new Map<string, string[]>();
  for (let i = 0; i < seriesUids.length; i += 100) {
    const rows = check(await sb.from('todos').select('external_uid, exdates').eq('user_id', user.id).in('external_uid', seriesUids.slice(i, i + 100))) as { external_uid: string; exdates: string[] }[];
    for (const r of rows) known.set(r.external_uid, r.exdates ?? []);
  }
  const merged = (uid: string, own: string[]) => [...new Set([...own, ...(known.get(uid) ?? []), ...(skipped.get(uid) ?? [])])].sort();
  for (const r of foreign) if (r.rrule) r.exdates = merged(r.external_uid, r.exdates);
  for (let i = 0; i < foreign.length; i += 500) check(await sb.from('todos').upsert(foreign.slice(i, i + 500), { onConflict: 'user_id,external_uid' }));
  // Повтор не менялся, а его раз поменяли или отменили — дописываем исключённый день.
  const inBatch = new Set(foreign.map((r) => r.external_uid));
  for (const uid of skipped.keys()) {
    if (inBatch.has(uid) || !known.has(uid)) continue;
    check(await sb.from('todos').update({ exdates: merged(uid, []) }).eq('user_id', user.id).eq('external_uid', uid));
  }

  if (removed.length) await removeHrefs(sb, user.id, removed);
  for (let i = 0; i < dropUids.length; i += 100) check(await sb.from('todos').delete().eq('user_id', user.id).in('external_uid', dropUids.slice(i, i + 100)));
  // Удалили весь повтор — его изменённые разы тоже.
  for (const prefix of dropSeries) check(await sb.from('todos').delete().eq('user_id', user.id).like('external_uid', `${prefix}%`));
  if (full) await removeMissing(sb, user.id, url, present);
  check(await sb.from('calendar_collections').update({ sync_token: res.syncToken }).eq('account_id', accountId).eq('url', url));
}

// ── От нас в календарь ──

/** Куда пишем новые дела: подключённый последним рабочий календарь. */
async function destination(sb: SupabaseClient, userId: number): Promise<AccountRow | null> {
  return check(await sb.from('calendar_accounts').select('*').eq('user_id', userId).eq('status', 'ok').not('default_url', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()) as AccountRow | null;
}

async function accountOf(sb: SupabaseClient, userId: number, href: string): Promise<AccountRow | null> {
  return check(await sb.from('calendar_accounts').select('*').eq('user_id', userId).eq('provider', providerOf(href)).eq('status', 'ok').maybeSingle()) as AccountRow | null;
}

/** Записать дело в календарь (создать или поправить событие). Без подключения — ничего не делает. */
export async function pushTodo(env: Env, sb: SupabaseClient, user: UserLite, todoId: number): Promise<void> {
  const todo = check(await sb.from('todos').select(TODO_SYNC_COLS).eq('id', todoId).eq('user_id', user.id).maybeSingle()) as TodoSyncRow | null;
  if (!todo) return;
  // Уже связано с событием — правим там, где оно лежит; новое — туда, куда пишем сейчас.
  const acc = todo.external_href ? await accountOf(sb, user.id, todo.external_href) : await destination(sb, user.id);
  if (!acc?.default_url) return;
  try {
    await writeTodo(sb, user, await connect(env, acc), todo);
  } catch (e) {
    console.error('calendar push failed', todoId, e);
    if (isCalendarAuthError(e)) await markFailed(sb, acc, e);
  }
}

async function writeTodo(sb: SupabaseClient, user: UserLite, conn: Conn, todo: TodoSyncRow) {
  // Дело из календаря: правим само событие — только название и время, остальное не трогаем.
  if (todo.source) {
    if (todo.external_href && conn.owns(todo.external_href)) {
      const etag = await conn.patchForeign(todo, user.timezone);
      await sb.from('todos').update({ external_etag: etag }).eq('id', todo.id);
    }
    return;
  }
  // Наше дело. Повторяющихся своих дел пока нет — их не выгружаем.
  if (todo.rrule) return;
  // Дела без времени в календарь не пишем (решение владелицы: «Напоминания» Apple закрыты для приложений,
  // а событие «на весь день» — не то). Время убрали — убираем и событие.
  if (!todo.time) {
    if (todo.external_href) await unlinkAndDelete(sb, conn, todo);
    return;
  }
  const calUrl = (todo.external_href && todo.calendar_url) || conn.acc.default_url;
  if (!calUrl) return;
  const { href, etag } = await conn.putOwn(todo, calUrl, user.timezone);
  await sb.from('todos').update({ external_uid: `lifecommit-${todo.id}`, external_href: href, external_etag: etag, calendar_url: calUrl }).eq('id', todo.id);
}

/** Сначала забываем связь (чтобы синхронизация не приняла удаление за удаление дела), потом удаляем событие. */
async function unlinkAndDelete(sb: SupabaseClient, conn: Conn, todo: Pick<TodoSyncRow, 'id' | 'external_href'>) {
  await sb.from('todos').update({ external_uid: null, external_href: null, external_etag: null, calendar_url: null }).eq('id', todo.id);
  if (todo.external_href) await conn.remove(todo.external_href).catch((e) => console.error('untimed delete failed', e));
}

/** Наши дела без времени, выгруженные раньше (когда выгружали всё), убираем из календаря. */
async function removeUntimed(sb: SupabaseClient, conn: Conn, userId: number) {
  const rows = check(await sb.from('todos').select('id, external_href').eq('user_id', userId).is('source', null).is('time', null).not('external_href', 'is', null).limit(60)) as Pick<TodoSyncRow, 'id' | 'external_href'>[];
  for (const t of rows) if (t.external_href && conn.owns(t.external_href)) await unlinkAndDelete(sb, conn, t);
}

/** Дело удаляют у нас — удаляем и событие (для повторяющегося — всю серию). Строку дела передают до удаления. */
export async function deleteRemote(env: Env, sb: SupabaseClient, userId: number, todo: { external_href: string | null }): Promise<void> {
  if (!todo.external_href) return;
  const acc = await accountOf(sb, userId, todo.external_href);
  if (!acc) return;
  try {
    await (await connect(env, acc)).remove(todo.external_href);
  } catch (e) {
    console.error('calendar delete failed', e);
    if (isCalendarAuthError(e)) await markFailed(sb, acc, e);
  }
}

/** Выгрузить наши несделанные разовые дела со временем с сегодняшнего дня — если пишем сейчас сюда. */
async function exportPending(sb: SupabaseClient, user: UserLite, conn: Conn) {
  if (!conn.acc.default_url || (await destination(sb, user.id))?.id !== conn.acc.id) return;
  const today = logicalDay(user.timezone, user.day_start_hour);
  const rows = check(
    await sb.from('todos').select(TODO_SYNC_COLS).eq('user_id', user.id).is('source', null).is('external_href', null).is('done_on', null).is('rrule', null).not('time', 'is', null).gte('day', today).lte('day', addDays(today, 366)).limit(40),
  ) as TodoSyncRow[];
  for (const t of rows) {
    try {
      await writeTodo(sb, user, conn, t);
    } catch (e) {
      console.error('export failed', t.id, e);
    }
  }
}

/** Календарь подключения, из которого пришло больше всего событий (только те, куда можно писать). */
async function busiestCalendar(sb: SupabaseClient, userId: number, acc: AccountRow): Promise<string | null> {
  const writable = (check(await sb.from('calendar_collections').select('url').eq('account_id', acc.id).eq('writable', true)) as { url: string }[]).map((c) => c.url);
  if (!writable.length) return null;
  const rows = check(await sb.from('todos').select('calendar_url').eq('user_id', userId).eq('source', acc.provider).in('calendar_url', writable).limit(2000)) as { calendar_url: string }[];
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.calendar_url, (count.get(r.calendar_url) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Писать наши дела в другой календарь: уже выгруженные переезжают (удаляем старое событие,
 * создаём в новом календаре). manual — выбрал сам человек, дальше не двигаем.
 */
export async function moveOwnEvents(env: Env, sb: SupabaseClient, user: UserLite, acc: AccountRow, url: string, manual: boolean, known?: Conn): Promise<void> {
  const from = acc.default_url;
  acc.default_url = url;
  acc.default_manual = manual || acc.default_manual;
  check(await sb.from('calendar_accounts').update({ default_url: url, default_manual: acc.default_manual }).eq('id', acc.id));
  if (!from || from === url) return;
  const conn = known ?? (await connect(env, acc));
  const moved = check(await sb.from('todos').select(TODO_SYNC_COLS).eq('user_id', user.id).is('source', null).eq('calendar_url', from).limit(60)) as TodoSyncRow[];
  for (const t of moved) {
    try {
      if (t.external_href) await conn.remove(t.external_href);
      await sb.from('todos').update({ external_href: null, external_etag: null, calendar_url: null }).eq('id', t.id);
      await writeTodo(sb, user, conn, { ...t, external_href: null, external_etag: null, calendar_url: null });
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
async function rewriteTimed(sb: SupabaseClient, user: UserLite, conn: Conn) {
  const timed = check(await sb.from('todos').select(TODO_SYNC_COLS).eq('user_id', user.id).is('source', null).not('external_href', 'is', null).not('time', 'is', null).limit(60)) as TodoSyncRow[];
  for (const t of timed) if (t.external_href && conn.owns(t.external_href)) await writeTodo(sb, user, conn, t).catch((e) => console.error('retime write failed', t.id, e));
  await sb.from('calendar_accounts').update({ retime: false }).eq('id', conn.acc.id);
}

// ── Отключение ──

/** Отключить: пришедшие из календаря дела убираем, наши остаются (связь с событиями забываем). Доступ Google отзываем. */
export async function disconnect(env: Env, sb: SupabaseClient, userId: number, provider: 'apple' | 'google'): Promise<void> {
  const acc = check(await sb.from('calendar_accounts').select('secret').eq('user_id', userId).eq('provider', provider).maybeSingle()) as { secret: string } | null;
  if (provider === 'google' && acc && env.CALENDAR_KEY) await revoke(await open(env.CALENDAR_KEY, acc.secret).catch(() => ''));
  check(await sb.from('todos').delete().eq('user_id', userId).eq('source', provider));
  const unlink = sb.from('todos').update({ external_uid: null, external_href: null, external_etag: null, calendar_url: null }).eq('user_id', userId).is('source', null);
  const pattern = 'https://www.googleapis.com/calendar/%';
  check(await (provider === 'google' ? unlink.like('external_href', pattern) : unlink.not('external_href', 'is', null).not('external_href', 'like', pattern)));
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
    // Сбой уже в логе и в статусе подключения (pullAccount) — остальные подключения идут дальше.
    await pullAccount(env, sb, user, acc).catch(() => {});
  }
}
