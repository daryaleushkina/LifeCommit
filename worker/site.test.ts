// Сайт без языка в адресе (решение владелицы 04.10.2026): lifecommit.app/ — лендинг, /privacy/ и /terms/ — документы.
// Язык — из выбора человека (кука lc-lang), иначе из языка браузера (Accept-Language), иначе русский.
// Старые адреса /ru/… и /en/… ведут на те же страницы без языка и запоминают язык.
import { describe, expect, it } from 'vitest';
import worker from './index';
import { miniAppUrl, pickLang } from './site';
import type { Env } from './env';

/** Worker с подменённой статикой: запоминаем, какой файл сайта он попросил. */
function call(path: string, headers: Record<string, string> = {}, method = 'GET', origin = 'https://lifecommit.app') {
  const asked: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (req: Request) => {
        asked.push(new URL(req.url).pathname);
        return new Response(`<html>${new URL(req.url).pathname}</html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
      },
    },
  } as unknown as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  // Hono отвечает и синхронно (переадресации), и промисом (страница из статики)
  return Promise.resolve(worker.fetch(new Request(`${origin}${path}`, { method, headers }), env, ctx)).then(async (res) => ({ res, asked, body: await res.text() }));
}

describe('miniAppUrl', () => {
  it('мини-апп — /app/ на том же сайте, лишний «/» в конце не мешает', () => {
    expect(miniAppUrl('https://lifecommit.app')).toBe('https://lifecommit.app/app/');
    expect(miniAppUrl('https://lifecommit.app/')).toBe('https://lifecommit.app/app/');
  });
});

describe('pickLang', () => {
  it('выбор человека важнее языка браузера', () => {
    expect(pickLang('lc-lang=en', 'ru-RU,ru;q=0.9')).toBe('en');
    expect(pickLang('theme=dark; lc-lang=ru', 'en-US')).toBe('ru');
  });
  it('без выбора — первый язык браузера: русский и соседние — русский, остальные — английский', () => {
    expect(pickLang(null, 'ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(pickLang(null, 'uk')).toBe('ru');
    expect(pickLang(null, 'KK-kz')).toBe('ru');
    expect(pickLang(null, 'en-US,en;q=0.9,ru;q=0.5')).toBe('en');
    expect(pickLang(null, 'de-DE')).toBe('en');
  });
  it('ничего не известно или мусор — русский', () => {
    expect(pickLang(null, null)).toBe('ru');
    expect(pickLang(null, '')).toBe('ru');
    expect(pickLang(null, '*')).toBe('ru');
    expect(pickLang('lc-lang=xx', null)).toBe('ru');
  });
});

describe('страницы сайта без языка в адресе', () => {
  it('корень — лендинг на языке браузера', async () => {
    const ru = await call('/', { 'accept-language': 'ru-RU' });
    expect(ru.res.status).toBe(200);
    expect(ru.asked).toEqual(['/ru/']);
    expect(ru.res.headers.get('content-language')).toBe('ru');
    // один адрес — два языка: кэш не должен отдать чужой язык
    expect(ru.res.headers.get('vary')).toMatch(/Accept-Language/);
    expect(ru.res.headers.get('vary')).toMatch(/Cookie/);
    expect(ru.res.headers.get('cache-control')).toMatch(/private/);
    const en = await call('/', { 'accept-language': 'en-GB' });
    expect(en.asked).toEqual(['/en/']);
    expect(en.res.headers.get('content-language')).toBe('en');
  });

  it('метки рекламы в адресе не мешают', async () => {
    expect((await call('/?utm_source=threads', { 'accept-language': 'ru' })).asked).toEqual(['/ru/']);
  });

  it('выбранный язык из куки', async () => {
    expect((await call('/', { 'accept-language': 'ru-RU', cookie: 'lc-lang=en' })).asked).toEqual(['/en/']);
  });

  it('документы на том же языке; без «/» на конце — переадресация', async () => {
    expect((await call('/privacy/', { 'accept-language': 'en' })).asked).toEqual(['/en/privacy/']);
    expect((await call('/terms/', { cookie: 'lc-lang=ru' })).asked).toEqual(['/ru/terms/']);
    const bare = await call('/privacy?x=1');
    expect(bare.res.status).toBe(301);
    expect(bare.res.headers.get('location')).toBe('/privacy/?x=1');
    expect(bare.asked).toEqual([]);
  });

  it('HEAD тоже отдаёт страницу', async () => {
    expect((await call('/', { 'accept-language': 'en' }, 'HEAD')).asked).toEqual(['/en/']);
  });
});

describe('старые адреса /ru/ и /en/', () => {
  const cases: [string, string, 'ru' | 'en'][] = [
    ['/ru/', '/', 'ru'],
    ['/ru', '/', 'ru'],
    ['/en/', '/', 'en'],
    ['/ru/privacy/', '/privacy/', 'ru'],
    ['/en/terms/', '/terms/', 'en'],
    ['/en/terms', '/terms/', 'en'],
    ['/ru/unknown/', '/', 'ru'],
    ['/ru/?utm_source=threads', '/?utm_source=threads', 'ru'],
    // старые адреса файлом
    ['/en/privacy/index.html', '/privacy/', 'en'],
    ['/ru/index.html', '/', 'ru'],
  ];
  for (const [from, to, lang] of cases) {
    it(`${from} → ${to}, язык ${lang} запоминается`, async () => {
      const r = await call(from);
      // временная (302), а не постоянная: 301 браузер кэширует и потом не спрашивает — язык перестал бы запоминаться
      expect(r.res.status).toBe(302);
      expect(r.res.headers.get('location')).toBe(to);
      const cookie = r.res.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(new RegExp(`^lc-lang=${lang};`));
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/Max-Age=\d+/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Secure/);
      expect(r.asked).toEqual([]);
    });
  }
});

describe('переключатель языка', () => {
  it('ставит язык и возвращает на ту же страницу сайта', async () => {
    const r = await call('/lang/en?to=/privacy/');
    expect(r.res.status).toBe(302);
    expect(r.res.headers.get('location')).toBe('/privacy/');
    expect(r.res.headers.get('set-cookie')).toMatch(/^lc-lang=en;/);
    expect((await call('/lang/ru')).res.headers.get('location')).toBe('/');
  });

  it('уводит только на свои страницы сайта, а не куда попросили', async () => {
    for (const to of ['https://evil.example/', '//evil.example/', '/api/me', '/app/', '/\\evil.example', 'javascript:alert(1)']) {
      expect((await call(`/lang/en?to=${encodeURIComponent(to)}`)).res.headers.get('location'), to).toBe('/');
    }
  });

  it('на http (локальный стенд) кука без Secure — иначе WebKit её не сохранит', async () => {
    const r = await call('/lang/en?to=/', {}, 'GET', 'http://localhost:5173');
    expect(r.res.headers.get('set-cookie')).toMatch(/^lc-lang=en;/);
    expect(r.res.headers.get('set-cookie')).not.toMatch(/Secure/);
  });

  it('неизвестный язык — 404 и кука не ставится', async () => {
    const r = await call('/lang/de?to=/');
    expect(r.res.status).toBe(404);
    expect(r.res.headers.get('set-cookie')).toBeNull();
  });
});
