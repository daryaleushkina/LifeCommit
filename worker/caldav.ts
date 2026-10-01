// CalDAV (RFC 4791, 6578) — как Apple iCloud отдаёт и принимает календари. Входа «через Apple»
// для приложений нет, поэтому человек создаёт пароль приложения на appleid.apple.com, и мы ходим
// с ним по Basic-авторизации. В Workers нет DOMParser — ответы (XML multistatus) разбираем по тегам.

export interface DavAuth {
  login: string;
  password: string;
}

export class DavError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Пароль не подошёл (отозван, сменили пароль Apple ID). */
export const isAuthError = (e: unknown) => e instanceof DavError && (e.status === 401 || e.status === 403);

const basic = (a: DavAuth) => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${a.login}:${a.password}`)))}`;

/** Запрос к серверу календаря; переадресации (iCloud отправляет на свой узел pNN-caldav) проходим сами — с тем же методом. */
async function dav(auth: DavAuth, method: string, url: string, body?: string, headers: Record<string, string> = {}): Promise<{ res: Response; url: string }> {
  let target = url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(target, {
      method,
      redirect: 'manual',
      headers: { Authorization: basic(auth), ...(body !== undefined && { 'Content-Type': headers['Content-Type'] ?? 'application/xml; charset=utf-8' }), ...headers },
      body,
    });
    const location = res.headers.get('Location');
    if (res.status >= 300 && res.status < 400 && location) {
      target = new URL(location, target).toString();
      continue;
    }
    return { res, url: target };
  }
  throw new DavError(508, 'too many redirects');
}

async function ok(r: { res: Response; url: string }, what: string): Promise<{ text: string; url: string; res: Response }> {
  const text = await r.res.text();
  if (!r.res.ok && r.res.status !== 207) throw new DavError(r.res.status, `${what}: ${r.res.status} ${text.slice(0, 200)}`);
  return { text, url: r.url, res: r.res };
}

// ── XML без парсера: теги с любыми префиксами пространств имён ──
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]!);
}
const first = (xml: string, name: string): string | null => {
  const b = blocks(xml, name)[0];
  return b === undefined ? null : b;
};
const text = (xml: string, name: string): string | null => {
  const b = first(xml, name);
  return b === null ? null : decode(b).trim();
};
const has = (xml: string, name: string) => new RegExp(`<(?:[\\w-]+:)?${name}\\b`).test(xml);

const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ical="http://apple.com/ns/ical/"';
const propfind = (props: string) => `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`;

export interface Collection {
  url: string;
  name: string;
  color: string | null;
  syncToken: string | null;
}

export interface Account {
  principalUrl: string;
  homeUrl: string;
  /** Календарь по умолчанию — туда пишем наши дела. */
  defaultUrl: string | null;
  collections: Collection[];
}

/**
 * Найти календари человека: главная страница → «кто я» (principal) → где календари (home) → список.
 * Заодно проверяет пароль: не подошёл — DavError 401.
 */
export async function discover(base: string, auth: DavAuth): Promise<Account> {
  const who = await ok(await dav(auth, 'PROPFIND', base, propfind('<d:current-user-principal/>'), { Depth: '0' }), 'principal');
  const principalHref = text(first(who.text, 'current-user-principal') ?? '', 'href');
  if (!principalHref) throw new DavError(500, 'no principal');
  const principalUrl = new URL(principalHref, who.url).toString();

  const me = await ok(await dav(auth, 'PROPFIND', principalUrl, propfind('<c:calendar-home-set/><c:schedule-inbox-URL/>'), { Depth: '0' }), 'home');
  const homeHref = text(first(me.text, 'calendar-home-set') ?? '', 'href');
  if (!homeHref) throw new DavError(500, 'no calendar home');
  const homeUrl = new URL(homeHref, me.url).toString();

  // Календарь по умолчанию (RFC 6638) — свойство «входящих»; нет его — выберем сами.
  let defaultUrl: string | null = null;
  const inboxHref = text(first(me.text, 'schedule-inbox-URL') ?? '', 'href');
  if (inboxHref) {
    try {
      const inbox = await ok(await dav(auth, 'PROPFIND', new URL(inboxHref, me.url).toString(), propfind('<c:schedule-default-calendar-URL/>'), { Depth: '0' }), 'inbox');
      const href = text(first(inbox.text, 'schedule-default-calendar-URL') ?? '', 'href');
      if (href) defaultUrl = new URL(href, inbox.url).toString();
    } catch {
      // не обязательно
    }
  }

  const collections = await listCollections(homeUrl, auth);
  if (!defaultUrl || !collections.some((c) => c.url === defaultUrl)) defaultUrl = pickDefault(collections);
  return { principalUrl, homeUrl, defaultUrl, collections };
}

/** Основной календарь: по привычным названиям, иначе первый. */
export function pickDefault(list: Collection[]): string | null {
  const names = ['календарь', 'calendar', 'дом', 'home', 'личный', 'personal'];
  return (list.find((c) => names.includes(c.name.trim().toLowerCase())) ?? list[0])?.url ?? null;
}

/** Календари с событиями (не списки напоминаний и не служебные папки). */
export async function listCollections(homeUrl: string, auth: DavAuth): Promise<Collection[]> {
  const res = await ok(
    await dav(auth, 'PROPFIND', homeUrl, propfind('<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><ical:calendar-color/><d:sync-token/>'), { Depth: '1' }),
    'collections',
  );
  const out: Collection[] = [];
  for (const r of blocks(res.text, 'response')) {
    const type = first(r, 'resourcetype') ?? '';
    if (!has(type, 'calendar')) continue;
    const comps = first(r, 'supported-calendar-component-set');
    // iCloud пишет атрибуты в одинарных кавычках: <comp name='VEVENT'/>.
    if (comps !== null && comps.trim() && !/name=["']VEVENT["']/i.test(comps)) continue;
    const href = text(r, 'href');
    if (!href) continue;
    out.push({
      url: new URL(href, res.url).toString(),
      name: text(r, 'displayname') || 'Календарь',
      color: (text(r, 'calendar-color') || '').slice(0, 7) || null,
      syncToken: text(r, 'sync-token') || null,
    });
  }
  return out;
}

export interface SyncResult {
  token: string;
  changed: { href: string; etag: string | null }[];
  removed: string[];
}

/** Старый жетон синхронизации больше не принимают — нужна полная перечитка календаря. */
export class SyncTokenExpired extends Error {}

/** Что поменялось в календаре с прошлого раза (RFC 6578). Пустой жетон — всё, что есть. */
export async function syncCollection(url: string, auth: DavAuth, token: string | null): Promise<SyncResult> {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:sync-collection ${NS}><d:sync-token>${token ?? ''}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`;
  const r = await dav(auth, 'REPORT', url, body, { Depth: '1' });
  if ((r.res.status === 403 || r.res.status === 409 || r.res.status === 400) && token) {
    const t = await r.res.text();
    if (/valid-sync-token/i.test(t) || r.res.status !== 403) throw new SyncTokenExpired();
    throw new DavError(r.res.status, t.slice(0, 200));
  }
  const res = await ok(r, 'sync');
  const changed: SyncResult['changed'] = [];
  const removed: string[] = [];
  for (const b of blocks(res.text, 'response')) {
    const href = text(b, 'href');
    if (!href) continue;
    const abs = new URL(href, res.url).toString();
    if (abs.replace(/\/$/, '') === url.replace(/\/$/, '')) continue;
    // Удалённое — статус 404 у самого ответа (без propstat).
    const status = blocks(b, 'status').join(' ');
    if (!has(b, 'propstat') && /\s404\s/.test(status)) removed.push(abs);
    else if (abs.endsWith('.ics') || has(b, 'getetag')) changed.push({ href: abs, etag: text(b, 'getetag') });
  }
  return { token: text(res.text, 'sync-token') ?? token ?? '', changed, removed };
}

/** Тексты событий пачкой. */
export async function multiget(url: string, auth: DavAuth, hrefs: string[]): Promise<{ href: string; etag: string | null; data: string }[]> {
  if (!hrefs.length) return [];
  const list = hrefs.map((h) => `<d:href>${new URL(h).pathname}</d:href>`).join('');
  const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-multiget ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>${list}</c:calendar-multiget>`;
  const res = await ok(await dav(auth, 'REPORT', url, body, { Depth: '1' }), 'multiget');
  const out: { href: string; etag: string | null; data: string }[] = [];
  for (const b of blocks(res.text, 'response')) {
    const href = text(b, 'href');
    const data = text(b, 'calendar-data');
    if (href && data) out.push({ href: new URL(href, res.url).toString(), etag: text(b, 'getetag'), data });
  }
  return out;
}

export async function getEvent(url: string, auth: DavAuth): Promise<{ etag: string | null; data: string }> {
  const r = await ok(await dav(auth, 'GET', url), 'get');
  return { etag: r.res.headers.get('ETag'), data: r.text };
}

/**
 * Записать событие. Новое — «только если такого нет», правка — «только если никто не менял» (ETag),
 * иначе 412: кто-то успел поменять в календаре, сначала заберём его версию.
 */
export async function putEvent(url: string, auth: DavAuth, ics: string, etag: string | null): Promise<string | null> {
  const r = await ok(await dav(auth, 'PUT', url, ics, { 'Content-Type': 'text/calendar; charset=utf-8', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) }), 'put');
  return r.res.headers.get('ETag');
}

export async function deleteEvent(url: string, auth: DavAuth, etag: string | null): Promise<void> {
  const r = await dav(auth, 'DELETE', url, undefined, etag ? { 'If-Match': etag } : {});
  // Уже удалено — тоже хорошо.
  if (!r.res.ok && r.res.status !== 404) throw new DavError(r.res.status, `delete: ${r.res.status}`);
}
