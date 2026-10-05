// Вход в нативные приложения (iPhone, Android, Mac) — официальный вход Telegram по OpenID Connect (05.10.2026).
// Приложение само проходит oauth.telegram.org (PKCE, без секрета: так работает SDK Telegram для приложений) и присылает
// подписанный id_token. Worker проверяет подпись ключами Telegram, издателя, получателя (наш бот), срок — и выдаёт тот же
// ключ сессии, что компьютеру (`Authorization: Bearer <ключ>`, worker/desktop.ts). Кого нет — заводит из профиля
// Telegram: в приложение можно прийти, ни разу не открыв мини-апп.
// Наружу — только oauth.telegram.org (ключи подписи), адрес зашит.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { cleanText } from '../shared/text';
import { randomToken, signInNotice, tokenHash, type SessionDevice } from './desktop';
import { byTelegram, db, type Env } from './env';

const ISSUER = 'https://oauth.telegram.org';
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
/** id_token старше этого не принимаем, даже если Telegram дал ему час: вход — сразу после выдачи. */
const MAX_AGE_S = 10 * 60;
/** Часы телефона и Telegram могут расходиться. */
const CLOCK_SKEW_S = 60;
/** Ключи Telegram помним час; незнакомый kid — перечитываем, но не чаще раза в минуту. */
const KEYS_TTL_MS = 3_600_000;
const REFETCH_MS = 60_000;
/** Токен длиннее — не id_token Telegram (их длина ~1 КБ). */
const MAX_TOKEN = 8_192;

const DEVICES = ['ios', 'android', 'mac'] as const satisfies readonly SessionDevice[];
type PhoneDevice = (typeof DEVICES)[number];
const isDevice = (v: unknown): v is PhoneDevice => typeof v === 'string' && (DEVICES as readonly string[]).includes(v);

/** Id бота — первая часть токена; это client_id приложения и aud в id_token. */
const botId = (env: Env) => env.TELEGRAM_BOT_TOKEN.split(':')[0] ?? '';

const badRequest = () => new HTTPException(400, { message: 'bad_request' });
const badToken = () => new HTTPException(401, { message: 'bad_token' });

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// ── Ключи Telegram ──

type Jwk = JsonWebKey & { kid?: string };
let keys: { list: Jwk[]; at: number } | null = null;
/** Когда последний раз искали kid и не нашли даже в свежескачанных — чтобы подделки не гоняли нас к Telegram. */
let lastMiss = 0;

/** Забыть скачанные ключи (тесты). */
export function forgetTelegramKeys() {
  keys = null;
  lastMiss = 0;
}

async function fetchKeys(): Promise<Jwk[]> {
  let body: unknown;
  try {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    console.error('telegram jwks fetch failed', e);
    throw new HTTPException(502, { message: 'telegram_unreachable' });
  }
  const list = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) {
    console.error('telegram jwks: no keys list');
    throw new HTTPException(502, { message: 'telegram_unreachable' });
  }
  const valid = list.filter((k): k is Jwk => typeof k === 'object' && k !== null && typeof (k as Jwk).kid === 'string');
  keys = { list: valid, at: Date.now() };
  return valid;
}

/**
 * Ключ по kid: из памяти (час). Незнакомый kid — Telegram, возможно, сменил ключ: перечитываем, но после промаха —
 * не чаще раза в минуту.
 */
async function keyFor(kid: string): Promise<Jwk | undefined> {
  if (keys && Date.now() - keys.at < KEYS_TTL_MS) {
    const known = keys.list.find((k) => k.kid === kid);
    if (known) return known;
    if (Date.now() - lastMiss < REFETCH_MS) return undefined;
  }
  const found = (await fetchKeys()).find((k) => k.kid === kid);
  if (!found) lastMiss = Date.now();
  return found;
}

// ── Проверка id_token ──

const ALGS = {
  RS256: { importAs: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verifyAs: { name: 'RSASSA-PKCS1-v1_5' }, kty: 'RSA' },
  ES256: { importAs: { name: 'ECDSA', namedCurve: 'P-256' }, verifyAs: { name: 'ECDSA', hash: 'SHA-256' }, kty: 'EC' },
} as const;

function fromB64url(part: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) throw badToken();
  const bin = atob(part.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (part.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function jsonPart(part: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(fromB64url(part)));
  } catch {
    throw badToken();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw badToken();
  return value as Record<string, unknown>;
}

interface TelegramProfile {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

/** Подпись, издатель, получатель, срок. Всё не так — 401; ключи Telegram не скачались — 502. */
async function verify(env: Env, token: string): Promise<TelegramProfile> {
  const parts = token.split('.');
  if (parts.length !== 3) throw badToken();
  const [h, p, s] = parts as [string, string, string];
  const header = jsonPart(h);
  const claims = jsonPart(p);
  const alg = header.alg;
  if (alg !== 'RS256' && alg !== 'ES256') throw badToken();
  if (typeof header.kid !== 'string') throw badToken();

  const jwk = await keyFor(header.kid);
  if (!jwk || jwk.kty !== ALGS[alg].kty) throw badToken();
  let ok = false;
  try {
    // Только сам ключ: alg/key_ops/ext из JWKS Telegram импорту не нужны и могут не совпасть с тем, как мы его используем.
    const bare: JsonWebKey = alg === 'RS256' ? { kty: jwk.kty, n: jwk.n, e: jwk.e } : { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    const key = await crypto.subtle.importKey('jwk', bare, ALGS[alg].importAs, false, ['verify']);
    ok = await crypto.subtle.verify(ALGS[alg].verifyAs, key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    ok = false;
  }
  if (!ok) throw badToken();

  if (claims.iss !== ISSUER) throw badToken();
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(botId(env))) throw badToken();
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') throw badToken();
  if (claims.iat > now + CLOCK_SKEW_S) throw badToken();
  if (claims.exp <= now || claims.iat < now - MAX_AGE_S) throw new HTTPException(401, { message: 'token_expired' });

  const id = claims.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw badToken();
  const text = (v: unknown, max: number) => (typeof v === 'string' ? cleanText(v, max) : '');
  const firstName = text(claims.given_name, 64) || text(claims.name, 64);
  const picture = typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture.slice(0, 512) : null;
  return {
    id,
    firstName,
    lastName: text(claims.family_name, 64) || null,
    username: typeof claims.preferred_username === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(claims.preferred_username) ? claims.preferred_username : null,
    photoUrl: picture,
  };
}

// ── Маршруты (без подписи Telegram — раньше /api) ──

export const telegramLogin = new Hono<{ Bindings: Env }>();

/** Что приложению нужно для oauth.telegram.org: client_id — id бота. */
telegramLogin.get('/telegram/config', (c) => c.json({ client_id: botId(c.env) }));

telegramLogin.post('/telegram', async (c) => {
  const raw: unknown = await c.req.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw badRequest();
  const { id_token: token, device, language } = raw as Record<string, unknown>;
  if (typeof token !== 'string' || token.length > MAX_TOKEN || !isDevice(device)) throw badRequest();

  const who = await verify(c.env, token);
  const sb = db(c.env);
  const existing = must(await sb.from('users').select('id').or(byTelegram(who.id)).limit(1).maybeSingle<{ id: number }>());
  let userId = existing?.id;
  if (userId === undefined) {
    // Новый человек — как первый вход в мини-апп: профиль из Telegram, язык — телефона.
    const lang = typeof language === 'string' && language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
    const row = {
      id: who.id,
      first_name: who.firstName,
      last_name: who.lastName,
      username: who.username,
      photo_url: who.photoUrl,
      language_code: lang,
      last_seen_at: new Date().toISOString(),
    };
    let created = await sb.from('users').insert(row).select('id').single<{ id: number }>();
    // Ник в базе ещё записан за другим (тот сменил ник в Telegram, а этот занял) — заводим без ника, а не 500.
    if (created.error?.code === '23505' && created.error.message.includes('username')) {
      created = await sb.from('users').insert({ ...row, username: null }).select('id').single<{ id: number }>();
    }
    userId = must(created).id;
  }

  const sessionKey = randomToken();
  must(await sb.from('desktop_sessions').insert({ user_id: userId, telegram_id: who.id, device, token_hash: await tokenHash(sessionKey) }));
  const notice = { user_id: userId, telegram_id: who.id, device };
  c.executionCtx.waitUntil(signInNotice(c.env, sb, notice).catch((e: unknown) => console.error('desktop sign-in notice failed', notice.user_id, notice.telegram_id, e)));
  return c.json({ token: sessionKey, is_new: existing === null });
});
