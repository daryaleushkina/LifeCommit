// Поддельные календари для тестов синхронизации (calsync.*.int.test.ts): iCloud (CalDAV) и Google Calendar API.
// Оба с памятью, как настоящие: событие можно «завести на телефоне», жетон синхронизации отдаёт только
// изменившееся, запись по устаревшему ETag получает 412. Каждый запрос записан — тест проверяет, что ушло наружу.
//
//   const cloud = icloud();                         // iCloud с календарями «Дом» и «Работа»
//   cloud.put('home', 'meet.ics', ics(vevent(…)))   // событие завели на телефоне
//   const g = gcal();                               // Google с основным, рабочим и праздничным календарями
//   g.put('primary', { id: 'plan', summary: '…', start: …, end: … })
import { GOOGLE_SCOPES, type GoogleEvent } from '../gcal';
import { env, net } from './harness';

// ── iCalendar ──

/** Текст календаря с событиями (блоки из vevent). */
export const ics = (...events: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iPhone OS 26.0//EN', ...events.flat(), 'END:VCALENDAR', ''].join('\r\n');
export const vevent = (uid: string, lines: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, ...lines, 'END:VEVENT'];
/** День (и время) в записи iCalendar: 2026-10-05 → 20261005, с 15:30 → 20261005T153000. */
export const stamp = (day: string, hm?: string) => day.replace(/-/g, '') + (hm ? `T${hm.replace(':', '')}00` : '');

// ── iCloud ──

/** Куда приходит подключение (env.CALDAV_APPLE_URL) и куда iCloud переадресует — как caldav.icloud.com → pNN-caldav.icloud.com. */
export const ICLOUD_ENTRY = `${env.CALDAV_APPLE_URL}/`;
export const ICLOUD_NODE = 'https://p07-caldav.test';
export const APPLE_ID = 'dasha@icloud.com';
const PRINCIPAL = '/1234/principal/';
const HOME = '/1234/calendars/';
const INBOX = `${HOME}inbox/`;

interface DavEvent {
  etag: string;
  ics: string;
}

interface DavCalendar {
  name: string;
  events: Map<string, DavEvent>;
  /** Журнал изменений: путь события и номер версии — по нему жетон отдаёт только новое. */
  log: { path: string; v: number }[];
}

export interface DavRequest {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const multistatus = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:">${inner}</multistatus>`;
const ok = (href: string, props: string) => `<response><href>${href}</href><propstat><prop>${props}</prop><status>HTTP/1.1 200 OK</status></propstat></response>`;

export function icloud(calendars: Record<string, string> = { home: 'Дом', work: 'Работа' }) {
  let version = 0;
  const cals = new Map<string, DavCalendar>();
  const conflicts = new Map<string, number>();
  /** Жетоны старше этой версии больше не действуют. */
  let validFrom = 0;

  const cloud = {
    password: 'abcd-efgh-ijkl-mnop',
    /** Календарь «по умолчанию» (свойство входящих); null — сервер его не называет. */
    defaultSlug: 'home' as string | null,
    /** Ответить этим статусом на любой запрос (сервер лежит). */
    down: null as number | null,
    /** Сеть не доходит до сервера (fetch бросает TypeError). */
    unreachable: false,
    requests: [] as DavRequest[],

    url: (slug: string) => `${ICLOUD_NODE}${HOME}${slug}/`,
    addCalendar(slug: string, name: string) {
      cals.set(`${HOME}${slug}/`, { name, events: new Map(), log: [] });
    },
    /** Событие завели или поменяли на телефоне. Возвращает адрес события. */
    put(slug: string, file: string, text: string): string {
      const path = `${HOME}${slug}/${file}`;
      write(path, text);
      return `${ICLOUD_NODE}${path}`;
    },
    /** Событие удалили на телефоне. */
    remove(href: string) {
      const path = new URL(href).pathname;
      const cal = calOf(path);
      cal?.events.delete(path);
      cal?.log.push({ path, v: ++version });
    },
    event: (href: string) => calOf(new URL(href).pathname)?.events.get(new URL(href).pathname),
    /** Адреса событий в календаре. */
    hrefs: (slug: string) => [...(cals.get(`${HOME}${slug}/`)?.events.keys() ?? [])].map((p) => `${ICLOUD_NODE}${p}`),
    /** Все выданные жетоны больше не действуют — сервер потерял историю, нужна полная перечитка. */
    expireTokens: () => void (validFrom = ++version),
    /** Следующие times записей этого события по ETag получат 412 — будто его успели поменять на телефоне. */
    conflictNext: (href: string, times = 1) => void conflicts.set(new URL(href).pathname, times),
    sent: (method: string) => cloud.requests.filter((r) => r.method === method),
  };

  for (const [slug, name] of Object.entries(calendars)) cloud.addCalendar(slug, name);

  function calOf(path: string): DavCalendar | undefined {
    return cals.get(path.slice(0, path.lastIndexOf('/') + 1));
  }

  function write(path: string, text: string): string {
    const cal = calOf(path);
    if (!cal) throw new Error(`нет календаря для ${path}`);
    const v = ++version;
    const etag = `"e${v}"`;
    cal.events.set(path, { etag, ics: text });
    cal.log.push({ path, v });
    return etag;
  }

  const authorized = (req: Request) => req.headers.get('Authorization') === `Basic ${Buffer.from(`${APPLE_ID}:${cloud.password}`).toString('base64')}`;

  function sync(cal: DavCalendar, calPath: string, body: string): Response {
    const token = /<d:sync-token>([^<]*)<\/d:sync-token>/.exec(body)?.[1] ?? '';
    if (token && Number(token.replace('tok-', '')) < validFrom) {
      return new Response(`<?xml version="1.0"?><error xmlns="DAV:"><valid-sync-token/></error>`, { status: 403 });
    }
    const since = token ? Number(token.replace('tok-', '')) : -1;
    const touched = token ? [...new Set(cal.log.filter((l) => l.v > since).map((l) => l.path))] : [...cal.events.keys()];
    const lines = touched.map((path) => {
      const e = cal.events.get(path);
      return e ? ok(path, `<getetag>${e.etag}</getetag>`) : `<response><href>${path}</href><status>HTTP/1.1 404 Not Found</status></response>`;
    });
    // Полная выдача начинается с самого календаря — как у iCloud; его пропускают.
    if (!token) lines.unshift(ok(calPath, '<getetag>"collection"</getetag>'));
    return new Response(multistatus(`${lines.join('')}<sync-token>tok-${version}</sync-token>`), { status: 207 });
  }

  function multiget(cal: DavCalendar, body: string): Response {
    const paths = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1]!);
    const lines = paths.flatMap((path) => {
      const e = cal.events.get(path);
      return e ? [ok(path, `<getetag>${e.etag}</getetag><C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav">${xml(e.ics)}</C:calendar-data>`)] : [];
    });
    return new Response(multistatus(lines.join('')), { status: 207 });
  }

  function propfind(path: string): Response {
    if (path === '/') return new Response(multistatus(ok('/', `<current-user-principal><href>${PRINCIPAL}</href></current-user-principal>`)), { status: 207 });
    if (path === PRINCIPAL) {
      return new Response(
        multistatus(ok(PRINCIPAL, `<C:calendar-home-set xmlns:C="urn:ietf:params:xml:ns:caldav"><href>${HOME}</href></C:calendar-home-set><C:schedule-inbox-URL xmlns:C="urn:ietf:params:xml:ns:caldav"><href>${INBOX}</href></C:schedule-inbox-URL>`)),
        { status: 207 },
      );
    }
    if (path === INBOX) {
      const prop = cloud.defaultSlug ? `<C:schedule-default-calendar-URL xmlns:C="urn:ietf:params:xml:ns:caldav"><href>${HOME}${cloud.defaultSlug}/</href></C:schedule-default-calendar-URL>` : '';
      return new Response(multistatus(ok(INBOX, prop)), { status: 207 });
    }
    if (path === HOME) {
      const comp = (name: string) => `<C:supported-calendar-component-set xmlns:C="urn:ietf:params:xml:ns:caldav"><C:comp name='${name}'/></C:supported-calendar-component-set>`;
      const list = [
        ok(HOME, '<resourcetype><collection/></resourcetype>'),
        ...[...cals].map(([p, c]) => ok(p, `<resourcetype><collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>${xml(c.name)}</displayname>${comp('VEVENT')}<A:calendar-color xmlns:A="http://apple.com/ns/ical/">#1BADF8FF</A:calendar-color><sync-token>tok-${version}</sync-token>`)),
        // Список напоминаний и служебные «входящие» — не календари событий.
        ok(`${HOME}tasks/`, `<resourcetype><collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Напоминания</displayname>${comp('VTODO')}`),
        ok(INBOX, '<resourcetype><collection/><C:schedule-inbox xmlns:C="urn:ietf:params:xml:ns:caldav"/></resourcetype>'),
      ];
      return new Response(multistatus(list.join('')), { status: 207 });
    }
    return new Response('not found', { status: 404 });
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const body = req.method === 'GET' || req.method === 'DELETE' ? '' : await req.text();
    cloud.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (cloud.unreachable) throw new TypeError('fetch failed');
    if (cloud.down) return new Response('unavailable', { status: cloud.down });
    if (`${url.origin}/` === ICLOUD_ENTRY) return new Response(null, { status: 301, headers: { Location: `${ICLOUD_NODE}${url.pathname}` } });
    if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
    const path = url.pathname;
    if (req.method === 'PROPFIND') return propfind(path);
    const cal = cals.get(path) ?? calOf(path);
    if (!cal) return new Response('not found', { status: 404 });
    if (req.method === 'REPORT') return body.includes('sync-collection') ? sync(cal, path, body) : multiget(cal, body);
    const current = cal.events.get(path);
    if (req.method === 'GET') return current ? new Response(current.ics, { headers: { ETag: current.etag } }) : new Response('not found', { status: 404 });
    if (req.method === 'PUT') {
      const ifMatch = req.headers.get('If-Match');
      if (req.headers.get('If-None-Match') === '*' && current) return new Response('exists', { status: 412 });
      const conflict = conflicts.get(path) ?? 0;
      if (ifMatch && conflict) conflicts.set(path, conflict - 1);
      if (ifMatch && (conflict || current?.etag !== ifMatch)) return new Response('changed', { status: 412 });
      return new Response(null, { status: current ? 204 : 201, headers: { ETag: write(path, body) } });
    }
    if (req.method === 'DELETE') {
      if (!current) return new Response('not found', { status: 404 });
      cloud.remove(req.url);
      return new Response(null, { status: 204 });
    }
    return new Response('method', { status: 405 });
  }

  net.on(ICLOUD_ENTRY, handle);
  net.on(`${ICLOUD_NODE}/`, handle);
  return cloud;
}

export type Icloud = ReturnType<typeof icloud>;

// ── Google ──

export const GAPI = 'https://www.googleapis.com/calendar/v3';
const OAUTH = 'https://oauth2.googleapis.com';
export const GMAIL = 'dasha@gmail.com';
export const gcalUrl = (id: string) => `${GAPI}/calendars/${encodeURIComponent(id)}`;
export const geventUrl = (calId: string, id: string) => `${gcalUrl(calId)}/events/${encodeURIComponent(id)}`;

type Stored = GoogleEvent & { v: number };

export interface GRequest {
  method: string;
  url: string;
  body: any;
}

/** Google: основной календарь, свой рабочий и подписка на праздники (только чтение). По 2 календаря и 3 события на страницу. */
export function gcal() {
  let version = 0;
  let created = 0;
  let validFrom = 0;
  const events = new Map<string, Map<string, Stored>>();

  const g = {
    calendars: [
      { id: GMAIL, summary: GMAIL, backgroundColor: '#0b8043', accessRole: 'owner', primary: true },
      { id: 'work@group.calendar.google.com', summary: 'Работа', backgroundColor: '#3f51b5', accessRole: 'owner' },
      { id: 'ru.russian#holiday@group.v.calendar.google.com', summary: 'Праздники', accessRole: 'reader' },
      // «Только занятость» коллеги — без названий событий, не показываем.
      { id: 'boss@company.test', summary: 'Начальник', accessRole: 'freeBusyReader' },
    ] as { id: string; summary: string; backgroundColor?: string; accessRole: string; primary?: boolean }[],
    /** refresh token больше не действует (отозвали доступ) — invalid_grant. */
    revoked: false,
    /** Ответить этим статусом на запросы к календарю. */
    down: null as number | null,
    revokedTokens: [] as string[],
    requests: [] as GRequest[],

    /** Событие завели или поменяли на телефоне. calId 'primary' — основной. Возвращает адрес события в API. */
    put(calId: string, e: GoogleEvent): string {
      const cal = calId === 'primary' ? GMAIL : calId;
      store(cal, { status: 'confirmed', ...e });
      return geventUrl(cal, e.id);
    },
    /** Событие удалили на телефоне (Google помечает cancelled). */
    cancel(calId: string, id: string) {
      const cal = calId === 'primary' ? GMAIL : calId;
      const e = events.get(cal)?.get(id);
      if (e) store(cal, { ...e, status: 'cancelled' });
    },
    event: (calId: string, id: string) => events.get(calId === 'primary' ? GMAIL : calId)?.get(id),
    live: (calId: string) => [...(events.get(calId === 'primary' ? GMAIL : calId)?.values() ?? [])].filter((e) => e.status !== 'cancelled'),
    /** Все выданные жетоны больше не действуют (410) — нужна полная перечитка. */
    expireTokens: () => void (validFrom = ++version),
    sent: (method: string, prefix = GAPI) => g.requests.filter((r) => r.method === method && r.url.startsWith(prefix)),
  };

  function store(cal: string, e: GoogleEvent) {
    const map = events.get(cal) ?? new Map<string, Stored>();
    events.set(cal, map);
    const v = ++version;
    map.set(e.id, { ...e, etag: `"g${v}"`, v });
    return map.get(e.id)!;
  }

  const page = <T,>(list: T[], token: string | null, size: number) => {
    const from = Number(token ?? 0);
    const next = from + size < list.length ? String(from + size) : undefined;
    return { items: list.slice(from, from + size), next };
  };

  async function token(req: Request): Promise<Response> {
    const body = new URLSearchParams(await req.text());
    g.requests.push({ method: req.method, url: req.url, body: Object.fromEntries(body) });
    if (body.get('grant_type') === 'authorization_code') return Response.json({ access_token: 'access-0', refresh_token: 'refresh-1', scope: GOOGLE_SCOPES.join(' ') });
    if (g.revoked) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: 'access-1', expires_in: 3599 });
  }

  async function api(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const text = req.method === 'GET' || req.method === 'DELETE' ? '' : await req.text();
    g.requests.push({ method: req.method, url: req.url, body: text ? JSON.parse(text) : null });
    if (!req.headers.get('Authorization')?.startsWith('Bearer access-')) return Response.json({ error: { code: 401 } }, { status: 401 });
    if (g.down) return Response.json({ error: { code: g.down } }, { status: g.down });
    const parts = url.pathname.replace('/calendar/v3/', '').split('/').map(decodeURIComponent);

    if (parts[0] === 'users') {
      const { items, next } = page(g.calendars, url.searchParams.get('pageToken'), 2);
      return Response.json({ items, ...(next && { nextPageToken: next }) });
    }
    const [, cal = '', , id] = parts;
    const map = events.get(cal) ?? new Map<string, Stored>();
    if (!id && req.method === 'GET') {
      const syncToken = url.searchParams.get('syncToken');
      if (syncToken && Number(syncToken.replace('g-', '')) < validFrom) {
        return Response.json({ error: { code: 410, message: 'Sync token is no longer valid' } }, { status: 410 });
      }
      const since = syncToken ? Number(syncToken.replace('g-', '')) : -1;
      // Полная выдача — без удалённых событий (отменённые разы повторов приходят); по жетону — всё изменившееся.
      const all = [...map.values()].filter((e) => (syncToken ? e.v > since : e.status !== 'cancelled' || e.recurringEventId)).sort((a, b) => a.v - b.v);
      const { items, next } = page(all, url.searchParams.get('pageToken'), 3);
      return Response.json({ items: items.map(({ v: _v, ...e }) => e), ...(next ? { nextPageToken: next } : { nextSyncToken: `g-${version}` }) });
    }
    if (!id && req.method === 'POST') {
      const e = store(cal, { ...JSON.parse(text), id: `lc${++created}`, status: 'confirmed' });
      return Response.json(e);
    }
    const current = map.get(id ?? '');
    if (!current || current.status === 'cancelled') return Response.json({ error: { code: 404 } }, { status: current ? 410 : 404 });
    if (req.method === 'GET') {
      const { v: _v, ...e } = current;
      return Response.json(e);
    }
    if (req.method === 'PATCH') {
      const { v: _v, ...rest } = current;
      return Response.json(store(cal, { ...rest, ...JSON.parse(text) }));
    }
    if (req.method === 'DELETE') {
      store(cal, { ...current, status: 'cancelled' });
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: { code: 405 } }, { status: 405 });
  }

  net.on(`${OAUTH}/token`, token);
  net.on(`${OAUTH}/revoke`, (req) => {
    g.revokedTokens.push(new URL(req.url).searchParams.get('token') ?? '');
    return new Response(null, { status: 200 });
  });
  net.on(`${GAPI}/`, api);
  return g;
}

export type Gcal = ReturnType<typeof gcal>;
