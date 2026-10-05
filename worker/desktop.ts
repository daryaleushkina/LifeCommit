// Вход на компьютере (приложение для Mac и браузер, 05.10.2026). Подписи Telegram там нет, поэтому вход
// подтверждают в мини-аппе — как вход в Telegram Desktop по QR:
//   1. Компьютер: POST /api/desktop/login → случайный секрет и ссылка t.me/<бот>?start=mac_<билет>, где билет —
//      код (отпечаток секрета), время выдачи и подпись Worker'а. Ничего не пишется в базу: анонимно таблицу не забить.
//   2. Ссылка открывает чат с ботом: «Войти в LifeCommit на Mac?» и кнопка «Войти» (worker/desktopBot.ts, решение
//      владелицы 05.10.2026 — без мини-аппа). Старые ссылки startapp=mac_… открывают мини-апп с тем же вопросом
//      (POST /api/desktop/approve, только с подписью Telegram). Подпись билета верна и ему не больше 10 минут — запись
//      «код подтвердил такой-то» (approveLogin).
//   3. Компьютер опрашивает POST /api/desktop/login/poll с секретом; есть подтверждение — оно отмечается забранным,
//      компьютеру уходит долгий ключ сессии (`Authorization: Bearer <ключ>`, worker/auth.ts), а бот пишет человеку
//      «Вход на Mac. Не вы? — Выйти везде», как Telegram о новых сеансах.
// В базе — только отпечатки (SHA-256) кода и ключа. По ссылке ключ не забрать: нужен секрет, а он есть только у компьютера.
// Одна ссылка — один вход и только 10 минут: разосланная злоумышленником ссылка не собирает ключи всех, кто нажмёт «Войти»
// (05.10.2026, ревью доступа). Подписывает билет токен бота — секрет, который у Worker'а уже есть.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { App } from './api';
import { db, tg, type Env } from './env';

/** Подтверждение ждёт компьютер 10 минут. */
const LOGIN_TTL_MS = 10 * 60_000;
/** Ключ, которым не пользовались столько, истёк. */
const SESSION_IDLE_MS = 90 * 86_400_000;
/** Время последнего входа пишем не чаще раза в час — не на каждый запрос. */
const TOUCH_EVERY_MS = 3_600_000;

const DEVICES = ['mac', 'web'] as const;
export type Device = (typeof DEVICES)[number];
/** Где бывают сессии: компьютер по ссылке (mac, web) и нативные приложения через вход Telegram (worker/telegramLogin.ts). */
export type SessionDevice = Device | 'ios' | 'android';
const isDevice = (v: unknown): v is Device => typeof v === 'string' && (DEVICES as readonly string[]).includes(v);

/** 32 случайных байта в base64url — 43 знака. */
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
/** Билет в ссылке: код (первые 22 знака отпечатка секрета), время выдачи (секунды, base36, 7 знаков), подпись (22). */
const TICKET_RE = /^([A-Za-z0-9_-]{22})([0-9a-z]{7})([A-Za-z0-9_-]{22})$/;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
/** Код для ссылки из секрета компьютера. */
const codeOf = async (secret: string) => b64url(await sha256(secret)).slice(0, 22);
/** Отпечаток ключа сессии для базы. */
export const tokenHash = async (token: string) => [...(await sha256(token))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Подпись билета: HMAC-SHA256 токеном бота, первые 16 байт. Устройство тоже подписано — mac на web не поменять. */
async function signTicket(env: Env, device: Device, code: string, ts: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TELEGRAM_BOT_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`lifecommit-desktop-login|${device}|${code}|${ts}`));
  return b64url(new Uint8Array(mac).slice(0, 16));
}

/** Сравнение подписей за одинаковое время, чтобы по времени ответа нельзя было подбирать подпись. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const badRequest = () => new HTTPException(400, { message: 'bad_request' });

/** Тело запроса — объект; иначе 400. */
export async function body(req: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  const raw: unknown = await req.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw badRequest();
  return raw as Record<string, unknown>;
}

export interface DesktopSession {
  id: number;
  user_id: number;
  /** Аккаунт Telegram, который подтвердил вход (основной или связанный, users.telegram_aliases). */
  telegram_id: number;
  /** Где вошли: компьютер (mac, web) или приложение на телефоне (ios, android). */
  device: SessionDevice;
}

/**
 * Сессия компьютера по ключу из заголовка. Нет такой — null; истекла — удаляется, null с причиной.
 * Время последнего входа обновляется в фоне и не чаще раза в час.
 */
export async function desktopSession(env: Env, token: string, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<DesktopSession | 'expired' | null> {
  if (!SECRET_RE.test(token)) return null;
  const sb = db(env);
  const row = must(
    await sb.from('desktop_sessions').select('id, user_id, telegram_id, device, last_used_at').eq('token_hash', await tokenHash(token)).maybeSingle<DesktopSession & { last_used_at: string }>(),
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
        if (res.error) console.error('desktop session touch failed', row.id, res.error.message);
      }),
    );
  }
  return { id: row.id, user_id: row.user_id, telegram_id: row.telegram_id, device: row.device };
}

// ── Без подписи Telegram: компьютер начинает вход и забирает ключ ──

export const desktopLogin = new Hono<{ Bindings: Env }>();

desktopLogin.post('/login', async (c) => {
  const { device } = await body(c.req);
  if (!isDevice(device)) throw badRequest();
  const secret = randomToken();
  const code = await codeOf(secret);
  const ts = Math.floor(Date.now() / 1000).toString(36).padStart(7, '0');
  const ticket = `${code}${ts}${await signTicket(c.env, device, code, ts)}`;
  return c.json({ secret, code, ticket, link: `https://t.me/${c.env.BOT_USERNAME}?start=${device}_${ticket}` });
});

desktopLogin.post('/login/poll', async (c) => {
  const { secret } = await body(c.req);
  if (typeof secret !== 'string' || !SECRET_RE.test(secret)) throw badRequest();
  // Забрать подтверждение и выдать ключ — одним оператором (desktop_claim): упала выдача — подтверждение остаётся,
  // два опроса сразу двух ключей не получат.
  const token = randomToken();
  const sb = db(c.env);
  const rows = must(
    await sb.rpc('desktop_claim', {
      p_code: await codeOf(secret),
      p_token_hash: await tokenHash(token),
      p_since: new Date(Date.now() - LOGIN_TTL_MS).toISOString(),
    }),
  ) as ({ claimed: false; user_id: number; telegram_id: number; device: Device } | { claimed: true })[];
  const row = rows[0];
  if (!row) return c.json({ status: 'pending' });
  // Ключ по этому коду уже выдан (ответ с ним, видимо, потерялся) — второй не выдаём, компьютер начнёт вход заново.
  if (row.claimed) return c.json({ status: 'claimed' });
  c.executionCtx.waitUntil(
    signInNotice(c.env, sb, row).catch((e: unknown) => console.error('desktop sign-in notice failed', row.user_id, row.telegram_id, e)),
  );
  return c.json({ status: 'ok', token });
});

const WHERE: Record<SessionDevice, { ru: string; en: string }> = {
  mac: { ru: 'на Mac', en: 'on a Mac' },
  web: { ru: 'в браузере', en: 'in a browser' },
  ios: { ru: 'на iPhone', en: 'on an iPhone' },
  android: { ru: 'на Android', en: 'on Android' },
};

/**
 * Бот — тому аккаунту Telegram, кто вошёл: вход состоялся; не вы — «Выйти везде». Если вход подтвердили обманом
 * (по чужой ссылке), человек узнаёт сразу. Не написалось (бота не запускали) — в лог, вход это не отменяет.
 */
export async function signInNotice(env: Env, sb: ReturnType<typeof db>, who: { user_id: number; telegram_id: number; device: SessionDevice }) {
  const user = must(await sb.from('users').select('language_code').eq('id', who.user_id).maybeSingle<{ language_code: string }>());
  const en = user?.language_code === 'en';
  const where = WHERE[who.device][en ? 'en' : 'ru'];
  const text = en
    ? `Sign-in to LifeCommit ${where}. If it wasn't you, open LifeCommit → Me → Devices → Sign out everywhere.`
    : `Вход в LifeCommit ${where}. Если это были не вы — откройте LifeCommit → «Я» → «Устройства» → «Выйти везде».`;
  await tg(env, 'sendMessage', { chat_id: who.telegram_id, text });
}

// ── С подписью Telegram или ключом компьютера (после requireTelegram и поиска пользователя в api.ts) ──

export const desktopApi = new Hono<App>();

/** Чем кончилось подтверждение: ok, bad — билет не разобрать или подпись не та, expired — старше 10 минут, used — занят. */
export type ApproveResult = 'ok' | 'bad' | 'expired' | 'used';

/**
 * Подтвердить вход по билету из ссылки — из мини-аппа или кнопкой в чате с ботом. Проверка подписи — первой:
 * подделанный билет ничего не узнаёт ни о сроке, ни о базе. Код один на вход: уже подтверждённый (даже если компьютер
 * ключ забрал) — used.
 */
export async function approveLogin(env: Env, sb: ReturnType<typeof db>, a: { ticket: unknown; device: unknown; userId: number; telegramId: number }): Promise<ApproveResult> {
  const parts = typeof a.ticket === 'string' ? TICKET_RE.exec(a.ticket) : null;
  if (!parts || !isDevice(a.device)) return 'bad';
  const [, code, ts, sig] = parts as unknown as [string, string, string, string];
  if (!sameText(sig, await signTicket(env, a.device, code, ts))) return 'bad';
  if (Date.now() - parseInt(ts, 36) * 1000 > LOGIN_TTL_MS) return 'expired';
  // Заодно убираем подтверждения, которые компьютеры так и не забрали. Уборка необязательна: не вышла — в лог,
  // а подтверждение человека всё равно записываем.
  const cleanup = await sb.from('desktop_logins').delete().lt('approved_at', new Date(Date.now() - LOGIN_TTL_MS).toISOString());
  if (cleanup.error) console.error('desktop_logins cleanup failed', cleanup.error.message);
  const res = await sb.from('desktop_logins').insert({ code, user_id: a.userId, telegram_id: a.telegramId, device: a.device });
  if (res.error?.code === '23505') return 'used';
  must(res);
  return 'ok';
}

/** Подтвердить вход на компьютере из мини-аппа — только с подписью Telegram: ключом компьютера новые ключи не выпустить. */
desktopApi.post('/desktop/approve', async (c) => {
  if (c.get('desktop') !== undefined) throw new HTTPException(403, { message: 'telegram_only' });
  const { ticket, device } = await body(c.req);
  const result = await approveLogin(c.env, c.get('sb'), { ticket, device, userId: c.get('user').id, telegramId: c.get('tgUser').id });
  if (result === 'bad') throw badRequest();
  if (result === 'expired') throw new HTTPException(410, { message: 'login_expired' });
  if (result === 'used') throw new HTTPException(409, { message: 'login_used' });
  return c.json({ ok: true });
});

/** Устройства (компьютеры и телефоны), где вошли: свои; current — то, с которого спрашивают. */
desktopApi.get('/desktop/sessions', async (c) => {
  const rows = must(
    await c.get('sb').from('desktop_sessions').select('id, device, created_at, last_used_at').eq('user_id', c.get('user').id).order('id', { ascending: false }),
  ) as { id: number; device: SessionDevice; created_at: string; last_used_at: string }[];
  const current = c.get('desktop')?.id;
  return c.json(rows.map((r) => ({ ...r, current: r.id === current })));
});

/** Выйти на всех устройствах. */
desktopApi.delete('/desktop/sessions', async (c) => {
  must(await c.get('sb').from('desktop_sessions').delete().eq('user_id', c.get('user').id));
  return c.json({ ok: true });
});

/** Выйти на этом устройстве (компьютер или телефон). */
desktopApi.delete('/desktop/session', async (c) => {
  const desktop = c.get('desktop');
  if (!desktop) throw new HTTPException(400, { message: 'not_desktop' });
  must(await c.get('sb').from('desktop_sessions').delete().eq('id', desktop.id).eq('user_id', c.get('user').id));
  return c.json({ ok: true });
});
