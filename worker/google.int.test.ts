// Вход Google: возврат на /google/callback (подписанный state, обмен кода на токены) и подключение POST
// /api/calendars/google/finish. Возврат сам ничего не подключает: итог ждёт под одноразовым кодом, который уходит только
// туда, где дали согласие (кнопка «Вернуться в LifeCommit» → t.me/…?startapp=gcal_<код>, а у входа из приложения —
// lifecommit://calendars?status=ok&pending=<код>). Подключает тот же человек, что начал вход, — чужая ссылка входа не
// подключит календарь жертвы к аккаунту автора ссылки (security-review 06.10.2026). Страницы «почти готово», «не
// дали», «устарела», «не вышло».
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenHash } from './desktop';
import type { Env } from './env';
import { calendarUrl, GOOGLE_SCOPES } from './gcal';
import worker from './index';
import { open, signState } from './secret';
import { ctx, dbReady, env, net, sb, user, type TestUser } from './test/harness';

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
/** Код подключения со страницы: кнопка «Вернуться в LifeCommit» ведёт в мини-апп с startapp=gcal_<код>. */
const codeFromPage = (html: string) => /href="https:\/\/t\.me\/LifeCommit_bot\?startapp=gcal_([A-Za-z0-9_-]+)"/.exec(html)?.[1];
/** Код подключения из перехода в приложение. */
const codeFromApp = (res: { headers: Headers }) => new URL(res.headers.get('location') ?? 'x:').searchParams.get('pending');
const finish = (u: TestUser, pending: unknown) => u.call('POST', '/calendars/google/finish', { pending });
const accounts = async (id: number) => (await sb.from('calendar_accounts').select('id, provider, login, status, secret, default_url').eq('user_id', id)).data ?? [];
const pendings = async (id: number) => (await sb.from('google_pending').select('code_hash, secret, login').eq('user_id', id)).data ?? [];
/** Вход начали в приложении для iPhone, Android или Mac (GET /api/calendars/google/url?client=app). */
const appState = (id: number, ttlMs?: number) => signState(env.CALENDAR_KEY, id, ttlMs, 'app');
const harnessFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = harnessFetch;
  vi.restoreAllMocks();
});

describe.skipIf(!ready)('GET /google/callback', () => {
  it('согласие дано: код меняем на токены, но не подключаем — «почти готово», кнопка ведёт в мини-апп с одноразовым кодом', async () => {
    const u = await user();
    tokens();
    calendars();
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1', scope: GOOGLE_SCOPES.join(' ') });
    expect(res.status).toBe(200);
    expect(title(res.html)).toBe('Почти готово');
    expect(res.html).toContain('<html lang="ru">');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const code = codeFromPage(res.html);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Мини-апп уже открыт — Telegram может не перезапустить его по ссылке с кодом: подсказываем, что делать.
    expect(res.html).toContain('Если LifeCommit уже открыт и ничего не произошло — закройте его и нажмите ещё раз.');

    const exchange = new URLSearchParams(net.calls.find((c) => c.url === TOKEN)!.body);
    expect(Object.fromEntries(exchange)).toEqual({
      code: 'code-1',
      client_id: 'test-google-client',
      client_secret: 'test-google-secret',
      redirect_uri: 'https://lifecommit.test/google/callback',
      grant_type: 'authorization_code',
    });
    // Календарь ещё не подключён; в ожидании — под отпечатком кода (самого кода в базе нет), refresh token — шифром.
    expect(await accounts(u.id)).toEqual([]);
    const [p] = await pendings(u.id);
    expect(p).toMatchObject({ code_hash: await tokenHash(code!), login: 'dasha@gmail.com' });
    expect(p!.secret).not.toContain('refresh-1');
    expect(await open(env.CALENDAR_KEY, p!.secret)).toBe('refresh-1');
  });

  it('подключает тот же человек кодом: календари сохранены, «setup»; код одноразовый', async () => {
    const u = await user();
    tokens();
    calendars();
    const code = codeFromPage((await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' })).html);
    const res = await finish(u, code);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fresh: true });
    const [acc] = await accounts(u.id);
    expect(acc).toMatchObject({ id: res.body.account_id, provider: 'google', login: 'dasha@gmail.com', status: 'setup', default_url: calendarUrl('dasha@gmail.com') });
    expect(await open(env.CALENDAR_KEY, acc!.secret)).toBe('refresh-1');
    const { data: cols } = await sb.from('calendar_collections').select('name, enabled').eq('account_id', acc!.id).order('name');
    expect(cols).toEqual([{ name: 'dasha@gmail.com', enabled: true }, { name: 'Семья', enabled: false }]);
    expect(await pendings(u.id)).toEqual([]);
    expect(await finish(u, code)).toMatchObject({ status: 404, body: { error: 'pending_not_found' } });
  });

  it('уже подключён — подключение «снова» (fresh: false), календари и выбор не трогаем; страница по-английски', async () => {
    const u = await user({ lang: 'en' });
    tokens();
    calendars();
    await finish(u, codeFromPage((await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' })).html));
    await sb.from('calendar_accounts').update({ status: 'ok' }).eq('user_id', u.id);
    const again = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-2' });
    expect(title(again.html)).toBe('Almost done');
    expect(again.html).toContain('<html lang="en">');
    expect(again.html).toContain('Back to LifeCommit');
    const res = await finish(u, codeFromPage(again.html));
    expect(res).toMatchObject({ status: 200, body: { fresh: false } });
    expect((await accounts(u.id))[0]?.status).toBe('ok');
  });

  it('чужая ссылка: жертва дала согласие по ссылке автора — её клиент кодом не подключит, а у автора кода нет', async () => {
    const author = await user();
    const victim = await user();
    tokens();
    calendars();
    // Автор взял адрес входа для себя и прислал жертве; жертва открыла и согласилась — код ушёл к ней.
    const { body } = await author.call('GET', '/calendars/google/url');
    const state = new URL(body.url).searchParams.get('state')!;
    const code = codeFromPage((await callback({ state, code: 'victim-code' })).html);
    // Её мини-апп или приложение отправит код своим ключом — отказ, никому ничего не подключено, и код сгорел: даже
    // если автор потом как-то его узнает (лог, чужое приложение на её телефоне), подключить им уже нечего.
    expect(await finish(victim, code)).toMatchObject({ status: 404, body: { error: 'pending_not_found' } });
    expect(await pendings(author.id)).toEqual([]);
    expect(await finish(author, code)).toMatchObject({ status: 404, body: { error: 'pending_not_found' } });
    // У автора кода нет: подобрать или прислать чужой — тот же отказ.
    expect(await finish(author, 'A'.repeat(43))).toMatchObject({ status: 404, body: { error: 'pending_not_found' } });
    expect(await accounts(author.id)).toEqual([]);
    expect(await accounts(victim.id)).toEqual([]);
  });

  it('два подключения одним кодом наперегонки — ровно одно удаётся', async () => {
    const u = await user();
    tokens();
    calendars();
    const code = codeFromPage((await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' })).html);
    const results = await Promise.all(Array.from({ length: 8 }, () => finish(u, code)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 404, 404, 404, 404, 404, 404, 404]);
    expect(await accounts(u.id)).toHaveLength(1);
  });

  it('подключение не сохранилось (сбой базы) — 500, а код не сгорел: можно ещё раз', async () => {
    const u = await user();
    tokens();
    calendars();
    const code = codeFromPage((await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' })).html);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.startsWith(`${env.SUPABASE_URL}/rest/v1/calendar_accounts`) && req.method === 'POST') return Response.json({ code: 'XX000', message: 'база недоступна' }, { status: 500 });
      return harnessFetch(req);
    }) as typeof fetch;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await finish(u, code)).status).toBe(500);
    expect(errors).toHaveBeenCalledWith('google finish: save failed', u.id, expect.anything());
    globalThis.fetch = harnessFetch;
    expect(await finish(u, code)).toMatchObject({ status: 200, body: { fresh: true } });
  });

  it('код старше 15 минут — 410 «ссылка устарела», ожидание стёрто; неверный ввод — 400', async () => {
    const u = await user();
    tokens();
    calendars();
    const code = codeFromPage((await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' })).html);
    await sb.from('google_pending').update({ created_at: new Date(Date.now() - 16 * 60_000).toISOString() }).eq('user_id', u.id);
    expect(await finish(u, code)).toMatchObject({ status: 410, body: { error: 'pending_expired' } });
    expect(await pendings(u.id)).toEqual([]);
    expect(await accounts(u.id)).toEqual([]);
    for (const bad of [undefined, 42, '', 'короткий', 'x'.repeat(200), 'a b']) {
      expect({ bad, res: await finish(u, bad) }).toMatchObject({ bad, res: { status: 400, body: { error: 'bad_pending' } } });
    }
  });

  it('отжившие ожидания (старше 15 минут) убирает следующий возврат из Google, свежие — остаются и подключаются', async () => {
    const [stale, fresh, third] = [await user(), await user(), await user()];
    tokens();
    calendars();
    await callback({ state: await signState(env.CALENDAR_KEY, stale.id), code: 'code-1' });
    const freshCode = codeFromPage((await callback({ state: await signState(env.CALENDAR_KEY, fresh.id), code: 'code-2' })).html);
    await sb.from('google_pending').update({ created_at: new Date(Date.now() - 16 * 60_000).toISOString() }).eq('user_id', stale.id);
    await sb.from('google_pending').update({ created_at: new Date(Date.now() - 14 * 60_000).toISOString() }).eq('user_id', fresh.id);
    await callback({ state: await signState(env.CALENDAR_KEY, third.id), code: 'code-3' });
    expect(await pendings(stale.id)).toEqual([]);
    expect(await pendings(fresh.id)).toHaveLength(1);
    expect(await finish(fresh, freshCode)).toMatchObject({ status: 200, body: { fresh: true } });
  });

  it('уборка не вышла — вход всё равно заканчивается «почти готово» с кодом, сбой в логе', async () => {
    const u = await user();
    tokens();
    calendars();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.startsWith(`${env.SUPABASE_URL}/rest/v1/google_pending`) && req.method === 'DELETE') return Response.json({ code: 'XX000', message: 'база недоступна' }, { status: 500 });
      return harnessFetch(req);
    }) as typeof fetch;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' });
    expect(title(res.html)).toBe('Почти готово');
    expect(codeFromPage(res.html)).toBeTruthy();
    expect(errors).toHaveBeenCalledWith('google_pending cleanup failed', 'база недоступна');
  });

  it('человек отказал на экране Google (нет кода) — «доступ не дали», в Google не ходим', async () => {
    const u = await user();
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), error: 'access_denied' });
    expect(res.status).toBe(200);
    expect(title(res.html)).toBe('Доступ не дали');
    // Без кода подключения: кнопка просто ведёт в «Календари».
    expect(res.html).toContain('href="https://t.me/LifeCommit_bot?startapp=calendars"');
    expect(res.html).not.toContain('gcal_');
    expect(net.calls).toEqual([]);
    expect(await pendings(u.id)).toEqual([]);
  });

  it('сняли галочку доступа к событиям — «доступ не дали», ничего не сохраняем', async () => {
    const u = await user();
    tokens({ scope: GOOGLE_SCOPES[1] });
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' });
    expect(res.status).toBe(200);
    expect(title(res.html)).toBe('Доступ не дали');
    expect(await pendings(u.id)).toEqual([]);
  });

  it('Google не ответил как надо — 502 «не получилось»', async () => {
    const u = await user();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    net.on(TOKEN, () => Response.json({ error: 'server_error' }, { status: 500 }));
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' });
    expect(res.status).toBe(502);
    expect(title(res.html)).toBe('Не получилось подключить');
    expect(res.html).toContain('<div class="mark">!</div>');
    expect(await pendings(u.id)).toEqual([]);
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

  it('база не ответила, чей это state, — 502 «не получилось», а не «ссылка устарела»', async () => {
    const u = await user();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.startsWith(`${env.SUPABASE_URL}/rest/v1/users`)) return Response.json({ code: 'XX000', message: 'база недоступна' }, { status: 500 });
      return harnessFetch(req);
    }) as typeof fetch;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' });
    expect(res.status).toBe(502);
    expect(title(res.html)).toBe('Не получилось подключить');
    expect(errors).toHaveBeenCalledWith('google callback: user lookup failed', u.id, 'база недоступна');
    const app = await callback({ state: await appState(u.id), code: 'code-1' });
    expect(app.status).toBe(302);
    expect(app.headers.get('location')).toBe('lifecommit://calendars?status=failed');
    expect(net.calls).toEqual([]);
  });

  it('ожидание не записалось — 502 «не получилось», в лог', async () => {
    const u = await user();
    tokens();
    calendars();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.startsWith(`${env.SUPABASE_URL}/rest/v1/google_pending`) && req.method === 'POST') return Response.json({ code: 'XX000', message: 'база недоступна' }, { status: 500 });
      return harnessFetch(req);
    }) as typeof fetch;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' });
    expect(res.status).toBe(502);
    expect(title(res.html)).toBe('Не получилось подключить');
    expect(errors).toHaveBeenCalled();
  });

  it('без ключа календарей state не проверить — 400', async () => {
    const u = await user();
    const res = await callback({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' }, { CALENDAR_KEY: '' });
    expect(res.status).toBe(400);
    expect(title(res.html)).toBe('Ссылка устарела');
  });
});

// Вход Google из приложения (iPhone, Android, Mac): тот же обмен кода, но вместо страницы с кнопкой «Вернуться в
// Telegram» — переход в приложение lifecommit://calendars?status=…, при успехе — с одноразовым кодом (docs/mobile.md).
// Метка «из приложения» подписана вместе с id и сроком — подделать её нельзя.
describe.skipIf(!ready)('GET /google/callback — вход начат в приложении', () => {
  const back = (res: { status: number; headers: Headers }) => (res.status === 302 ? res.headers.get('location')!.replace(/&pending=[^&]+$/, '&pending=…') : `HTTP ${res.status}`);

  it('согласие дано — 302 на lifecommit://calendars?status=ok&pending=<код>; приложение тем же человеком подключает', async () => {
    const u = await user();
    tokens();
    calendars();
    const res = await callback({ state: await appState(u.id), code: 'code-1' });
    expect(back(res)).toBe('lifecommit://calendars?status=ok&pending=…');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.html).toBe('');
    const code = codeFromApp(res);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await accounts(u.id)).toEqual([]);
    expect(await finish(u, code)).toMatchObject({ status: 200, body: { fresh: true } });
    expect((await accounts(u.id))[0]).toMatchObject({ provider: 'google', login: 'dasha@gmail.com', status: 'setup' });
  });

  it('отказали — denied; сняли галочку событий — denied; Google сломался — failed; кода нет', async () => {
    const v = await user();
    expect(back(await callback({ state: await appState(v.id), error: 'access_denied' }))).toBe('lifecommit://calendars?status=denied');
    tokens({ scope: GOOGLE_SCOPES[1] });
    expect(back(await callback({ state: await appState(v.id), code: 'code-1' }))).toBe('lifecommit://calendars?status=denied');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    net.on(TOKEN, () => Response.json({ error: 'server_error' }, { status: 500 }));
    expect(back(await callback({ state: await appState(v.id), code: 'code-1' }))).toBe('lifecommit://calendars?status=failed');
    expect(await pendings(v.id)).toEqual([]);
  });

  it('ссылка устарела — status=expired; метку приложения к чужой подписи не приписать — страница 400, в приложение не ведём', async () => {
    const u = await user();
    expect(back(await callback({ state: await appState(u.id, -1000), code: 'code-1' }))).toBe('lifecommit://calendars?status=expired');
    const [id, exp, sig] = (await signState(env.CALENDAR_KEY, u.id)).split('.');
    const forged = await callback({ state: `${id}.${exp}.app.${sig}`, code: 'code-1' });
    expect(forged.status).toBe(400);
    expect(title(forged.html)).toBe('Ссылка устарела');
    // подписан верно, но такого человека нет
    expect(back(await callback({ state: await appState(8_999_999_999_999), code: 'code-1' }))).toBe('lifecommit://calendars?status=expired');
    expect(net.calls).toEqual([]);
  });
});
