import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface Env {
  ASSETS: Fetcher;
  /** Workers AI: распознавание речи и разбор фраз (worker/voice.ts). */
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  BOT_USERNAME: string;
  /** Публичный адрес мини-аппа (кнопки в сообщениях бота из cron). */
  APP_URL: string;
  /** Ключ Gemini API (Google AI Studio, проект LifeCommit). Нет ключа — фразы разбирает Workers AI. */
  GEMINI_API_KEY?: string;
  /** Ключ шифрования паролей календарей (AES-GCM, 32 байта в base64). Нет ключа — календари не подключить. */
  CALENDAR_KEY: string;
  /** Только для проверки: свой CalDAV-сервер вместо iCloud (например, локальный Radicale). */
  CALDAV_APPLE_URL?: string;
  /** Только в .dev.vars: принимать подделанную initData из mockEnv. */
  DEV_AUTH_BYPASS?: string;
}

export function db(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Вызов Bot API. Бросает, если Telegram ответил ok: false. */
export async function tg<T = unknown>(env: Env, method: string, payload: object): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!body.ok) throw new Error(`Telegram ${method}: ${body.description ?? res.status}`);
  return body.result;
}
