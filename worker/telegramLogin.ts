// Вход в нативные приложения (iPhone, Android, Mac) — официальный вход Telegram по OpenID Connect (05.10.2026).
// Приложение само проходит oauth.telegram.org (PKCE, без секрета: так работает SDK Telegram для приложений) и присылает
// подписанный id_token. Worker проверяет подпись ключами Telegram, издателя, получателя (наш бот), срок — и выдаёт тот же
// ключ сессии, что компьютеру (`Authorization: Bearer <ключ>`, worker/desktop.ts). Кого нет — заводит из профиля
// Telegram: в приложение можно прийти, ни разу не открыв мини-апп. Один id_token — один вход.
// Наружу — только oauth.telegram.org (ключи подписи), адрес зашит.
//
// Важно для выпуска (ревью безопасности 05.10.2026): адрес возврата в @BotFather. Своя схема (lifecommit://) годится
// только для разработки — её может забрать любое приложение на телефоне и получить вход от имени человека. Перед
// выпуском — только https-адрес Telegram (universal link / App Link), docs/mobile.md.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { cleanText } from '../shared/text';
import { badRequest, body, must, randomToken, signInNotice, tokenHash, type SessionDevice } from './desktop';
import { byTelegram, db, type Env } from './env';

const ISSUER = 'https://oauth.telegram.org';
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
/** id_token старше этого не принимаем, даже если Telegram дал ему час: вход — сразу после выдачи. */
const MAX_AGE_S = 10 * 60;
/** Часы телефона и Telegram могут расходиться. */
const CLOCK_SKEW_S = 60;
/** Ключи Telegram помним час. */
const KEYS_TTL_MS = 3_600_000;
/** Незнакомый kid после промаха — к Telegram не чаще раза в минуту (подделки не гоняют нас туда на каждый запрос). */
const REFETCH_MS = 60_000;
/** Telegram не ответил — следующая попытка не раньше чем через 30 секунд. */
const RETRY_AFTER_FAIL_MS = 30_000;
/** Дольше ключи не ждём: человек должен получить «повторите позже», а не вечную загрузку. */
const JWKS_TIMEOUT_MS = 4_000;
/** Токен длиннее — не id_token Telegram (их длина ~1 КБ). */
const MAX_TOKEN = 8_192;

const DEVICES = ['ios', 'android', 'mac'] as const satisfies readonly SessionDevice[];
type PhoneDevice = (typeof DEVICES)[number];
const isDevice = (v: unknown): v is PhoneDevice => typeof v === 'string' && (DEVICES as readonly string[]).includes(v);

/** Id бота — первая часть токена; это client_id приложения и aud в id_token. */
const botId = (env: Env) => env.TELEGRAM_BOT_TOKEN.split(':')[0] ?? '';

const badToken = () => new HTTPException(401, { message: 'bad_token' });
const unreachable = () => new HTTPException(502, { message: 'telegram_unreachable' });

// ── Ключи Telegram ──

type Jwk = JsonWebKey & { kid?: string };
let keys: { list: Jwk[]; at: number } | null = null;
/** Импортированные ключи по kid — не импортировать на каждый вход. Чистится вместе со списком. */
let imported = new Map<string, Promise<CryptoKey>>();
/** Скачивание, которое уже идёт: одновременные входы на холодном isolate ждут его, а не качают каждый своё. */
let pending: Promise<Jwk[]> | null = null;
/** Когда последний раз искали kid и не нашли даже в свежескачанных. */
let lastMiss = 0;
/** Когда Telegram последний раз не ответил. */
let lastFail = 0;

/** Забыть скачанные ключи (тесты). */
export function forgetTelegramKeys() {
  keys = null;
  imported = new Map();
  pending = null;
  lastMiss = 0;
  lastFail = 0;
}

async function download(): Promise<Jwk[]> {
  let raw: unknown;
  try {
    const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    lastFail = Date.now();
    console.error('telegram jwks fetch failed', e);
    throw unreachable();
  }
  const list = (raw as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) {
    lastFail = Date.now();
    console.error('telegram jwks: no keys list');
    throw unreachable();
  }
  const valid = list.filter((k): k is Jwk => typeof k === 'object' && k !== null && typeof (k as Jwk).kid === 'string');
  // Пустой список — сбой Telegram, а не «ключей больше нет»: старые рабочие ключи не затираем.
  if (!valid.length) {
    lastFail = Date.now();
    console.error('telegram jwks: no usable keys', list.length);
    throw unreachable();
  }
  keys = { list: valid, at: Date.now() };
  imported = new Map();
  return valid;
}

function fetchKeys(): Promise<Jwk[]> {
  pending ??= download().finally(() => {
    pending = null;
  });
  return pending;
}

/**
 * Ключ по kid. Свежие (час) — из памяти. Незнакомый kid — Telegram, возможно, сменил ключ: перечитываем; сразу после
 * промаха (минута) или сбоя Telegram (30 с) — «повторите позже» (502), а не «неверный токен»: вдруг это новый ключ.
 * Ключи устарели, а Telegram не ответил — проверяем старыми: сбой Telegram не должен закрывать вход всем.
 */
async function keyFor(kid: string): Promise<Jwk | undefined> {
  const now = Date.now();
  const cached = keys?.list.find((k) => k.kid === kid);
  if (keys && now - keys.at < KEYS_TTL_MS) {
    if (cached) return cached;
    if (now - lastMiss < REFETCH_MS) throw unreachable();
  }
  if (now - lastFail < RETRY_AFTER_FAIL_MS) {
    if (cached) return cached;
    throw unreachable();
  }
  let fresh: Jwk[];
  try {
    fresh = await fetchKeys();
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
  const found = fresh.find((k) => k.kid === kid);
  if (!found) {
    lastMiss = Date.now();
    console.warn('telegram jwks: unknown kid after refetch', kid, fresh.map((k) => k.kid));
  }
  return found;
}

// ── Проверка id_token ──

const ALGS = {
  RS256: { importAs: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verifyAs: { name: 'RSASSA-PKCS1-v1_5' }, kty: 'RSA' },
  ES256: { importAs: { name: 'ECDSA', namedCurve: 'P-256' }, verifyAs: { name: 'ECDSA', hash: 'SHA-256' }, kty: 'EC' },
} as const;
type Alg = keyof typeof ALGS;

/** Ключ Telegram не импортируется — токен тут ни при чём: сбой у нас или у Telegram, 502 и в лог. */
function importKey(kid: string, alg: Alg, jwk: Jwk): Promise<CryptoKey> {
  const key = `${kid}:${alg}`;
  let p = imported.get(key);
  if (!p) {
    // Только сам ключ: alg/key_ops/ext из JWKS Telegram импорту не нужны и могут не совпасть с тем, как мы его используем.
    const bare: JsonWebKey = alg === 'RS256' ? { kty: jwk.kty, n: jwk.n, e: jwk.e } : { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    p = crypto.subtle.importKey('jwk', bare, ALGS[alg].importAs, false, ['verify']);
    imported.set(key, p);
    p.catch(() => imported.delete(key));
  }
  return p.catch((e: unknown) => {
    console.error('telegram jwk import failed', kid, alg, e);
    throw unreachable();
  });
}

/**
 * base64url → байты, только в каноничной записи. atob молча отбрасывает лишние младшие биты последнего знака, и у
 * одной подписи было бы до 16 записей (ревью 05.10.2026) — перекодируем обратно и сравниваем.
 */
function fromB64url(part: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(part) || part.length % 4 === 1) throw badToken();
  const bin = atob(part.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (part.length % 4)) % 4));
  const canonical = btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (canonical !== part) throw badToken();
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
  /** Подписанная часть токена (заголовок.данные): по ней узнаём повтор — у одной и той же подписи бывает несколько
   *  записей (ES256: (r, s) и (r, n − s) обе верны), а у содержания — одна. */
  signed: string;
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

/** Подпись, издатель, получатель, срок. Всё не так — 401; ключи Telegram не получить — 502. */
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
  const key = await importKey(header.kid, alg, jwk);
  let ok = false;
  try {
    ok = await crypto.subtle.verify(ALGS[alg].verifyAs, key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    // Подпись не того вида или размера — подделка.
  }
  if (!ok) throw badToken();

  if (claims.iss !== ISSUER) throw badToken();
  // client_id у Telegram — число: aud может прийти и числом, и строкой, и списком.
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.some((a) => (typeof a === 'string' || typeof a === 'number') && String(a) === botId(env))) throw badToken();
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') throw badToken();
  if (claims.iat > now + CLOCK_SKEW_S) throw badToken();
  if (claims.exp <= now || claims.iat < now - MAX_AGE_S) throw new HTTPException(401, { message: 'token_expired' });

  const id = claims.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw badToken();
  const text = (v: unknown, max: number) => (typeof v === 'string' ? cleanText(v, max) : '');
  const username = typeof claims.preferred_username === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(claims.preferred_username) ? claims.preferred_username : null;
  return {
    signed: `${h}.${p}`,
    id,
    // Имя в Telegram есть всегда; на всякий случай — полное имя, ник, и уж совсем без ничего — «Telegram», не пусто.
    firstName: text(claims.given_name, 64) || text(claims.name, 64) || username || 'Telegram',
    lastName: text(claims.family_name, 64) || null,
    username,
    photoUrl: typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture.slice(0, 512) : null,
  };
}

/** Первый вход нового человека — как первый вход в мини-апп: профиль из Telegram, язык — телефона. */
async function ensureUser(sb: ReturnType<typeof db>, who: TelegramProfile, language: unknown): Promise<{ id: number; isNew: boolean }> {
  const find = async () => must(await sb.from('users').select('id').or(byTelegram(who.id)).limit(1).maybeSingle<{ id: number }>());
  const existing = await find();
  if (existing) return { id: existing.id, isNew: false };
  const row = {
    id: who.id,
    first_name: who.firstName,
    last_name: who.lastName,
    username: who.username,
    photo_url: who.photoUrl,
    language_code: typeof language === 'string' && language.toLowerCase().startsWith('ru') ? 'ru' : 'en',
    last_seen_at: new Date().toISOString(),
  };
  let created = await sb.from('users').insert(row).select('id').single<{ id: number }>();
  // Ник в базе ещё записан за другим (тот сменил ник в Telegram, а этот занял) — заводим без ника, а не 500.
  if (created.error?.code === '23505' && created.error.message.includes('username')) {
    created = await sb.from('users').insert({ ...row, username: null }).select('id').single<{ id: number }>();
  }
  // Два первых входа сразу (двойное нажатие, повтор): второй уже не заводит — берёт заведённого первым.
  if (created.error?.code === '23505') {
    const raced = await find();
    if (raced) return { id: raced.id, isNew: false };
  }
  return { id: must(created).id, isNew: true };
}

// ── Маршруты (без подписи Telegram — раньше /api) ──

export const telegramLogin = new Hono<{ Bindings: Env }>();

/** Что приложению нужно для oauth.telegram.org: client_id — id бота. */
telegramLogin.get('/telegram/config', (c) => c.json({ client_id: botId(c.env) }));

telegramLogin.post('/telegram', async (c) => {
  const { id_token: token, device, language } = await body(c.req);
  if (typeof token !== 'string' || token.length > MAX_TOKEN || !isDevice(device)) throw badRequest();

  const who = await verify(c.env, token);
  const sb = db(c.env);
  // Один id_token — один вход: тот же токен второй раз — 409, второго ключа нет.
  const used = await sb.from('auth_token_uses').insert({ token_hash: await tokenHash(who.signed) });
  if (used.error?.code === '23505') throw new HTTPException(409, { message: 'token_used' });
  must(used);
  // Уборка старых отпечатков необязательна: не вышла — в лог, вход не страдает.
  c.executionCtx.waitUntil(
    Promise.resolve(sb.from('auth_token_uses').delete().lt('used_at', new Date(Date.now() - 2 * MAX_AGE_S * 1000).toISOString())).then((res) => {
      if (res.error) console.error('auth_token_uses cleanup failed', res.error.message);
    }),
  );

  const user = await ensureUser(sb, who, language);
  const sessionKey = randomToken();
  must(await sb.from('desktop_sessions').insert({ user_id: user.id, telegram_id: who.id, device, token_hash: await tokenHash(sessionKey) }));
  const notice = { user_id: user.id, telegram_id: who.id, device };
  c.executionCtx.waitUntil(signInNotice(c.env, sb, notice).catch((e: unknown) => console.error('desktop sign-in notice failed', notice.user_id, notice.telegram_id, e)));
  return c.json({ token: sessionKey, is_new: user.isNew });
});
