// Сайт без языка в адресе (решение владелицы 04.10.2026): lifecommit.app/ — лендинг, /privacy/ и /terms/ — документы.
// Файлы страниц лежат в сборке как /ru/… и /en/…; какой отдать, решает Worker: выбор человека (кука lc-lang,
// ставит переключатель RU · EN), иначе первый язык браузера, иначе русский. Старые адреса /ru/… и /en/… (ссылки
// в сторах, проверке Google, у людей) ведут на те же страницы без языка и запоминают язык. Мини-апп — /app/.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from './env';

export type Lang = 'ru' | 'en';

/** Адрес мини-аппа для кнопок web_app: /app/ на том же сайте (корень — лендинг). */
export const miniAppUrl = (origin: string) => `${origin.replace(/\/+$/, '')}/app/`;

/** Страницы сайта по адресу без языка. */
const PAGES = ['/', '/privacy/', '/terms/'];
const isPage = (p: string | undefined): p is string => p !== undefined && PAGES.includes(p);
// Русский и языки, на которых обычно читают по-русски.
const NEAR_RU = /^(ru|uk|be|kk|uz|ky|tg|hy|az|ka)\b/;
const YEAR = 365 * 24 * 60 * 60;

/** Язык страницы: кука lc-lang (ru|en) → первый язык из Accept-Language → русский. */
export function pickLang(cookie: string | null, acceptLanguage: string | null): Lang {
  const chosen = /(?:^|;\s*)lc-lang=(ru|en)(?:;|$)/.exec(cookie ?? '')?.[1];
  if (chosen === 'ru' || chosen === 'en') return chosen;
  const first = (acceptLanguage ?? '').split(',')[0]!.split(';')[0]!.trim().toLowerCase();
  if (!first || first === '*') return 'ru';
  return NEAR_RU.test(first) ? 'ru' : 'en';
}

// Secure — только на https: на локальном стенде (http://localhost) WebKit такую куку не сохраняет
const remember = (lang: Lang, https: boolean) => `lc-lang=${lang}; Path=/; Max-Age=${YEAR}; SameSite=Lax${https ? '; Secure' : ''}`;
const redirect = (to: string, status: 301 | 302, lang?: { lang: Lang; url: string }) =>
  new Response(null, {
    status,
    headers: { location: to, ...(lang ? { 'set-cookie': remember(lang.lang, new URL(lang.url).protocol === 'https:') } : {}) },
  });

export const site = new Hono<{ Bindings: Env }>();

/** Страница сайта на языке человека — файл /ru/… или /en/… из статики под адресом без языка. */
async function page(c: Context<{ Bindings: Env }>, path: string) {
  const lang = pickLang(c.req.header('cookie') ?? null, c.req.header('accept-language') ?? null);
  const url = new URL(c.req.url);
  url.pathname = `/${lang}${path}`;
  url.search = '';
  const file = await c.env.ASSETS.fetch(new Request(url, c.req.raw));
  const res = new Response(file.body, file);
  res.headers.set('content-language', lang);
  // один адрес — два языка: общий кэш не должен отдать одному человеку язык другого
  res.headers.append('vary', 'Accept-Language, Cookie');
  res.headers.set('cache-control', 'private, no-cache');
  return res;
}

for (const p of PAGES) {
  site.get(p, (c) => page(c, p));
  if (p !== '/') site.get(p.slice(0, -1), (c) => redirect(p + new URL(c.req.url).search, 301));
}

/** /ru/privacy/ (и /ru/privacy/index.html) → /privacy/, язык ru запоминается; неизвестная страница — на корень.
 *  Временная переадресация (302): постоянную браузер кэширует и больше не спрашивает — кука перестала бы ставиться. */
function old(c: Context<{ Bindings: Env }>) {
  const url = new URL(c.req.url);
  const [, lang, ...rest] = url.pathname.split('/');
  const parts = rest.filter((p) => p && p !== 'index.html');
  const path = parts.length ? `/${parts.join('/')}/` : '/';
  return redirect((isPage(path) ? path : '/') + url.search, 302, { lang: lang === 'en' ? 'en' : 'ru', url: c.req.url });
}
for (const p of ['/ru', '/ru/*', '/en', '/en/*']) site.get(p, old);

/** Переключатель RU · EN: запомнить язык и вернуть на ту же страницу сайта (только на свою — не открытая переадресация). */
site.get('/lang/:lang', (c) => {
  const lang = c.req.param('lang');
  if (lang !== 'ru' && lang !== 'en') return c.notFound();
  const to = c.req.query('to');
  return redirect(isPage(to) ? to : '/', 302, { lang, url: c.req.url });
});
