// Возврат из входа Google: подписанный state, обмен кода на токены, страницы «подключён», «снова», «не дали», «устарела», «не вышло».
import { describe, expect, it } from 'vitest';
import type { Env } from './env';
import { GOOGLE_SCOPES } from './gcal';
import worker from './index';
import { signState } from './secret';
import { ctx, dbReady, env, net, sb, user } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('google-тесты пропущены: нет локальной Supabase (pnpm db:start)');

const TOKEN = 'https://oauth2.googleapis.com/token';
const CAL_LIST = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';

/** Браузер возвращается из Google на /google/callback. */
async function callback(query: Record<string, string>, patch: Partial<Env> = {}) {
  const c = ctx();
  const res = await worker.fetch(new Request(`https://lifecommit.test/google/callback?${new URLSearchParams(query)}`), { ...env, ...patch }, c as unknown as ExecutionContext);
  await c.settle();
  return { status: res.status, headers: res.headers, html: await res.text() };
}

/** Google выдаёт токены (по умолчанию — со всеми нужными правами). */
const tokens = (more: object = {}) => net.on(TOKEN, () => Response.json({ access_token: 'access-1', refresh_token: 'refresh-1', scope: GOOGLE_SCOPES.join(' '), ...more }));
const calendars = () =>
  net.on(CAL_LIST, () =>
    Response.json({
      items: [
        { id: 'dasha@gmail.com', summary: 'dasha@gmail.com', backgroundColor: '#0b8043', accessRole: 'owner', primary: true },
        { id: 'family@group.calendar.google.com', summary: 'Семья', accessRole: 'writer' },
      ],
    }),
  );

const title = (html: string) => /<h1>(.*?)<\/h1>/.exec(html)?.[1];

describe.skipIf(!ready)('GET /google/callback', () => {
  it('первое подключение: код меняем на токены, календари сохраняем, страница «подключён»', async () => {
    const u = await user();
    tokens();
    calendars();
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1', scope: GOOGLE_SCOPES.join(' ') });
    expect(res.status).toBe(200);
    expect(title(res.html)).toBe('Google Календарь подключён');
    expect(res.html).toContain('<html lang="ru">');
    expect(res.html).toContain('href="https://t.me/LifeCommit_bot?startapp=calendars"');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');

    const exchange = new URLSearchParams(net.calls.find((c) => c.url === TOKEN)!.body);
    expect(Object.fromEntries(exchange)).toEqual({
      code: 'code-1',
      client_id: 'test-google-client',
      client_secret: 'test-google-secret',
      redirect_uri: 'https://lifecommit.test/google/callback',
      grant_type: 'authorization_code',
    });
    const { data: acc } = await sb.from('calendar_accounts').select('id, provider, login, status, secret').eq('user_id', u.id).single();
    expect(acc).toMatchObject({ provider: 'google', login: 'dasha@gmail.com', status: 'setup' });
    // refresh token — только зашифрованным
    expect(acc!.secret).not.toContain('refresh-1');
    const { data: cols } = await sb.from('calendar_collections').select('name').eq('account_id', acc!.id).order('name');
    expect(cols?.map((c) => c.name)).toEqual(['dasha@gmail.com', 'Семья']);
  });

  it('уже подключён — «снова подключён», календари не трогаем', async () => {
    const u = await user({ lang: 'en' });
    tokens();
    calendars();
    await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' });
    await sb.from('calendar_accounts').update({ status: 'ok' }).eq('user_id', u.id);
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-2' });
    expect(res.status).toBe(200);
    expect(title(res.html)).toBe('Google Calendar reconnected');
    expect(res.html).toContain('<html lang="en">');
    expect(res.html).toContain('Back to LifeCommit');
    const { data } = await sb.from('calendar_accounts').select('status').eq('user_id', u.id).single();
    expect(data?.status).toBe('ok');
  });

  it('человек отказал на экране Google (нет кода) — «доступ не дали», в Google не ходим', async () => {
    const u = await user();
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), error: 'access_denied' });
    expect(res.status).toBe(200);
    expect(title(res.html)).toBe('Доступ не дали');
    expect(net.calls).toEqual([]);
  });

  it('сняли галочку доступа к событиям — «доступ не дали», ничего не сохраняем', async () => {
    const u = await user();
    tokens({ scope: GOOGLE_SCOPES[1] });
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' });
    expect(res.status).toBe(200);
    expect(title(res.html)).toBe('Доступ не дали');
    expect((await sb.from('calendar_accounts').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('Google не ответил как надо — 502 «не получилось»', async () => {
    const u = await user();
    net.on(TOKEN, () => Response.json({ error: 'server_error' }, { status: 500 }));
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' });
    expect(res.status).toBe(502);
    expect(title(res.html)).toBe('Не получилось подключить');
    expect(res.html).toContain('<div class="mark">!</div>');
  });

  it('state устарел, подделан, пуст или чужого человека — 400 «ссылка устарела»', async () => {
    const u = await user();
    const good = await signState(env.CALENDAR_KEY, u.id);
    const [id, exp] = good.split('.');
    const states = [
      await signState(env.CALENDAR_KEY, u.id, -1000),
      `${id}.${exp}.bad-signature`,
      // подпись от другого id
      `${Number(id) + 1}.${exp}.${good.split('.')[2]}`,
      '',
      'garbage',
      // подписан верно, но такого человека нет
      await signState(env.CALENDAR_KEY, 8_999_999_999_999),
    ];
    for (const state of states) {
      const res = await callback({ state, code: 'code-1' });
      expect(res.status).toBe(400);
      expect(title(res.html)).toBe('Ссылка устарела');
    }
    expect((await callback({ code: 'code-1' })).status).toBe(400);
    expect(net.calls).toEqual([]);
  });

  it('без ключа календарей state не проверить — 400', async () => {
    const u = await user();
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' }, { CALENDAR_KEY: '' });
    expect(res.status).toBe(400);
    expect(title(res.html)).toBe('Ссылка устарела');
  });
});
