// Тесты сервера целиком (*.int.test.ts): настоящий Worker (worker/index.ts) против локальной Supabase,
// внешние сервисы — подменены. Нужна `pnpm db:start`; без неё такие тесты пропускаются с предупреждением.
//
//   const u = await user();                       // свежий пользователь (удаляется в afterEach)
//   const res = await u.call('POST', '/tasks', {…}); // запрос к /api от его имени: { status, body }
//   tg.calls                                       // что Worker отправил в Telegram
//   tg.reply('sendMessage', { ok: false, … })      // что Telegram ответит на метод (одноразово)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach } from 'vitest';
import worker from '../index';
import type { Env } from '../env';

const MOCK_HASH = 'mock-hash-not-valid-for-backend';

/** Переменные из .dev.vars (локальная Supabase), токен бота — заведомо ненастоящий: в Telegram тесты не пишут. */
function devVars(): Record<string, string> {
  try {
    const text = String(readFileSync(fileURLToPath(new URL('../../.dev.vars', import.meta.url).href)));
    return Object.fromEntries(
      text
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l && !l.startsWith('#') && l.includes('='))
        .map((l: string) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
  } catch {
    return {};
  }
}

const vars = devVars();

/** Workers AI в тестах: что вернуть на распознавание и разбор (задаётся тестом). */
export const ai = {
  transcript: 'купить молоко',
  parse: '{"habits":[],"todos":[]}',
  calls: [] as { model: string }[],
};

export const env: Env = {
  ASSETS: { fetch: async () => new Response('assets') } as unknown as Fetcher,
  AI: {
    run: async (model: string) => {
      ai.calls.push({ model });
      return model.includes('whisper') ? { text: ai.transcript } : { response: ai.parse };
    },
  } as unknown as Ai,
  SUPABASE_URL: vars.SUPABASE_URL ?? 'http://127.0.0.1:55421',
  SUPABASE_SECRET_KEY: vars.SUPABASE_SECRET_KEY ?? '',
  TELEGRAM_BOT_TOKEN: '7000000001:TEST-TOKEN',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  BOT_USERNAME: 'LifeCommit_bot',
  APP_URL: 'https://lifecommit.test',
  GEMINI_API_KEY: 'test-gemini-key',
  CALENDAR_KEY: vars.CALENDAR_KEY ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  GOOGLE_CLIENT_ID: 'test-google-client',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
  CALDAV_APPLE_URL: 'https://caldav.test',
  DEV_AUTH_BYPASS: '1',
  // Владелица — не пользователь базы: жалобы уходят в этот чат (тест может подменить на настоящего пользователя).
  OWNER_ID: '7000000099',
};

/** Прямой доступ к локальной базе — проверить, что записалось. */
export const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

/** Доступна ли локальная Supabase (проверяется один раз). */
export async function dbReady(): Promise<boolean> {
  try {
    const res = await realFetch(`${env.SUPABASE_URL}/rest/v1/`, { headers: { apikey: env.SUPABASE_SECRET_KEY } });
    return res.status < 500;
  } catch {
    return false;
  }
}

// ── Подменённая сеть ──

const realFetch = globalThis.fetch.bind(globalThis);

export interface TgCall {
  method: string;
  body: Record<string, unknown>;
}

/** Telegram Bot API: всё, что отправлено, и ответы на методы. */
export const tg = {
  calls: [] as TgCall[],
  queued: new Map<string, unknown[]>(),
  /** Следующий вызов метода получит этот ответ (целиком: { ok, result } или { ok: false, error_code, description }). */
  reply(method: string, response: unknown) {
    this.queued.set(method, [...(this.queued.get(method) ?? []), response]);
  },
  sent(method: string) {
    return this.calls.filter((c) => c.method === method);
  },
};

/** Прочие внешние адреса: тест задаёт ответ по началу адреса; не задан — тест падает (никакой живой сети). */
export const net = {
  routes: [] as { prefix: string; respond: (req: Request) => Response | Promise<Response> }[],
  calls: [] as { url: string; method: string; body: string }[],
  on(prefix: string, respond: (req: Request) => Response | Promise<Response>) {
    this.routes.unshift({ prefix, respond });
  },
};

async function tgRespond(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/file/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
  const method = url.pathname.split('/').pop() ?? '';
  let body: Record<string, unknown> = {};
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  else if (type.includes('form')) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) body[k] = typeof v === 'string' ? v : '[file]';
  }
  tg.calls.push({ method, body });
  const queued = tg.queued.get(method);
  if (queued?.length) return Response.json(queued.shift());
  const results: Record<string, unknown> = {
    sendMessage: { message_id: 100 + tg.calls.length },
    sendPhoto: { message_id: 200, photo: [{ file_id: 'small-file-id-0000000000', width: 90 }, { file_id: 'photo-file-id-1234567890', width: 1080 }] },
    getFile: { file_path: 'photos/file_1.jpg' },
    getChat: { id: body.chat_id, title: 'Чат', type: 'group' },
    getChatMember: { status: 'administrator', user: { id: 7000000001 } },
    savePreparedInlineMessage: { id: 'prepared-1' },
    getMe: { id: 7000000001, username: 'LifeCommit_bot' },
  };
  return Response.json({ ok: true, result: results[method] ?? true });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = req.url;
  if (url.startsWith(env.SUPABASE_URL)) return realFetch(req);
  if (url.startsWith('https://api.telegram.org/')) return tgRespond(req);
  const route = net.routes.find((r) => url.startsWith(r.prefix));
  net.calls.push({ url, method: req.method, body: req.method === 'GET' ? '' : await req.clone().text() });
  if (route) return route.respond(req);
  throw new Error(`тест вышел в живую сеть: ${req.method} ${url}`);
}) as typeof fetch;

// Кэш Cloudflare (caches.default) в Node — простая память.
const cacheStore = new Map<string, Response>();
(globalThis as unknown as { caches: unknown }).caches = {
  default: {
    match: async (req: Request) => cacheStore.get(req.url)?.clone(),
    put: async (req: Request, res: Response) => void cacheStore.set(req.url, res.clone()),
  },
};

// ── Запросы к Worker ──

/** Контекст исполнения: фоновые задачи (waitUntil) дожидаемся, чтобы проверить их результат. */
export function ctx() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => void pending.push(p.catch((e) => console.error('waitUntil', e))),
    passThroughOnException: () => {},
    props: {},
    settle: () => Promise.all(pending),
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
}

/** Запрос к Worker как снаружи; фоновые задачи — дождаться. */
export async function request<T = any>(path: string, init: RequestInit = {}): Promise<Res<T>> {
  const c = ctx();
  const res = await worker.fetch(new Request(`https://lifecommit.test${path}`, init), env, c as unknown as ExecutionContext);
  await c.settle();
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // не JSON — отдаём как есть
  }
  return { status: res.status, body: body as T };
}

/** Тик cron — как его запускает Cloudflare: 15 минут — напоминания, чаты групп, календари, срок жалоб; 5 минут — черновики /bug. */
export async function cronTick(cron: '*/15 * * * *' | '*/5 * * * *' = '*/15 * * * *') {
  const c = ctx();
  await worker.scheduled!({ cron, scheduledTime: Date.now(), type: 'scheduled', noRetry() {} } as unknown as ScheduledController, env, c as unknown as ExecutionContext);
  await c.settle();
}

/** Апдейт от Telegram в webhook бота. */
export async function botUpdate(update: object, secret = env.TELEGRAM_WEBHOOK_SECRET) {
  return request('/bot/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify(update),
  });
}

export interface TestUser {
  id: number;
  initData: string;
  call: <T = any>(method: string, path: string, body?: unknown) => Promise<Res<T>>;
}

const created: number[] = [];

/** Свежий пользователь Telegram (id из тестового диапазона), сразу с сессией — как после первого входа. */
export async function user(opts: { id?: number; name?: string; lang?: string; timezone?: string } = {}): Promise<TestUser> {
  const id = opts.id ?? 9_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const initData = new URLSearchParams([
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['hash', MOCK_HASH],
    ['signature', 'mock-signature'],
    ['user', JSON.stringify({ id, first_name: opts.name ?? 'Тест', language_code: opts.lang ?? 'ru', username: `u${id}` })],
  ]).toString();
  const call = <T,>(method: string, path: string, body?: unknown) =>
    request<T>(`/api${path}`, {
      method,
      headers: { Authorization: `tma ${initData}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
      ...(body !== undefined && { body: typeof body === 'string' || body instanceof Blob || body instanceof ArrayBuffer ? (body as BodyInit) : JSON.stringify(body) }),
    });
  created.push(id);
  await call('POST', '/session', { timezone: opts.timezone ?? 'Europe/Moscow' });
  return { id, initData, call };
}

beforeEach(() => {
  tg.calls = [];
  tg.queued.clear();
  net.routes = [];
  net.calls = [];
  ai.calls = [];
});

afterEach(async () => {
  // Группы при удалении пользователя остаются без владельца — убираем сами, потом пользователей.
  const ids = created.splice(0);
  if (!ids.length) return;
  await sb.from('groups').delete().in('owner_id', ids);
  await sb.from('users').delete().in('id', ids);
});
