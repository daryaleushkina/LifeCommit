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
  /** Клиент OAuth Google (проект LifeCommit в Google Cloud): подключение Google Календаря. Нет — Google не подключить. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Только для проверки: свой CalDAV-сервер вместо iCloud (например, локальный Radicale). */
  CALDAV_APPLE_URL?: string;
  /** Только в .dev.vars: принимать подделанную initData из mockEnv. */
  DEV_AUTH_BYPASS?: string;
}

/**
 * Фильтр «пользователь этого аккаунта Telegram»: свой id или связанный (другой аккаунт того же человека,
 * users.telegram_aliases). Одним запросом: `.or(byTelegram(id)).limit(1)`.
 */
export const byTelegram = (telegramId: number) => `id.eq.${Math.trunc(telegramId)},telegram_aliases.cs.{${Math.trunc(telegramId)}}`;

export function db(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Отказ Bot API: код и подробности — по ним видно, что чат удалён, бота выгнали или чат стал супергруппой. */
export class TgError extends Error {
  constructor(
    method: string,
    readonly code: number,
    readonly description: string,
    readonly parameters: { migrate_to_chat_id?: number; retry_after?: number } = {},
  ) {
    super(`Telegram ${method}: ${description}`);
  }
}

/** Вызов Bot API. Бросает TgError, если Telegram ответил ok: false. */
export async function tg<T = unknown>(env: Env, method: string, payload: object): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { ok: boolean; result: T; error_code?: number; description?: string; parameters?: TgError['parameters'] };
  if (!body.ok) throw new TgError(method, body.error_code ?? res.status, body.description ?? String(res.status), body.parameters);
  return body.result;
}
