// Вход на компьютере (приложение для Mac и браузер): компьютер берёт секрет, человек подтверждает вход в мини-аппе
// по ссылке t.me/<бот>?startapp=mac_<код>, компьютер забирает ключ сессии и ходит с ним вместо подписи Telegram.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { botUpdate, dbReady, env, request, sb, tg, user, type Res } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('desktop-тесты пропущены: нет локальной Supabase (pnpm db:start)');

interface Started {
  secret: string;
  code: string;
  ticket: string;
  link: string;
}

const post = <T = any,>(path: string, body: unknown, headers: Record<string, string> = {}) =>
  request<T>(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const start = async (device = 'mac') => (await post<Started>('/desktop/login', { device })).body;
const poll = (secret: string) => post<{ status: 'pending' } | { status: 'ok'; token: string }>('/desktop/login/poll', { secret });

/** Запрос к API с ключом компьютера. */
const asDesktop = <T = any,>(token: string, method: string, path: string, body?: unknown): Promise<Res<T>> =>
  request<T>(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

/** Войти на компьютере от имени человека целиком: начать, подтвердить в Telegram, забрать ключ. */
async function login(u: Awaited<ReturnType<typeof user>>, device = 'mac'): Promise<string> {
  const s = await start(device);
  expect((await u.call('POST', '/desktop/approve', { ticket: s.ticket, device })).status).toBe(200);
  const res = await poll(s.secret);
  if (res.body.status !== 'ok') throw new Error(`вход не удался: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

describe.skipIf(!ready)('вход на компьютере', () => {
  it('начать вход можно без Telegram: секрет, код и ссылка на мини-апп; в базу ничего не пишется', async () => {
    const res = await post<Started>('/desktop/login', { device: 'mac' });
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // В ссылке — код, время выдачи и подпись сервера: ссылка живёт 10 минут от выдачи, подделать её нельзя.
    expect(res.body.ticket).toMatch(new RegExp(`^${res.body.code.replace(/[-]/g, '\\-')}[0-9a-z]{7}[A-Za-z0-9_-]{22}$`));
    // Ссылка ведёт в чат с ботом: подтвердить вход можно прямо там, не открывая мини-апп (решение владелицы 05.10.2026).
    expect(res.body.link).toBe(`https://t.me/LifeCommit_bot?start=mac_${res.body.ticket}`);
    expect(res.body.link.length - res.body.link.indexOf('=') - 1).toBeLessThanOrEqual(64);
    // Код — отпечаток секрета: по ссылке ключ не забрать, а у двух входов коды разные.
    expect(res.body.code).not.toBe((await start()).code);
    expect((await sb.from('desktop_logins').select('code').eq('code', res.body.code)).data).toEqual([]);
    // Из браузера — ссылка другая: мини-апп скажет «в браузере», а не «на Mac».
    expect((await start('web')).link).toMatch(/\?start=web_[A-Za-z0-9_-]{51}$/);
  });

  it('пока в Telegram не подтвердили — «ждём»; подтвердили — ключ, и он работает как вход через Telegram', async () => {
    const u = await user({ name: 'Даша' });
    const s = await start();
    expect((await poll(s.secret)).body).toEqual({ status: 'pending' });

    const approved = await u.call('POST', '/desktop/approve', { ticket: s.ticket, device: 'mac' });
    expect(approved).toEqual({ status: 200, body: { ok: true } });

    const got = await poll(s.secret);
    expect(got.status).toBe(200);
    if (got.body.status !== 'ok') throw new Error('нет ключа');
    expect(got.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Сессия компьютера: тот же человек, профиль из Telegram не затирается (имени у ключа нет).
    const session = await asDesktop(got.body.token, 'POST', '/session', { timezone: 'Asia/Ho_Chi_Minh' });
    expect(session.status).toBe(200);
    expect(session.body.user).toMatchObject({ id: u.id, first_name: 'Даша', username: `u${u.id}`, timezone: 'Asia/Ho_Chi_Minh' });
    expect(session.body).toMatchObject({ start_param: null, is_new: false });
    expect((await asDesktop(got.body.token, 'POST', '/tasks', { title: 'Читать', kind: 'check', target: 1 })).status).toBe(201);
    const today = await u.call('GET', '/today');
    expect(today.body.tasks.map((t: { title: string }) => t.title)).toEqual(['Читать']);

    // Ключ выдаётся один раз: второй опрос — «уже забрано» (ответ с ключом мог потеряться — компьютер скажет «не
    // получилось», а не будет ждать 10 минут); подтверждение остаётся до конца срока ссылки, чтобы её нельзя было
    // подтвердить ещё раз.
    expect((await poll(s.secret)).body).toEqual({ status: 'claimed' });
    expect((await sb.from('desktop_logins').select('claimed_at').eq('code', s.code)).data).toEqual([{ claimed_at: expect.any(String) }]);
    // В базе — только отпечаток ключа.
    const { data } = await sb.from('desktop_sessions').select('token_hash, device').eq('user_id', u.id);
    expect(data).toEqual([{ token_hash: expect.stringMatching(/^[0-9a-f]{64}$/), device: 'mac' }]);
    expect(data?.[0]?.token_hash).not.toContain(got.body.token);
  });

  it('неверный ввод — 400 с кодом, а не 500', async () => {
    const u = await user();
    expect((await post('/desktop/login', { device: 'phone' })).body).toEqual({ error: 'bad_request' });
    expect((await post('/desktop/login', 'mac')).status).toBe(400);
    expect((await post('/desktop/login/poll', { secret: 'короткий' })).body).toEqual({ error: 'bad_request' });
    expect((await post('/desktop/login/poll', { secret: 42 })).status).toBe(400);
    expect((await post('/desktop/login/poll', [])).status).toBe(400);
    const notJson = await request('/api/desktop/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{не json' });
    expect(notJson).toEqual({ status: 400, body: { error: 'bad_request' } });
    expect((await u.call('POST', '/desktop/approve', { ticket: 'abc', device: 'mac' })).body).toEqual({ error: 'bad_request' });
    expect((await u.call('POST', '/desktop/approve', { ticket: (await start()).ticket, device: 'tv' })).body).toEqual({ error: 'bad_request' });
    expect((await u.call('POST', '/desktop/approve', null)).status).toBe(400);
  });

  it('подтвердить можно только через Telegram: без подписи — 401, ключом компьютера — 403', async () => {
    const u = await user();
    const s = await start();
    expect((await post('/desktop/approve', { ticket: s.ticket, device: 'mac' })).status).toBe(401);
    const token = await login(u);
    const res = await asDesktop(token, 'POST', '/desktop/approve', { ticket: s.ticket, device: 'mac' });
    expect(res).toEqual({ status: 403, body: { error: 'telegram_only' } });
    expect((await poll(s.secret)).body).toEqual({ status: 'pending' });
  });

  it('один код — один вход: второй человек тот же код не перехватит', async () => {
    const owner = await user();
    const other = await user();
    const s = await start();
    expect((await owner.call('POST', '/desktop/approve', { ticket: s.ticket, device: 'mac' })).status).toBe(200);
    expect(await other.call('POST', '/desktop/approve', { ticket: s.ticket, device: 'mac' })).toEqual({ status: 409, body: { error: 'login_used' } });
    const got = await poll(s.secret);
    if (got.body.status !== 'ok') throw new Error('нет ключа');
    expect((await asDesktop(got.body.token, 'POST', '/session', {})).body.user.id).toBe(owner.id);
  });

  it('ссылка живёт 10 минут от выдачи: старую не подтвердить, даже если её никто не трогал', async () => {
    const u = await user();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 11 * 60_000);
    const old = await start();
    clock.mockRestore();
    expect(await u.call('POST', '/desktop/approve', { ticket: old.ticket, device: 'mac' })).toEqual({ status: 410, body: { error: 'login_expired' } });
    expect((await poll(old.secret)).body).toEqual({ status: 'pending' });
  });

  it('подделанная ссылка — отказ: чужая подпись, другое устройство, сдвинутое время', async () => {
    const u = await user();
    const s = await start('mac');
    const forged = (t: string) => u.call('POST', '/desktop/approve', { ticket: t, device: 'mac' });
    const flip = (ch: string) => (ch === 'A' ? 'B' : 'A');
    expect(await forged(s.ticket.slice(0, -1) + flip(s.ticket.at(-1)!))).toEqual({ status: 400, body: { error: 'bad_request' } });
    expect(await u.call('POST', '/desktop/approve', { ticket: s.ticket, device: 'web' })).toEqual({ status: 400, body: { error: 'bad_request' } });
    const later = (parseInt(s.ticket.slice(22, 29), 36) + 600).toString(36).padStart(7, '0');
    expect(await forged(s.ticket.slice(0, 22) + later + s.ticket.slice(29))).toEqual({ status: 400, body: { error: 'bad_request' } });
    expect((await poll(s.secret)).body).toEqual({ status: 'pending' });
  });

  it('ключ забрали — та же ссылка второй раз не подтверждается: одна ссылка — один вход', async () => {
    const owner = await user();
    const victim = await user();
    const s = await start();
    expect((await owner.call('POST', '/desktop/approve', { ticket: s.ticket, device: 'mac' })).status).toBe(200);
    expect((await poll(s.secret)).body).toMatchObject({ status: 'ok' });
    expect(await victim.call('POST', '/desktop/approve', { ticket: s.ticket, device: 'mac' })).toEqual({ status: 409, body: { error: 'login_used' } });
    expect((await poll(s.secret)).body).toEqual({ status: 'claimed' });
    expect((await sb.from('desktop_sessions').select('id').eq('user_id', victim.id)).data).toEqual([]);
  });

  it('новый вход — бот пишет тому аккаунту, кто подтвердил: «Не вы? — Выйти везде»', async () => {
    const u = await user();
    await login(u);
    const sent = tg.sent('sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ chat_id: u.id, text: expect.stringContaining('Вход в LifeCommit на Mac') });
    expect(String(sent[0]!.body.text)).toContain('«Я» → «Устройства» → «Выйти везде»');
  });

  it('бот не смог написать (не запускали бота) — вход всё равно состоялся, ошибка в логе', async () => {
    const u = await user({ lang: 'en' });
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: bot can\'t initiate conversation with a user' });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = await login(u, 'web');
    expect((await asDesktop(token, 'GET', '/today')).status).toBe(200);
    expect(String(tg.sent('sendMessage')[0]!.body.text)).toContain('Sign-in to LifeCommit in a browser');
    expect(errors).toHaveBeenCalledWith('desktop sign-in notice failed', u.id, u.id, expect.anything());
  });

  it('подтверждение живёт 10 минут: компьютер не забрал ключ вовремя — снова «ждём», старое подтверждение убирается', async () => {
    const u = await user();
    const s = await start();
    await u.call('POST', '/desktop/approve', { ticket: s.ticket, device: 'mac' });
    await sb.from('desktop_logins').update({ approved_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq('code', s.code);
    expect((await poll(s.secret)).body).toEqual({ status: 'pending' });
    // Следующее подтверждение (любого входа) подчищает просроченные.
    await u.call('POST', '/desktop/approve', { ticket: (await start()).ticket, device: 'mac' });
    expect((await sb.from('desktop_logins').select('code').eq('code', s.code)).data).toEqual([]);
  });

  it('связанный аккаунт Telegram подтверждает вход в общего пользователя', async () => {
    const main = await user();
    const alias = 9_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', main.id);
    // Аккаунт уже связан — вход с него попадает в основного пользователя, своего не заводится.
    const second = await user({ id: alias });
    const token = await login(second);
    expect((await asDesktop(token, 'POST', '/session', {})).body.user.id).toBe(main.id);
  });

  it('ключ со связанного аккаунта — это связанный аккаунт: удалить общего пользователя нельзя, как и из Telegram', async () => {
    const main = await user();
    const alias = 9_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', main.id);
    const second = await user({ id: alias });
    expect(await second.call('DELETE', '/account')).toEqual({ status: 403, body: { error: 'linked_account' } });
    const token = await login(second);
    expect(await asDesktop(token, 'DELETE', '/account')).toEqual({ status: 403, body: { error: 'linked_account' } });
    // и с основного аккаунта — только из Telegram: ключом компьютера аккаунт не удалить
    const own = await login(main);
    expect(await asDesktop(own, 'DELETE', '/account')).toEqual({ status: 403, body: { error: 'telegram_only' } });
    expect((await main.call('DELETE', '/account')).status).toBe(200);
  });

  it('связь аккаунтов поменяли — ключ связанного аккаунта больше не пускает ни к кому', async () => {
    const main = await user();
    const alias = 9_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', main.id);
    const token = await login(await user({ id: alias }));
    expect((await asDesktop(token, 'GET', '/today')).status).toBe(200);
    // связь перенесли к другому человеку — ключ не пускает ни к прежнему, ни к новому
    const other = await user();
    await sb.from('users').update({ telegram_aliases: [] }).eq('id', main.id);
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', other.id);
    expect(await asDesktop(token, 'GET', '/today')).toMatchObject({ status: 401, body: { error: 'no_session' } });
    expect(await asDesktop(token, 'POST', '/session', {})).toMatchObject({ status: 401, body: { error: 'no_session' } });
    // связи нет совсем — тоже нет
    await sb.from('users').update({ telegram_aliases: [] }).eq('id', other.id);
    expect((await asDesktop(token, 'GET', '/today')).status).toBe(401);
    // ключом компьютера пользователь не заводится
    expect((await asDesktop(token, 'POST', '/session', {})).status).toBe(401);
    expect((await sb.from('users').select('id').eq('id', alias)).data).toEqual([]);
  });

  it('чужой или испорченный ключ — 401; без заголовка API по-прежнему закрыт', async () => {
    expect((await asDesktop('x'.repeat(43), 'GET', '/today')).status).toBe(401);
    expect((await asDesktop('', 'GET', '/today')).status).toBe(401);
    expect((await request('/api/today')).status).toBe(401);
  });

  it('ключ, которым не пользовались 90 дней, истёк и удаляется', async () => {
    const u = await user();
    const token = await login(u);
    await sb.from('desktop_sessions').update({ last_used_at: new Date(Date.now() - 91 * 86_400_000).toISOString() }).eq('user_id', u.id);
    expect(await asDesktop(token, 'GET', '/today')).toMatchObject({ status: 401, body: { error: 'session_expired' } });
    expect((await sb.from('desktop_sessions').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('время последнего входа обновляется не чаще раза в час', async () => {
    const u = await user();
    const token = await login(u);
    const halfHour = new Date(Date.now() - 30 * 60_000).toISOString();
    await sb.from('desktop_sessions').update({ last_used_at: halfHour }).eq('user_id', u.id);
    await asDesktop(token, 'GET', '/today');
    const recent = await sb.from('desktop_sessions').select('last_used_at').eq('user_id', u.id).single<{ last_used_at: string }>();
    expect(new Date(recent.data!.last_used_at).getTime()).toBe(new Date(halfHour).getTime());
    const hourAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    await sb.from('desktop_sessions').update({ last_used_at: hourAgo }).eq('user_id', u.id);
    await asDesktop(token, 'GET', '/today');
    const { data } = await sb.from('desktop_sessions').select('last_used_at').eq('user_id', u.id).single<{ last_used_at: string }>();
    expect(Date.now() - new Date(data!.last_used_at).getTime()).toBeLessThan(60_000);
  });

  it('выйти на компьютере: ключ больше не работает; из Telegram такой выход — 400', async () => {
    const u = await user();
    const token = await login(u);
    expect(await u.call('DELETE', '/desktop/session')).toEqual({ status: 400, body: { error: 'not_desktop' } });
    expect(await asDesktop(token, 'DELETE', '/desktop/session')).toEqual({ status: 200, body: { ok: true } });
    expect((await asDesktop(token, 'GET', '/today')).status).toBe(401);
  });

  it('список компьютеров — только свои; «выйти везде» не трогает чужие', async () => {
    const u = await user();
    const other = await user();
    await login(u, 'mac');
    const mine = await login(u, 'web');
    const theirs = await login(other);

    const list = await u.call('GET', '/desktop/sessions');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      { id: expect.any(Number), device: 'web', created_at: expect.any(String), last_used_at: expect.any(String), current: false },
      { id: expect.any(Number), device: 'mac', created_at: expect.any(String), last_used_at: expect.any(String), current: false },
    ]);
    // С самого компьютера видно, какая запись — он сам.
    const fromMac = await asDesktop(mine, 'GET', '/desktop/sessions');
    expect(fromMac.body.map((s: { device: string; current: boolean }) => [s.device, s.current])).toEqual([
      ['web', true],
      ['mac', false],
    ]);
    expect(JSON.stringify(list.body)).not.toContain('token');

    expect(await u.call('DELETE', '/desktop/sessions')).toEqual({ status: 200, body: { ok: true } });
    expect((await asDesktop(mine, 'GET', '/today')).status).toBe(401);
    expect((await u.call('GET', '/desktop/sessions')).body).toEqual([]);
    expect((await asDesktop(theirs, 'GET', '/today')).status).toBe(200);
  });

  it('удалили аккаунт — ключи компьютеров и подтверждения удаляются вместе с ним', async () => {
    const u = await user();
    const token = await login(u);
    await u.call('POST', '/desktop/approve', { ticket: (await start()).ticket, device: 'mac' });
    expect((await u.call('DELETE', '/account')).status).toBe(200);
    expect((await asDesktop(token, 'GET', '/today')).status).toBe(401);
    expect((await sb.from('desktop_sessions').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect((await sb.from('desktop_logins').select('code').eq('user_id', u.id)).data).toEqual([]);
  });
});

// База отвечает ошибкой на запросы к этой таблице — подменяем fetch поверх harness.
const harnessFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = harnessFetch;
  vi.restoreAllMocks();
});
function failTable(table: string, method?: string) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith(`${env.SUPABASE_URL}/rest/v1/${table}`) && (!method || req.method === method)) {
      return Response.json({ code: 'XX000', message: 'база недоступна' }, { status: 500 });
    }
    return harnessFetch(req);
  }) as typeof fetch;
}

describe.skipIf(!ready)('вход на компьютере: база отвечает ошибкой', () => {
  it('опрос не притворяется «ждём», когда база упала, — 500', async () => {
    const s = await start();
    failTable('rpc/desktop_claim');
    expect(await poll(s.secret)).toEqual({ status: 500, body: { error: 'internal' } });
  });

  it('ключ не выдался — подтверждение не пропало: следующий опрос получает ключ', async () => {
    const u = await user();
    const s = await start();
    await u.call('POST', '/desktop/approve', { ticket: s.ticket, device: 'mac' });
    // Следующий ключ будет из одних семёрок — и такой ключ уже есть: выдача сессии падает.
    const fixed = Buffer.alloc(32, 7).toString('base64url');
    const hash = createHash('sha256').update(fixed).digest('hex');
    await sb.from('desktop_sessions').insert({ user_id: u.id, telegram_id: u.id, device: 'web', token_hash: hash });
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T) => (a instanceof Uint8Array ? a.fill(7) : a) as T);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await poll(s.secret)).status).toBe(500);
    random.mockRestore();
    expect((await poll(s.secret)).body).toMatchObject({ status: 'ok' });
  });

  it('ключ не проверить — 500, а не «вход есть»; время входа не записалось — запрос всё равно проходит, ошибка в логе', async () => {
    const u = await user();
    const token = await login(u);
    failTable('desktop_sessions', 'GET');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await asDesktop(token, 'GET', '/today')).status).toBe(500);

    globalThis.fetch = harnessFetch;
    await sb.from('desktop_sessions').update({ last_used_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq('user_id', u.id);
    failTable('desktop_sessions', 'PATCH');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await asDesktop(token, 'GET', '/today')).status).toBe(200);
    expect(errors).toHaveBeenCalledWith('desktop session touch failed', expect.any(Number), 'база недоступна');
  });
});

describe.skipIf(!ready)('вход на компьютере: уборка не мешает', () => {
  it('уборка просроченных подтверждений не вышла — подтверждение всё равно записано, ошибка в логе', async () => {
    const u = await user();
    const s = await start();
    failTable('desktop_logins', 'DELETE');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await u.call('POST', '/desktop/approve', { ticket: s.ticket, device: 'mac' })).status).toBe(200);
    expect(errors).toHaveBeenCalledWith('desktop_logins cleanup failed', 'база недоступна');
    globalThis.fetch = harnessFetch;
    expect((await poll(s.secret)).body).toMatchObject({ status: 'ok' });
  });
});

describe.skipIf(!ready)('вход на компьютере: подтверждение в чате с ботом', () => {
  /** Человек открыл ссылку с компьютера: Telegram прислал боту /start с билетом. */
  const openLink = (u: { id: number }, link: string, lang = 'ru') =>
    botUpdate({ message: { chat: { id: u.id, type: 'private' }, from: { id: u.id, first_name: 'Даша', language_code: lang }, text: `/start ${link.split('?start=')[1]}` } });
  /** Нажал кнопку под сообщением бота. */
  const press = (u: { id: number }, data: string) =>
    botUpdate({ callback_query: { id: `q${Math.random()}`, from: { id: u.id, first_name: 'Даша' }, data, message: { message_id: 77, chat: { id: u.id } } } });
  const edited = () => tg.sent('editMessageText').map((m) => String(m.body.text));

  it('бот спрашивает «Войти на Mac?» с кнопками; «Войти» — компьютер получает ключ, сообщение сменяется на «Готово»', async () => {
    const u = await user();
    const s = await start('mac');
    await openLink(u, s.link);
    const ask = tg.sent('sendMessage').at(-1)!.body;
    expect(ask).toMatchObject({ chat_id: u.id, text: expect.stringContaining('Войти в LifeCommit на Mac?') });
    const buttons = (ask.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(['Войти', 'Не входить']);
    expect(buttons[0]!.callback_data.length).toBeLessThanOrEqual(64);
    expect((await poll(s.secret)).body).toEqual({ status: 'pending' });

    await press(u, buttons[0]!.callback_data);
    expect(edited().at(-1)).toContain('Готово');
    expect(tg.sent('answerCallbackQuery')).toHaveLength(1);
    const got = await poll(s.secret);
    if (got.body.status !== 'ok') throw new Error('нет ключа');
    expect((await asDesktop(got.body.token, 'POST', '/session', {})).body.user.id).toBe(u.id);

    // та же кнопка второй раз — «уже подтверждён»
    await press(u, buttons[0]!.callback_data);
    expect(edited().at(-1)).toContain('уже подтверждён');
  });

  it('«Не входить» — ничего не подтверждено; по-английски — по-английски', async () => {
    const u = await user({ lang: 'en' });
    const s = await start('web');
    await openLink(u, s.link, 'en');
    expect(String(tg.sent('sendMessage').at(-1)!.body.text)).toContain('Sign in to LifeCommit in a browser?');
    await press(u, 'dl:no');
    expect(edited().at(-1)).toContain('not signing in');
    expect((await poll(s.secret)).body).toEqual({ status: 'pending' });
  });

  it('устаревшая и подделанная ссылка — бот так и говорит, ключа нет', async () => {
    const u = await user();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 11 * 60_000);
    const old = await start('mac');
    clock.mockRestore();
    await openLink(u, old.link);
    const data = (tg.sent('sendMessage').at(-1)!.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]![0]!.callback_data;
    await press(u, data);
    expect(edited().at(-1)).toContain('Ссылка устарела');
    const s = await start('mac');
    await press(u, `dl:m${s.ticket.slice(0, -1)}${s.ticket.at(-1) === 'A' ? 'B' : 'A'}`);
    expect(edited().at(-1)).toContain('не подходит');
    expect((await poll(s.secret)).body).toEqual({ status: 'pending' });
    await press(u, 'dl:xyz');
    expect(edited().at(-1)).toContain('не подходит');
  });

  it('испорченная ссылка в /start — обычное приветствие, без вопроса о входе', async () => {
    const u = await user();
    await botUpdate({ message: { chat: { id: u.id, type: 'private' }, from: { id: u.id, first_name: 'Даша', language_code: 'ru' }, text: '/start mac_short' } });
    expect(String(tg.sent('sendMessage').at(-1)!.body.text)).not.toContain('Войти в LifeCommit');
  });
});
