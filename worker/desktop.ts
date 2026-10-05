// Вход на компьютере (приложение для Mac и браузер, 05.10.2026). Подписи Telegram там нет, поэтому вход
// подтверждают в мини-аппе — как вход в Telegram Desktop по QR:
//   1. Компьютер: POST /api/desktop/login → случайный секрет и ссылка t.me/<бот>?startapp=mac_<код>, где код —
//      отпечаток секрета. Ничего не пишется в базу: анонимно таблицу не забить.
//   2. Человек открывает ссылку в Telegram, мини-апп спрашивает «Войти на компьютере?» → POST /api/desktop/approve
//      (только с подписью Telegram) — запись «код подтвердил такой-то» на 10 минут.
//   3. Компьютер опрашивает POST /api/desktop/login/poll с секретом; есть подтверждение — запись удаляется, компьютеру
//      уходит долгий ключ сессии. С ним он ходит в API заголовком `Authorization: Bearer <ключ>` (worker/auth.ts).
// В базе — только отпечатки (SHA-256) кода и ключа. По ссылке ключ не забрать: нужен секрет, а он есть только у компьютера.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { App } from './api';
import { db, type Env } from './env';

/** Подтверждение ждёт компьютер 10 минут. */
const LOGIN_TTL_MS = 10 * 60_000;
/** Ключ, которым не пользовались столько, истёк. */
const SESSION_IDLE_MS = 90 * 86_400_000;
/** Время последнего входа пишем не чаще раза в час — не на каждый запрос. */
const TOUCH_EVERY_MS = 3_600_000;

const DEVICES = ['mac', 'web'] as const;
export type Device = (typeof DEVICES)[number];
const isDevice = (v: unknown): v is Device => typeof v === 'string' && (DEVICES as readonly string[]).includes(v);

/** 32 случайных байта в base64url — 43 знака. */
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
/** Код в ссылке — первые 22 знака отпечатка секрета (132 бита). */
const CODE_RE = /^[A-Za-z0-9_-]{22}$/;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
/** Код для ссылки из секрета компьютера. */
const codeOf = async (secret: string) => b64url(await sha256(secret)).slice(0, 22);
/** Отпечаток ключа сессии для базы. */
const tokenHash = async (token: string) => [...(await sha256(token))].map((b) => b.toString(16).padStart(2, '0')).join('');

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const badRequest = () => new HTTPException(400, { message: 'bad_request' });

/** Тело запроса — объект; иначе 400. */
async function body(req: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  const raw: unknown = await req.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw badRequest();
  return raw as Record<string, unknown>;
}

export interface DesktopSession {
  id: number;
  user_id: number;
}

/**
 * Сессия компьютера по ключу из заголовка. Нет такой — null; истекла — удаляется, null с причиной.
 * Время последнего входа обновляется в фоне и не чаще раза в час.
 */
export async function desktopSession(env: Env, token: string, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<DesktopSession | 'expired' | null> {
  if (!SECRET_RE.test(token)) return null;
  const sb = db(env);
  const row = must(
    await sb.from('desktop_sessions').select('id, user_id, last_used_at').eq('token_hash', await tokenHash(token)).maybeSingle<DesktopSession & { last_used_at: string }>(),
  );
  if (!row) return null;
  const idle = Date.now() - new Date(row.last_used_at).getTime();
  if (idle > SESSION_IDLE_MS) {
    must(await sb.from('desktop_sessions').delete().eq('id', row.id));
    return 'expired';
  }
  if (idle > TOUCH_EVERY_MS) {
    ctx.waitUntil(
      Promise.resolve(sb.from('desktop_sessions').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)).then((res) => {
        if (res.error) console.error('desktop session touch failed', res.error.message);
      }),
    );
  }
  return { id: row.id, user_id: row.user_id };
}

// ── Без подписи Telegram: компьютер начинает вход и забирает ключ ──

export const desktopLogin = new Hono<{ Bindings: Env }>();

desktopLogin.post('/login', async (c) => {
  const { device } = await body(c.req);
  if (!isDevice(device)) throw badRequest();
  const secret = randomToken();
  const code = await codeOf(secret);
  return c.json({ secret, code, link: `https://t.me/${c.env.BOT_USERNAME}?startapp=${device}_${code}` });
});

desktopLogin.post('/login/poll', async (c) => {
  const { secret } = await body(c.req);
  if (typeof secret !== 'string' || !SECRET_RE.test(secret)) throw badRequest();
  const sb = db(c.env);
  // Забрать подтверждение и удалить одним запросом: два опроса подряд не получат два ключа.
  const rows = must(
    await sb
      .from('desktop_logins')
      .delete()
      .eq('code', await codeOf(secret))
      .gt('approved_at', new Date(Date.now() - LOGIN_TTL_MS).toISOString())
      .select('user_id, device'),
  ) as { user_id: number; device: Device }[];
  const login = rows[0];
  if (!login) return c.json({ status: 'pending' });
  const token = randomToken();
  must(await sb.from('desktop_sessions').insert({ user_id: login.user_id, device: login.device, token_hash: await tokenHash(token) }));
  return c.json({ status: 'ok', token });
});

// ── С подписью Telegram или ключом компьютера (после requireTelegram и поиска пользователя в api.ts) ──

export const desktopApi = new Hono<App>();

/** Подтвердить вход на компьютере — только из Telegram: ключом компьютера новые ключи не выпустить. */
desktopApi.post('/desktop/approve', async (c) => {
  if (c.get('desktop') !== undefined) throw new HTTPException(403, { message: 'telegram_only' });
  const { code, device } = await body(c.req);
  if (typeof code !== 'string' || !CODE_RE.test(code) || !isDevice(device)) throw badRequest();
  const sb = c.get('sb');
  // Заодно убираем подтверждения, которые компьютеры так и не забрали.
  must(await sb.from('desktop_logins').delete().lt('approved_at', new Date(Date.now() - LOGIN_TTL_MS).toISOString()));
  const res = await sb.from('desktop_logins').insert({ code, user_id: c.get('user').id, device });
  // Код уже подтвердил кто-то (или вы сами раньше) — второй раз нельзя: вход не перехватить.
  if (res.error?.code === '23505') throw new HTTPException(409, { message: 'login_used' });
  must(res);
  return c.json({ ok: true });
});

/** Компьютеры, где вошли: свои; current — тот, с которого спрашивают. */
desktopApi.get('/desktop/sessions', async (c) => {
  const rows = must(
    await c.get('sb').from('desktop_sessions').select('id, device, created_at, last_used_at').eq('user_id', c.get('user').id).order('id', { ascending: false }),
  ) as { id: number; device: Device; created_at: string; last_used_at: string }[];
  const current = c.get('desktop');
  return c.json(rows.map((r) => ({ ...r, current: r.id === current })));
});

/** Выйти на всех компьютерах. */
desktopApi.delete('/desktop/sessions', async (c) => {
  must(await c.get('sb').from('desktop_sessions').delete().eq('user_id', c.get('user').id));
  return c.json({ ok: true });
});

/** Выйти на этом компьютере. */
desktopApi.delete('/desktop/session', async (c) => {
  const id = c.get('desktop');
  if (id === undefined) throw new HTTPException(400, { message: 'not_desktop' });
  must(await c.get('sb').from('desktop_sessions').delete().eq('id', id).eq('user_id', c.get('user').id));
  return c.json({ ok: true });
});
