// Проверка прода после деплоя (scripts/postdeploy-check.mjs): адрес, главный скрипт, каждая проверка и повторы.
import { describe, expect, it, vi } from 'vitest';
import { check, checkOnce, mainScript, prodUrl } from './postdeploy-check.mjs';

const BASE = 'https://lifecommit.app';
const HTML = '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-NEW.js"></script></head><body><div id="root"></div></body></html>';

type Reply = { status: number; type?: string; body?: string } | Error;
// Тело байтами: у строки Response сам ставит text/plain, а здесь нужен и ответ совсем без content-type.
const res = (r: { status: number; type?: string; body?: string }) =>
  new Response(new TextEncoder().encode(r.body ?? ''), { status: r.status, headers: r.type ? { 'content-type': r.type } : {} });

/** Прод, который отвечает как надо; patch подменяет ответ по пути. */
function prod(patch: Record<string, Reply> = {}) {
  const ok: Record<string, Reply> = {
    '/': { status: 200, type: 'text/html; charset=utf-8', body: HTML },
    '/assets/index-NEW.js': { status: 200, type: 'application/javascript' },
    '/api/me': { status: 401, type: 'application/json' },
    '/bot/webhook': { status: 403, type: 'text/plain' },
  };
  const table = { ...ok, ...patch };
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const r = table[url.slice(BASE.length)];
    if (!r) throw new Error(`неожиданный запрос ${url}`);
    if (r instanceof Error) throw r;
    return res(r);
  });
}

describe('prodUrl', () => {
  it('POSTDEPLOY_URL важнее wrangler.jsonc, хвостовой / убирается', () => {
    expect(prodUrl({ POSTDEPLOY_URL: 'https://x.workers.dev/' }, '"APP_URL": "https://lifecommit.app"')).toBe('https://x.workers.dev');
  });
  it('иначе APP_URL из wrangler.jsonc', () => {
    expect(prodUrl({}, '{ "vars": { "APP_URL": "https://lifecommit.app/" } }')).toBe('https://lifecommit.app');
  });
  it('нет ни того, ни другого — ошибка, а не проверка «в никуда»', () => {
    expect(() => prodUrl({}, '{}')).toThrow(/не знаю адрес прода/);
    expect(() => prodUrl({}, undefined)).toThrow(/не знаю адрес прода/);
  });
});

describe('mainScript', () => {
  it('скрипт сборки из HTML', () => expect(mainScript(HTML)).toBe('/assets/index-NEW.js'));
  it('нет скрипта /assets — null', () => expect(mainScript('<script src="/src/main.tsx"></script>')).toBeNull());
});

describe('checkOnce', () => {
  it('всё как надо — пусто; вебхук без секрета и пустым телом, API без подписи', async () => {
    const f = prod();
    expect(await checkOnce(BASE, f, '/assets/index-NEW.js')).toEqual([]);
    const hook = f.mock.calls.find(([u]) => u.endsWith('/bot/webhook'))!;
    expect(hook[1]).toMatchObject({ method: 'POST', body: '{}', redirect: 'manual' });
    expect(JSON.stringify(f.mock.calls)).not.toMatch(/secret|authorization|tma /i);
  });

  it('главная не 200', async () => {
    expect(await checkOnce(BASE, prod({ '/': { status: 503, type: 'text/html', body: HTML } }), null)).toContain('главная: 503, ждали 200');
  });
  it('главная не HTML', async () => {
    expect(await checkOnce(BASE, prod({ '/': { status: 200, type: 'application/json', body: HTML } }), null)).toEqual([
      'главная: content-type «application/json», ждали text/html',
    ]);
  });
  it('главная без content-type', async () => {
    expect(await checkOnce(BASE, prod({ '/': { status: 200, body: HTML } }), null)).toContain('главная: content-type «», ждали text/html');
  });
  it('в HTML нет скрипта сборки', async () => {
    expect(await checkOnce(BASE, prod({ '/': { status: 200, type: 'text/html', body: '<p>пусто</p>' } }), null)).toEqual(['главная: в HTML нет скрипта /assets/*.js']);
  });
  it('на проде ещё старая сборка', async () => {
    expect(await checkOnce(BASE, prod(), '/assets/index-OLD.js')).toEqual([
      'главная: отдаётся /assets/index-NEW.js, а собрана /assets/index-OLD.js — новая версия ещё не на проде',
    ]);
  });
  it('сборку не знаем — любая годится', async () => {
    expect(await checkOnce(BASE, prod(), null)).toEqual([]);
  });

  it('скрипт не 200', async () => {
    expect(await checkOnce(BASE, prod({ '/assets/index-NEW.js': { status: 404 } }), null)).toEqual(['скрипт /assets/index-NEW.js: 404, ждали 200']);
  });
  it('вместо скрипта отдали HTML (SPA-заглушка)', async () => {
    expect(await checkOnce(BASE, prod({ '/assets/index-NEW.js': { status: 200, type: 'text/html' } }), null)).toEqual([
      'скрипт /assets/index-NEW.js: content-type «text/html», ждали javascript',
    ]);
  });
  it('скрипт без content-type', async () => {
    expect(await checkOnce(BASE, prod({ '/assets/index-NEW.js': { status: 200 } }), null)).toEqual(['скрипт /assets/index-NEW.js: content-type «», ждали javascript']);
  });

  it('API без подписи — не 401 (упал раньше проверки)', async () => {
    expect(await checkOnce(BASE, prod({ '/api/me': { status: 500 } }), null)).toEqual(['API без подписи: 500, ждали 401']);
  });
  it('вебхук без секрета — не 403', async () => {
    expect(await checkOnce(BASE, prod({ '/bot/webhook': { status: 200 } }), null)).toEqual(['вебхук без секрета: 200, ждали 403']);
  });

  it('сеть: главная не ответила — скрипт не проверяем, остальное проверяем', async () => {
    const f = prod({ '/': new Error('getaddrinfo ENOTFOUND') });
    expect(await checkOnce(BASE, f, null)).toEqual(['главная: сеть — getaddrinfo ENOTFOUND']);
    expect(f.mock.calls.map(([u]) => u.slice(BASE.length))).toEqual(['/', '/api/me', '/bot/webhook']);
  });
  it('сеть: ошибка не Error и сбои по остальным адресам', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/')) return res({ status: 200, type: 'text/html', body: HTML });
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- проверяем разбор не-Error
      throw 'timeout';
    });
    expect(await checkOnce(BASE, f, null)).toEqual(['скрипт: сеть — timeout', 'API: сеть — timeout', 'вебхук: сеть — timeout']);
  });
});

describe('check — повторы', () => {
  it('прошло с первого раза — без пауз', async () => {
    const sleep = vi.fn(async () => {});
    expect(await check({ base: BASE, fetchFn: prod(), sleep })).toEqual({ ok: true, attempts: 1, problems: [] });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('новая версия доехала со второй попытки', async () => {
    let n = 0;
    const old = HTML.replace('index-NEW', 'index-OLD');
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `${BASE}/`) return res({ status: 200, type: 'text/html', body: n++ === 0 ? old : HTML });
      return prod()(url, init);
    });
    const sleep = vi.fn(async () => {});
    const r = await check({ base: BASE, fetchFn: f, expectedScript: '/assets/index-NEW.js', pauseMs: 10, sleep });
    expect(r).toEqual({ ok: true, attempts: 2, problems: [] });
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('так и не прошло — последние проблемы, без паузы после последней попытки', async () => {
    const sleep = vi.fn(async () => {});
    const r = await check({ base: BASE, fetchFn: prod({ '/api/me': { status: 500 } }), tries: 3, sleep });
    expect(r).toEqual({ ok: false, attempts: 3, problems: ['API без подписи: 500, ждали 401'] });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('пауза по умолчанию — настоящая (короткая)', async () => {
    vi.useFakeTimers();
    try {
      const p = check({ base: BASE, fetchFn: prod({ '/api/me': { status: 500 } }), tries: 2, pauseMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect((await p).attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
