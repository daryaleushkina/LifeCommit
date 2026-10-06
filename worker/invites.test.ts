// Ссылки-приглашения для приложений: lifecommit.app/j/<код> и /f/<код> — страница с «Открыть в приложении» и «Открыть
// в Telegram»; плохой код — «Ссылка не работает» (404), в ссылки ничего постороннего не попадает; assetlinks.json для
// Android — JSON без переадресаций.
import { describe, expect, it } from 'vitest';
import worker from './index';
import { ANDROID_APP } from './invites';
import type { Env } from './env';

async function call(path: string, headers: Record<string, string> = {}) {
  const env = { BOT_USERNAME: 'LifeCommit_bot', ASSETS: { fetch: async () => new Response('static', { status: 404 }) } } as unknown as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const res = await worker.fetch(new Request(`https://lifecommit.app${path}`, { headers }), env, ctx);
  return { res, body: await res.text() };
}

const links = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe('приглашение в группу /j/<код>', () => {
  it('страница: в приложение — lifecommit://join/<код>, в Telegram — startapp=g_<код>; язык — как у браузера', async () => {
    const { res, body } = await call('/j/abc234xyz9', { 'accept-language': 'ru-RU' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toContain('Приглашение в группу');
    expect(links(body)).toEqual(['lifecommit://join/abc234xyz9', 'https://t.me/LifeCommit_bot?startapp=g_abc234xyz9']);
    const en = await call('/j/abc234xyz9/', { 'accept-language': 'en-US' });
    expect(en.res.status).toBe(200);
    expect(en.body).toContain('Open in the app');
    expect(links(en.body)[0]).toBe('lifecommit://join/abc234xyz9');
  });

  it('в друзья /f/<код>: lifecommit://friend/<код> и startapp=f_<код>', async () => {
    const { res, body } = await call('/f/j8wuasb95a', { 'accept-language': 'ru' });
    expect(res.status).toBe(200);
    expect(body).toContain('Приглашение в друзья');
    expect(links(body)).toEqual(['lifecommit://friend/j8wuasb95a', 'https://t.me/LifeCommit_bot?startapp=f_j8wuasb95a']);
  });

  it('плохой код — «Ссылка не работает» (404) без ссылок: ни лишнего пути, ни разметки, ни слишком короткого', async () => {
    for (const path of ['/j/ab', '/j/abc/def', `/f/${'a'.repeat(65)}`, '/j/%22onmouseover%3D1', '/f/%3Cscript%3E', '/j/a.b.c.d']) {
      const { res, body } = await call(path, { 'accept-language': 'ru' });
      expect(res.status, path).toBe(404);
      expect(body, path).toContain('Ссылка не работает');
      expect(links(body), path).toEqual([]);
      expect(body, path).not.toMatch(/<script|onmouseover/);
    }
  });
});

describe('assetlinks.json', () => {
  it('Android доверяет ссылкам сайта наше приложение: JSON, без переадресации', async () => {
    const { res, body } = await call('/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(JSON.parse(body)).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'app.lifecommit', sha256_cert_fingerprints: ANDROID_APP.fingerprints },
      },
    ]);
    expect(ANDROID_APP.fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
