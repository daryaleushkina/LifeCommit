// Вход в нативные приложения (iPhone, Android, Mac) через официальный вход Telegram (OpenID Connect, 05.10.2026):
// приложение получает от oauth.telegram.org подписанный id_token, сервер проверяет подпись ключами Telegram и выдаёт
// тот же ключ сессии, что у компьютера (`Authorization: Bearer <ключ>`). Ключи Telegram здесь — свои, тестовые:
// адрес JWKS подменён.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetTelegramKeys } from './telegramLogin';
import { dbReady, env, net, request, sb, tg, user, type Res } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('тесты входа через Telegram пропущены: нет локальной Supabase (pnpm db:start)');

const JWKS_URL = 'https://oauth.telegram.org/.well-known/jwks.json';
/** Id бота — первая часть токена; это и client_id, и aud в id_token. */
const BOT_ID = env.TELEGRAM_BOT_TOKEN.split(':')[0]!;

const b64u = (data: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof data === 'string' ? data : data instanceof Uint8Array ? data : new Uint8Array(data)).toString('base64url');

interface TestKey {
  kid: string;
  alg: 'RS256' | 'ES256';
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

async function makeKey(kid: string, alg: 'RS256' | 'ES256' = 'RS256'): Promise<TestKey> {
  const params =
    alg === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' };
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  // Как у Telegram: alg, kid, key_ops, ext рядом с самим ключом.
  const jwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey), kid, alg, key_ops: ['verify'], ext: true };
  return { kid, alg, privateKey: pair.privateKey, jwk };
}

const rsa = await makeKey('oidc-1');
const ec = await makeKey('oidc-2', 'ES256');

const now = () => Math.floor(Date.now() / 1000);
const freshId = () => 9_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

/** Подписанный id_token, как его выдаёт oauth.telegram.org; claims и заголовок можно перебить. */
async function idToken(claims: Record<string, unknown>, key: TestKey = rsa, header: Record<string, unknown> = {}): Promise<string> {
  const payload = {
    iss: 'https://oauth.telegram.org',
    aud: BOT_ID,
    sub: '1234123412341234123',
    iat: now(),
    exp: now() + 3600,
    name: 'Даша Лёшкина',
    given_name: 'Даша',
    family_name: 'Лёшкина',
    // Ник в базе уникален — у каждого тестового человека свой.
    preferred_username: `t${String(claims.id ?? '')}`,
    picture: 'https://cdn4.telesco.pe/file/avatar.jpg',
    ...claims,
  };
  const head = b64u(JSON.stringify({ alg: key.alg, kid: key.kid, typ: 'JWT', ...header }));
  const body = b64u(JSON.stringify(payload));
  const algo = key.alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  const sig = await crypto.subtle.sign(algo, key.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

/** Telegram отдаёт эти ключи. */
const serveKeys = (...keys: TestKey[]) => net.on(JWKS_URL, () => Response.json({ keys: keys.map((k) => k.jwk) }));
const keyFetches = () => net.calls.filter((c) => c.url === JWKS_URL).length;

const signIn = <T = any,>(body: unknown) =>
  request<T>('/api/auth/telegram', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Запрос к API с ключом сессии телефона. */
const asPhone = <T = any,>(token: string, method: string, path: string, body?: unknown): Promise<Res<T>> =>
  request<T>(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

// Пользователей, которых заводит сам вход (а не harness.user), убираем сами.
const madeHere: number[] = [];
beforeEach(() => {
  forgetTelegramKeys();
  serveKeys(rsa, ec);
});
afterEach(async () => {
  vi.restoreAllMocks();
  const ids = madeHere.splice(0);
  if (ids.length) await sb.from('users').delete().in('id', ids);
});

describe('вход через Telegram: настройки для приложения', () => {
  it('client_id для oauth.telegram.org — id бота; без входа', async () => {
    expect(await request('/api/auth/telegram/config')).toEqual({ status: 200, body: { client_id: BOT_ID } });
  });
});

describe.skipIf(!ready)('вход через Telegram', () => {
  it('новый человек: проверенный id_token заводит пользователя из профиля Telegram и даёт ключ сессии', async () => {
    const id = freshId();
    madeHere.push(id);
    const res = await signIn({ id_token: await idToken({ id }), device: 'ios', language: 'ru-RU' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), is_new: true });

    const { data: row } = await sb.from('users').select('id, first_name, last_name, username, photo_url, language_code').eq('id', id).single();
    expect(row).toEqual({ id, first_name: 'Даша', last_name: 'Лёшкина', username: `t${id}`, photo_url: 'https://cdn4.telesco.pe/file/avatar.jpg', language_code: 'ru' });

    // Ключ работает как вход из Telegram: сессия, привычки.
    const session = await asPhone(res.body.token, 'POST', '/session', { timezone: 'Asia/Ho_Chi_Minh' });
    expect(session.body).toMatchObject({ user: { id, first_name: 'Даша', timezone: 'Asia/Ho_Chi_Minh' }, is_new: false });
    expect((await asPhone(res.body.token, 'POST', '/tasks', { title: 'Читать', kind: 'check', target: 1 })).status).toBe(201);
    expect((await asPhone(res.body.token, 'GET', '/today')).body.tasks).toHaveLength(1);

    // В базе — устройство и отпечаток ключа, сам ключ — только у телефона.
    const { data } = await sb.from('desktop_sessions').select('telegram_id, device, token_hash').eq('user_id', id);
    expect(data).toEqual([{ telegram_id: id, device: 'ios', token_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }]);

    // Бот сообщает о входе, как о компьютере.
    const sent = tg.sent('sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ chat_id: id, text: expect.stringContaining('Вход в LifeCommit на iPhone') });
    expect(String(sent[0]!.body.text)).toContain('«Устройства»');
  });

  it('язык телефона: не русский — английский; профиль без фамилии, ника и фото тоже годится', async () => {
    const id = freshId();
    madeHere.push(id);
    const token = await idToken({ id, given_name: undefined, family_name: undefined, name: 'Alex', preferred_username: undefined, picture: undefined });
    expect((await signIn({ id_token: token, device: 'android', language: 'vi' })).status).toBe(200);
    const { data } = await sb.from('users').select('first_name, last_name, username, photo_url, language_code').eq('id', id).single();
    expect(data).toEqual({ first_name: 'Alex', last_name: null, username: null, photo_url: null, language_code: 'en' });
    expect(String(tg.sent('sendMessage')[0]!.body.text)).toContain('Sign-in to LifeCommit on Android');
  });

  it('фото не https и слишком длинное имя — не берём как есть', async () => {
    const id = freshId();
    madeHere.push(id);
    const token = await idToken({ id, given_name: 'Я'.repeat(200), picture: 'javascript:alert(1)' });
    expect((await signIn({ id_token: token, device: 'mac' })).status).toBe(200);
    const { data } = await sb.from('users').select('first_name, photo_url').eq('id', id).single();
    expect(data).toEqual({ first_name: 'Я'.repeat(64), photo_url: null });
  });

  it('ник занят в базе другим человеком (ник в Telegram сменили) — заводим без ника, а не 500', async () => {
    const holder = await user();
    const id = freshId();
    madeHere.push(id);
    const res = await signIn({ id_token: await idToken({ id, preferred_username: `U${holder.id}` }), device: 'ios' });
    expect(res.status).toBe(200);
    expect((await sb.from('users').select('username').eq('id', id).single()).data).toEqual({ username: null });
    expect((await sb.from('users').select('username').eq('id', holder.id).single()).data).toEqual({ username: `u${holder.id}` });
  });

  it('уже пользуется мини-аппом: тот же пользователь, профиль из Telegram не перезаписывается', async () => {
    const u = await user({ name: 'Тест' });
    const res = await signIn({ id_token: await idToken({ id: u.id, given_name: 'Другое имя' }), device: 'android' });
    expect(res.body).toEqual({ token: expect.any(String), is_new: false });
    const session = await asPhone(res.body.token, 'POST', '/session', {});
    expect(session.body.user).toMatchObject({ id: u.id, first_name: 'Тест' });
    // Из Telegram видно, что вошли с телефона.
    const list = await u.call('GET', '/desktop/sessions');
    expect(list.body.map((s: { device: string }) => s.device)).toEqual(['android']);
  });

  it('связанный аккаунт Telegram входит в общего пользователя, ключ — от имени связанного', async () => {
    const main = await user();
    const alias = freshId();
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', main.id);
    const res = await signIn({ id_token: await idToken({ id: alias }), device: 'ios' });
    expect(res.body.is_new).toBe(false);
    expect((await asPhone(res.body.token, 'POST', '/session', {})).body.user.id).toBe(main.id);
    expect((await sb.from('desktop_sessions').select('telegram_id').eq('user_id', main.id)).data).toEqual([{ telegram_id: alias }]);
    expect((await sb.from('users').select('id').eq('id', alias)).data).toEqual([]);
  });

  it('aud числом (client_id у Telegram — число) тоже наш бот', async () => {
    const id = freshId();
    madeHere.push(id);
    expect((await signIn({ id_token: await idToken({ id, aud: Number(BOT_ID) }), device: 'ios' })).status).toBe(200);
  });

  it('один id_token — один вход: повтор того же токена — 409 token_used, второго ключа нет', async () => {
    const id = freshId();
    madeHere.push(id);
    const token = await idToken({ id });
    expect((await signIn({ id_token: token, device: 'ios' })).status).toBe(200);
    expect(await signIn({ id_token: token, device: 'android' })).toEqual({ status: 409, body: { error: 'token_used' } });
    expect((await sb.from('desktop_sessions').select('device').eq('user_id', id)).data).toEqual([{ device: 'ios' }]);
  });

  it('утёкший токен не превратить в ключи подменой записи подписи: другой последний знак base64 — отказ, ES256 (r, n−s) — 409', async () => {
    const id = freshId();
    madeHere.push(id);
    const token = await idToken({ id });
    expect((await signIn({ id_token: token, device: 'ios' })).status).toBe(200);
    // У RS256 в последнем знаке подписи 4 лишних бита: варианты с теми же старшими битами дают те же байты.
    const [h, p, sig] = token.split('.') as [string, string, string];
    const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = ABC.indexOf(sig.at(-1)!);
    const twins = [...ABC].filter((_, i) => i !== last && i >> 4 === last >> 4);
    expect(twins.length).toBe(15);
    for (const ch of twins) {
      const res = await signIn({ id_token: `${h}.${p}.${sig.slice(0, -1)}${ch}`, device: 'ios' });
      expect({ ch, res }).toEqual({ ch, res: { status: 401, body: { error: 'bad_token' } } });
    }
    // ES256: вторая подпись того же содержания (r, n − s) — тоже верна для WebCrypto; отпечаток — по содержанию.
    const id2 = freshId();
    madeHere.push(id2);
    const e = await idToken({ id: id2 }, ec);
    expect((await signIn({ id_token: e, device: 'ios' })).status).toBe(200);
    const [eh, ep, es] = e.split('.') as [string, string, string];
    const raw = Buffer.from(es, 'base64url');
    const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    const sVal = BigInt('0x' + raw.subarray(32).toString('hex'));
    const flipped = Buffer.concat([raw.subarray(0, 32), Buffer.from((n - sVal).toString(16).padStart(64, '0'), 'hex')]);
    expect(await signIn({ id_token: `${eh}.${ep}.${b64u(flipped)}`, device: 'ios' })).toEqual({ status: 409, body: { error: 'token_used' } });
    expect((await sb.from('desktop_sessions').select('id').in('user_id', [id, id2])).data).toHaveLength(2);
  });

  it('отпечаток живёт дольше токена: 9 минут спустя повтор — 409; старше 20 минут уборка удаляет', async () => {
    const a = freshId();
    const b = freshId();
    madeHere.push(a, b);
    const tokenA = await idToken({ id: a });
    expect((await signIn({ id_token: tokenA, device: 'ios' })).status).toBe(200);
    const [h, p] = tokenA.split('.') as [string, string];
    const hashA = createHash('sha256').update(`${h}.${p}`).digest('hex');
    const stale = `stale-${freshId()}`;
    await sb.from('auth_token_uses').update({ used_at: new Date(Date.now() - 9 * 60_000).toISOString() }).eq('token_hash', hashA);
    await sb.from('auth_token_uses').insert({ token_hash: stale, used_at: new Date(Date.now() - 25 * 60_000).toISOString() });
    expect((await signIn({ id_token: await idToken({ id: b }), device: 'ios' })).status).toBe(200);
    expect((await signIn({ id_token: tokenA, device: 'ios' })).body).toEqual({ error: 'token_used' });
    expect((await sb.from('auth_token_uses').select('token_hash').in('token_hash', [hashA, stale])).data).toEqual([{ token_hash: hashA }]);
  });

  it('двойное нажатие: два первых входа нового человека сразу — оба входят, пользователь один', async () => {
    const id = freshId();
    madeHere.push(id);
    const [a, b] = await Promise.all([idToken({ id }), idToken({ id, iat: now() - 1 })]);
    const [ra, rb] = await Promise.all([signIn({ id_token: a, device: 'ios' }), signIn({ id_token: b, device: 'ios' })]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect((await sb.from('users').select('id').eq('id', id)).data).toEqual([{ id }]);
    expect((await sb.from('desktop_sessions').select('id').eq('user_id', id)).data).toHaveLength(2);
  });

  it('нет ни имени, ни ника — человек всё равно с именем, а не пустой строкой', async () => {
    const id = freshId();
    madeHere.push(id);
    const token = await idToken({ id, given_name: undefined, family_name: undefined, name: undefined, preferred_username: undefined });
    expect((await signIn({ id_token: token, device: 'ios' })).status).toBe(200);
    expect((await sb.from('users').select('first_name').eq('id', id).single()).data).toEqual({ first_name: 'Telegram' });
  });

  it('ключ ES256 тоже принимается', async () => {
    const id = freshId();
    madeHere.push(id);
    expect((await signIn({ id_token: await idToken({ id }, ec), device: 'ios' })).status).toBe(200);
  });

  it('выйти на телефоне: ключ больше не работает', async () => {
    const id = freshId();
    madeHere.push(id);
    const { body } = await signIn({ id_token: await idToken({ id }), device: 'ios' });
    expect(await asPhone(body.token, 'DELETE', '/desktop/session')).toEqual({ status: 200, body: { ok: true } });
    expect((await asPhone(body.token, 'GET', '/today')).status).toBe(401);
  });

  it('ключи Telegram скачиваются один раз и запоминаются', async () => {
    const a = freshId();
    const b = freshId();
    madeHere.push(a, b);
    expect((await signIn({ id_token: await idToken({ id: a }), device: 'ios' })).status).toBe(200);
    expect((await signIn({ id_token: await idToken({ id: b }), device: 'ios' })).status).toBe(200);
    expect(keyFetches()).toBe(1);
  });

  it('Telegram сменил ключ: незнакомый kid — ключи перечитываются один раз', async () => {
    const a = freshId();
    const b = freshId();
    madeHere.push(a, b);
    // Сначала Telegram отдаёт только старый ключ, потом — и новый.
    net.routes = [];
    let calls = 0;
    const next = await makeKey('oidc-3');
    net.on(JWKS_URL, () => Response.json({ keys: calls++ === 0 ? [rsa.jwk] : [rsa.jwk, next.jwk] }));
    expect((await signIn({ id_token: await idToken({ id: a }), device: 'ios' })).status).toBe(200);
    expect((await signIn({ id_token: await idToken({ id: b }, next), device: 'ios' })).status).toBe(200);
    expect(keyFetches()).toBe(2);
  });

  it('незнакомый kid не заставляет скачивать ключи на каждый запрос: не чаще раза в минуту', async () => {
    const stranger = await makeKey('oidc-x');
    const bad = await idToken({ id: freshId() }, stranger);
    expect((await signIn({ id_token: bad, device: 'ios' })).body).toEqual({ error: 'bad_token' });
    // Минуту после промаха — «повторите позже» без похода к Telegram: вдруг это новый ключ, а не подделка.
    expect((await signIn({ id_token: bad, device: 'ios' })).body).toEqual({ error: 'telegram_unreachable' });
    expect(keyFetches()).toBe(1);
  });

  it('Telegram недоступен — 502, а не «неверный вход»; в базу ничего не пишется', async () => {
    const id = freshId();
    net.routes = [];
    net.on(JWKS_URL, () => new Response('down', { status: 503 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const errors = console.error as unknown as ReturnType<typeof vi.fn>;
    expect(await signIn({ id_token: await idToken({ id }), device: 'ios' })).toEqual({ status: 502, body: { error: 'telegram_unreachable' } });
    expect(keyFetches()).toBe(1);
    // Каждый случай — с чистой памятью: иначе его оборвёт пауза после сбоя, и до Telegram он не дойдёт.
    forgetTelegramKeys();
    net.routes = [];
    net.on(JWKS_URL, () => {
      throw new TypeError('network down');
    });
    expect((await signIn({ id_token: await idToken({ id }), device: 'ios' })).status).toBe(502);
    expect(keyFetches()).toBe(2);
    forgetTelegramKeys();
    net.routes = [];
    net.on(JWKS_URL, () => Response.json({ keys: 'не список' }));
    expect((await signIn({ id_token: await idToken({ id }), device: 'ios' })).status).toBe(502);
    expect(keyFetches()).toBe(3);
    expect(errors).toHaveBeenCalledWith('telegram jwks: no keys list');
    // Пустой список и ключи без kid — тоже сбой Telegram, а не «неверный токен».
    forgetTelegramKeys();
    net.routes = [];
    net.on(JWKS_URL, () => Response.json({ keys: [{ kty: 'RSA' }] }));
    expect((await signIn({ id_token: await idToken({ id }), device: 'ios' })).status).toBe(502);
    expect(errors).toHaveBeenCalledWith('telegram jwks: no usable keys', 1);
    expect((await sb.from('users').select('id').eq('id', id)).data).toEqual([]);
  });

  it('подделка и чужие токены — 401 bad_token, пользователь не заводится', async () => {
    const id = freshId();
    const good = await idToken({ id });
    const [h, p, s] = good.split('.') as [string, string, string];
    const flip = (x: string) => (x[0] === 'A' ? 'B' : 'A') + x.slice(1);
    const cases: [string, string][] = [
      ['подпись испорчена', `${h}.${p}.${flip(s)}`],
      ['данные подменены', `${h}.${b64u(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), id: id + 1 }))}.${s}`],
      ['без подписи (alg none)', `${b64u(JSON.stringify({ alg: 'none', kid: 'oidc-1' }))}.${p}.`],
      ['HS256', await idToken({ id }, rsa, { alg: 'HS256' })],
      ['ES256 в заголовке, ключ RSA', await idToken({ id }, rsa, { alg: 'ES256' })],
      ['RS256 в заголовке, ключ EC', await idToken({ id }, ec, { alg: 'RS256' })],
      ['чужой издатель', await idToken({ id, iss: 'https://evil.example' })],
      ['другой бот', await idToken({ id, aud: '123' })],
      ['нет id', await idToken({ id: undefined })],
      ['id не число', await idToken({ id: 'abc' })],
      ['id дробный', await idToken({ id: 1.5 })],
      ['из будущего', await idToken({ id, iat: now() + 600 })],
      ['без exp', await idToken({ id, exp: undefined })],
      ['без iat', await idToken({ id, iat: undefined })],
      ['заголовок не объект', `${b64u('null')}.${p}.${s}`],
      ['две части', `${h}.${p}`],
      ['не base64', `@@@.${p}.${s}`],
      ['не JSON', `${b64u('не json')}.${p}.${s}`],
    ];
    for (const [name, token] of cases) {
      expect({ name, res: await signIn({ id_token: token, device: 'ios' }) }).toEqual({ name, res: { status: 401, body: { error: 'bad_token' } } });
    }
    expect((await sb.from('users').select('id').eq('id', id)).data).toEqual([]);
  });

  it('aud списком с нашим ботом принимается', async () => {
    const id = freshId();
    madeHere.push(id);
    expect((await signIn({ id_token: await idToken({ id, aud: ['other', BOT_ID] }), device: 'ios' })).status).toBe(200);
  });

  it('старый токен — 401 token_expired: истёк или выдан больше 10 минут назад', async () => {
    const id = freshId();
    expect(await signIn({ id_token: await idToken({ id, exp: now() - 10 }), device: 'ios' })).toEqual({ status: 401, body: { error: 'token_expired' } });
    expect(await signIn({ id_token: await idToken({ id, iat: now() - 11 * 60 }), device: 'ios' })).toEqual({ status: 401, body: { error: 'token_expired' } });
    expect((await sb.from('users').select('id').eq('id', id)).data).toEqual([]);
  });

  it('неверный запрос — 400 bad_request', async () => {
    const token = await idToken({ id: freshId() });
    expect((await signIn('строка')).body).toEqual({ error: 'bad_request' });
    expect((await signIn([])).body).toEqual({ error: 'bad_request' });
    expect((await signIn({ device: 'ios' })).body).toEqual({ error: 'bad_request' });
    expect((await signIn({ id_token: 42, device: 'ios' })).body).toEqual({ error: 'bad_request' });
    expect((await signIn({ id_token: 'x'.repeat(20_000), device: 'ios' })).body).toEqual({ error: 'bad_request' });
    expect((await signIn({ id_token: token })).body).toEqual({ error: 'bad_request' });
    expect((await signIn({ id_token: token, device: 'web' })).body).toEqual({ error: 'bad_request' });
    const notJson = await request('/api/auth/telegram', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{не json' });
    expect(notJson).toEqual({ status: 400, body: { error: 'bad_request' } });
  });

  it('бот не смог написать — вход всё равно состоялся, ошибка в логе', async () => {
    const id = freshId();
    madeHere.push(id);
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await signIn({ id_token: await idToken({ id }), device: 'ios' });
    expect(res.status).toBe(200);
    expect((await asPhone(res.body.token, 'GET', '/today')).status).toBe(200);
    expect(errors).toHaveBeenCalledWith('desktop sign-in notice failed', id, id, expect.anything());
  });
});

describe.skipIf(!ready)('вход через Telegram: ключи Telegram со временем', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('незнакомый kid после промаха: минуту — «повторите позже» (502), без похода к Telegram; потом ключи перечитываются', async () => {
    const id = freshId();
    madeHere.push(id);
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const stranger = await makeKey('oidc-x');
    expect((await signIn({ id_token: await idToken({ id: freshId() }, stranger), device: 'ios' })).body).toEqual({ error: 'bad_token' });
    // Telegram опубликовал новый ключ.
    const next = await makeKey('oidc-4');
    net.routes = [];
    serveKeys(rsa, next);
    vi.setSystemTime(start + 30_000);
    expect(await signIn({ id_token: await idToken({ id }, next), device: 'ios' })).toEqual({ status: 502, body: { error: 'telegram_unreachable' } });
    expect(keyFetches()).toBe(1);
    vi.setSystemTime(start + 61_000);
    expect((await signIn({ id_token: await idToken({ id }, next), device: 'ios' })).status).toBe(200);
    expect(keyFetches()).toBe(2);
  });

  it('ключи помнятся час: потом перечитываются, и отозванный Telegram ключ больше не принимается', async () => {
    const a = freshId();
    madeHere.push(a);
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    expect((await signIn({ id_token: await idToken({ id: a }), device: 'ios' })).status).toBe(200);
    net.routes = [];
    serveKeys(ec);
    vi.setSystemTime(start + 61 * 60_000);
    expect(await signIn({ id_token: await idToken({ id: freshId() }), device: 'ios' })).toEqual({ status: 401, body: { error: 'bad_token' } });
    expect(keyFetches()).toBe(2);
  });

  it('ключи устарели, а Telegram не отвечает — проверяем старыми ключами; новые попытки скачать — не чаще раза в 30 секунд', async () => {
    const a = freshId();
    const b = freshId();
    madeHere.push(a, b);
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    expect((await signIn({ id_token: await idToken({ id: a }), device: 'ios' })).status).toBe(200);
    net.routes = [];
    net.on(JWKS_URL, () => new Response('down', { status: 503 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.setSystemTime(start + 61 * 60_000);
    expect((await signIn({ id_token: await idToken({ id: b }), device: 'ios' })).status).toBe(200);
    expect(keyFetches()).toBe(2);
    // Незнакомый kid сразу после сбоя — к Telegram не идём.
    const stranger = await makeKey('oidc-y');
    expect(await signIn({ id_token: await idToken({ id: freshId() }, stranger), device: 'ios' })).toEqual({ status: 502, body: { error: 'telegram_unreachable' } });
    expect(keyFetches()).toBe(2);
  });

  it('ключи устарели, а Telegram прислал пустой список — проверяем старыми, рабочие ключи не затираются', async () => {
    const a = freshId();
    const b = freshId();
    madeHere.push(a, b);
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    expect((await signIn({ id_token: await idToken({ id: a }), device: 'ios' })).status).toBe(200);
    net.routes = [];
    net.on(JWKS_URL, () => Response.json({ keys: [] }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.setSystemTime(start + 61 * 60_000);
    expect((await signIn({ id_token: await idToken({ id: b }), device: 'ios' })).status).toBe(200);
  });

  it('Telegram завис — через 4 секунды 502, а не вечное ожидание', async () => {
    net.routes = [];
    net.on(JWKS_URL, (req) => new Promise<Response>((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason))));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t0 = performance.now();
    expect(await signIn({ id_token: await idToken({ id: freshId() }), device: 'ios' })).toEqual({ status: 502, body: { error: 'telegram_unreachable' } });
    expect(performance.now() - t0).toBeLessThan(8_000);
    expect(errors).toHaveBeenCalledWith('telegram jwks fetch failed', expect.anything());
  }, 15_000);

  it('ключ Telegram не импортируется — это сбой на нашей стороне или у Telegram: 502 и в лог, а не «неверный токен»', async () => {
    net.routes = [];
    net.on(JWKS_URL, () => Response.json({ keys: [{ kty: 'RSA', kid: 'oidc-1', alg: 'RS256', e: 'AQAB' }] }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await signIn({ id_token: await idToken({ id: freshId() }), device: 'ios' })).toEqual({ status: 502, body: { error: 'telegram_unreachable' } });
    expect(errors).toHaveBeenCalledWith('telegram jwk import failed', 'oidc-1', 'RS256', expect.anything());
  });
});

// База отвечает ошибкой — подменяем fetch поверх harness.
const harnessFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = harnessFetch;
});

describe.skipIf(!ready)('вход через Telegram: база отвечает ошибкой', () => {
  it('отпечаток токена не записался — 500 и никакого ключа', async () => {
    const id = freshId();
    madeHere.push(id);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.startsWith(`${env.SUPABASE_URL}/rest/v1/auth_token_uses`) && req.method === 'POST') {
        return Response.json({ code: 'XX000', message: 'база недоступна' }, { status: 500 });
      }
      return harnessFetch(req);
    }) as typeof fetch;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await signIn({ id_token: await idToken({ id }), device: 'ios' })).toEqual({ status: 500, body: { error: 'internal' } });
    globalThis.fetch = harnessFetch;
    expect((await sb.from('desktop_sessions').select('id').eq('user_id', id)).data).toEqual([]);
  });

  it('уборка старых отпечатков не вышла — вход всё равно состоялся, ошибка в логе', async () => {
    const id = freshId();
    madeHere.push(id);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.startsWith(`${env.SUPABASE_URL}/rest/v1/auth_token_uses`) && req.method === 'DELETE') {
        return Response.json({ code: 'XX000', message: 'база недоступна' }, { status: 500 });
      }
      return harnessFetch(req);
    }) as typeof fetch;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await signIn({ id_token: await idToken({ id }), device: 'ios' })).status).toBe(200);
    expect(errors).toHaveBeenCalledWith('auth_token_uses cleanup failed', 'база недоступна');
  });

  it('ключ не записался — 500, а не ключ, который не работает', async () => {
    const id = freshId();
    madeHere.push(id);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.startsWith(`${env.SUPABASE_URL}/rest/v1/desktop_sessions`) && req.method === 'POST') {
        return Response.json({ code: 'XX000', message: 'база недоступна' }, { status: 500 });
      }
      return harnessFetch(req);
    }) as typeof fetch;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await signIn({ id_token: await idToken({ id }), device: 'ios' })).toEqual({ status: 500, body: { error: 'internal' } });
  });
});
