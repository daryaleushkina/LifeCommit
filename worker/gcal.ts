// Google Календарь (Calendar API v3). Вход Google — только чтобы подключить календарь: в само приложение
// входят через Telegram. Храним refresh token (зашифрованным, как пароль Apple), за access token ходим
// при каждой синхронизации. Календарь в нашей базе — его адрес в API (`…/calendars/<id>`), событие —
// `…/calendars/<id>/events/<eventId>`: так дальше по коду адрес события сам говорит, чьё оно.
import type { Env } from './env';
import { buildDetails, personName } from './eventDetails';
import { parseRecurrence, utcToZoned, type CalEvent } from './ics';

export const GCAL_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** События — читать и писать; список календарей — только читать. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];

export class GoogleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Доступ отозвали (или истёк — в режиме тестирования раз в 7 дней): нужно подключить заново. */
export const isGoogleAuthError = (e: unknown) => e instanceof GoogleError && e.status === 401;

export const isGoogleHref = (href: string | null | undefined) => Boolean(href?.startsWith(GCAL_API));

export const calendarUrl = (calendarId: string) => `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}`;

// ── Вход ──

export function authUrl(env: Env, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    // offline + consent: Google отдаёт refresh token и тогда, когда человек уже подключал нас раньше.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; scope?: string }> {
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  // invalid_grant — доступ отозван или истёк: это «подключите заново», а не сбой.
  if (data.error === 'invalid_grant') throw new GoogleError(401, 'invalid_grant');
  if (!res.ok || !data.access_token) throw new GoogleError(res.status, `token: ${data.error ?? res.status}`);
  return data as { access_token: string; refresh_token?: string; scope?: string };
}

/** Код из адреса возврата → токены. */
export function exchangeCode(env: Env, code: string, redirectUri: string) {
  return tokenRequest({ code, client_id: env.GOOGLE_CLIENT_ID ?? '', client_secret: env.GOOGLE_CLIENT_SECRET ?? '', redirect_uri: redirectUri, grant_type: 'authorization_code' });
}

export async function accessToken(env: Env, refreshToken: string): Promise<string> {
  return (await tokenRequest({ refresh_token: refreshToken, client_id: env.GOOGLE_CLIENT_ID ?? '', client_secret: env.GOOGLE_CLIENT_SECRET ?? '', grant_type: 'refresh_token' })).access_token;
}

/** Отключили календарь — отзываем доступ у Google, а не только забываем его у себя. */
export async function revoke(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
}

// ── Запросы ──

async function call<T>(token: string, method: string, url: string, body?: object): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'content-type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new GoogleError(res.status, `${method} ${url.replace(GCAL_API, '')}: ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface GoogleCalendar {
  url: string;
  name: string;
  color: string | null;
  /** Свой календарь — забираем по умолчанию; чужие и подписные (праздники, коллеги) — по выбору. */
  owned: boolean;
  /** Можно ли туда писать наши дела. */
  writable: boolean;
  primary: boolean;
}

interface CalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  primary?: boolean;
  deleted?: boolean;
}

export async function listCalendars(token: string): Promise<GoogleCalendar[]> {
  const out: GoogleCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ maxResults: '250', ...(pageToken && { pageToken }) });
    const page = await call<{ items?: CalendarListEntry[]; nextPageToken?: string }>(token, 'GET', `${GCAL_API}/users/me/calendarList?${q}`);
    for (const c of page.items ?? []) {
      // «Только занятость» не показывает, что за события — делать из них нечего.
      if (c.deleted || c.accessRole === 'freeBusyReader') continue;
      out.push({
        url: calendarUrl(c.id),
        name: (c.summaryOverride ?? c.summary ?? c.id).slice(0, 80),
        color: c.backgroundColor ?? null,
        owned: c.accessRole === 'owner',
        writable: c.accessRole === 'owner' || c.accessRole === 'writer',
        primary: Boolean(c.primary),
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** Почта аккаунта — это id основного календаря. */
export const loginOf = (list: GoogleCalendar[]) => decodeURIComponent(list.find((c) => c.primary)?.url.split('/calendars/')[1] ?? '');

// ── События ──

interface When {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  etag?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  start?: When;
  end?: When;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: When;
  extendedProperties?: { private?: Record<string, string> };
  location?: string;
  description?: string;
  hangoutLink?: string;
  htmlLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean }[];
}

export class GoogleSyncExpired extends Error {}

/**
 * Изменения в календаре: с токеном — только новое, без — всё. Токен устарел (410) — GoogleSyncExpired,
 * тогда читаем заново целиком. Отменённые разы повторов приходят и без showDeleted — по ним видно исключённые дни.
 */
export async function listEvents(token: string, url: string, syncToken: string | null): Promise<{ items: GoogleEvent[]; syncToken: string | null }> {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let next: string | null = null;
  do {
    const q = new URLSearchParams({ maxResults: '2500', ...(syncToken && { syncToken }), ...(pageToken && { pageToken }) });
    let page: { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
    try {
      page = await call(token, 'GET', `${url}/events?${q}`);
    } catch (e) {
      if (e instanceof GoogleError && e.status === 410) throw new GoogleSyncExpired();
      throw e;
    }
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
    next = page.nextSyncToken ?? next;
  } while (pageToken);
  return { items, syncToken: next };
}

/** Начало или конец события → день и время человека (у событий на весь день — только день). */
function moment(w: When | undefined, userTz: string): { day: string; time: string | null } | null {
  if (w?.dateTime) {
    const ms = Date.parse(w.dateTime);
    return Number.isNaN(ms) ? null : utcToZoned(ms, userTz);
  }
  return w?.date ? { day: w.date, time: null } : null;
}

/** День, на который приходился изменённый или отменённый раз повтора. */
export const originalDay = (e: GoogleEvent, userTz: string) => moment(e.originalStartTime, userTz)?.day ?? null;

/** Событие Google → событие в нашем понимании (то же, что даёт разбор iCalendar у Apple). */
export function toCalEvent(e: GoogleEvent, uid: string, userTz: string): CalEvent | null {
  const at = moment(e.start, userTz);
  if (!at) return null;
  let durationMin: number | null = null;
  if (e.start?.dateTime && e.end?.dateTime) durationMin = Math.round((Date.parse(e.end.dateTime) - Date.parse(e.start.dateTime)) / 60000) || null;
  const rec = e.recurrence ? parseRecurrence(e.recurrence, userTz) : { rrule: null, exdates: [] };
  return {
    uid,
    title: (e.summary ?? '').trim().slice(0, 120) || '—',
    day: at.day,
    time: at.time,
    durationMin: durationMin && durationMin > 0 && durationMin <= 20160 ? durationMin : null,
    rrule: rec.rrule,
    exdates: rec.exdates,
    details: buildDetails({
      location: e.location,
      description: e.description,
      conference: e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? e.hangoutLink ?? null,
      attendees: (e.attendees ?? []).filter((a) => !a.resource).map((a) => ({ name: personName(a.displayName, a.email), self: a.self })),
      openUrl: e.htmlLink,
    }),
  };
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Начало и конец для записи: весь день — датами, со временем — местным временем и поясом человека. */
function when(day: string, time: string | null, durationMin: number | null, tz: string): { start: When; end: When } {
  if (!time) return { start: { date: day }, end: { date: nextDay(day) } };
  const [h = 0, m = 0] = time.split(':').map(Number);
  const total = h * 60 + m + (durationMin ?? 30);
  const endDay = total >= 1440 ? nextDay(day) : day;
  const rest = total % 1440;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: { dateTime: `${day}T${time.slice(0, 5)}:00`, timeZone: tz },
    end: { dateTime: `${endDay}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}:00`, timeZone: tz },
  };
}

export interface OwnChange {
  todoId: number;
  title: string;
  day: string;
  time: string | null;
  durationMin: number | null;
  tz: string;
  location?: string | null;
}

/**
 * Наше дело → событие. Есть адрес — правим его; события там уже нет (удалили в календаре между синхронизациями) —
 * создаём заново. Своё узнаём по метке lifecommit в скрытых свойствах события.
 */
export async function putOwnEvent(token: string, calUrl: string, href: string | null, e: OwnChange): Promise<{ href: string; etag: string | null }> {
  const body = { summary: e.title, location: e.location ?? '', ...when(e.day, e.time, e.durationMin, e.tz), extendedProperties: { private: { lifecommit: String(e.todoId) } } };
  if (href) {
    try {
      const saved = await call<GoogleEvent>(token, 'PATCH', href, { ...body, status: 'confirmed' });
      return { href, etag: saved.etag ?? null };
    } catch (err) {
      if (!(err instanceof GoogleError && (err.status === 404 || err.status === 410))) throw err;
    }
  }
  const saved = await call<GoogleEvent>(token, 'POST', `${calUrl}/events`, body);
  return { href: `${calUrl}/events/${encodeURIComponent(saved.id)}`, etag: saved.etag ?? null };
}

/**
 * Правка чужого события: только название и время. У повторяющегося день начала не трогаем — он задаёт,
 * в какие дни событие бывает; приглашённые, напоминания, повтор остаются как были (PATCH меняет только переданное).
 */
export async function patchForeignEvent(token: string, href: string, change: { title: string; day: string; time: string | null; durationMin: number | null; tz: string }): Promise<string | null> {
  const saved = await call<GoogleEvent>(token, 'PATCH', href, { summary: change.title, ...when(change.day, change.time, change.durationMin, change.tz) });
  return saved.etag ?? null;
}

export async function deleteGoogleEvent(token: string, href: string): Promise<void> {
  try {
    await call(token, 'DELETE', href);
  } catch (e) {
    // Уже удалено — то, чего и хотели.
    if (!(e instanceof GoogleError && (e.status === 404 || e.status === 410))) throw e;
  }
}
