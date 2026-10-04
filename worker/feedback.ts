// Жалобы пользователей (docs/feedback.md, этап 1 — приём). Приложение (worker/feedbackApi.ts) и бот (/bug,
// worker/feedbackBot.ts) кладут жалобу через submitFeedback: лимиты и повторы считает база (submit_feedback) в одной
// транзакции со вставкой. Пока рутины разбора нет, каждая новая жалоба уходит владелице в Telegram.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanText } from '../shared/text';
import { db, tg, TgError, type Env } from './env';

/** Все числа приёма в одном месте (решения владелицы 03–04.10.2026). */
export const FEEDBACK = {
  perHour: 3,
  perDay: 10,
  /** На весь проект за сутки по UTC. */
  projectDay: 200,
  maxText: 2000,
  maxFiles: 4,
  maxImage: 5 * 1024 * 1024,
  maxVoiceSeconds: 120,
  /** Тишина в черновике /bug, после которой жалоба уходит сама. */
  draftMinutes: 10,
  /** Хранить после закрытия и вообще с подачи. */
  keepClosedDays: 14,
  keepDays: 60,
} as const;

/** Приватный bucket Supabase Storage со скриншотами из приложения. */
export const BUCKET = 'feedback';

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export const EXT: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export type Attachment = { kind: 'tg_photo'; file_id: string } | { kind: 'storage'; path: string };

/** Ответ supabase-js: ошибка — исключение (supabase-js сам не бросает), иначе данные. */
export function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`feedback: ${what}: ${res.error.message}`);
  return res.data as T;
}

/** Отрезать до max единиц UTF-16 по целым символам (без половинок эмодзи). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * Текст жалобы: каждая строка — через cleanText (невидимые, bidi, управляющие), но переводы строк остаются — так
 * человек делит рассказ на части. HTML-комментарии вырезаются (в них прячут текст от глаз владелицы), пустых строк
 * подряд — не больше одной, всего — до 2000 символов.
 */
export function cleanFeedback(raw: string): string {
  const lines = raw
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .split(/\r\n|[\n\r\u2028\u2029\u0085]/)
    .map((line) => cleanText(line));
  return cut(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), FEEDBACK.maxText).trimEnd();
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Картинка по первым байтам, а не по типу, который назвал телефон: JPEG, PNG, WebP; остальное — null. */
export function imageType(b: Uint8Array): ImageType | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (PNG.every((x, i) => b[i] === x)) return 'image/png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Что прикладывает приложение (этап 1). Остальные поля, если пришли, не берём. */
const CONTEXT_KEYS = ['version', 'platform', 'lang', 'theme', 'viewport', 'tz', 'screen'] as const;
export type FeedbackContext = Partial<Record<(typeof CONTEXT_KEYS)[number], string>>;

/** Контекст от приложения — недоверенный ввод: только известные поля-строки, вычищенные, до 100 символов. */
export function readContext(raw: unknown): FeedbackContext | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: FeedbackContext = {};
  for (const key of CONTEXT_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    const clean = typeof value === 'string' ? cleanText(value, 100) : '';
    if (clean) out[key] = clean;
  }
  return Object.keys(out).length ? out : null;
}

export interface OwnerNote {
  id: number;
  source: 'bot' | 'app';
  confirmed: boolean;
  text: string;
  context: FeedbackContext | null;
  files: number;
  user: { id: number; first_name: string; username: string | null };
}

/** Сообщение владелице о новой жалобе — простым текстом (без разметки: текст человека ничего не сверстает). */
export function ownerMessage(n: OwnerNote): string {
  const head = [
    `🐞 Жалоба #${n.id} · ${n.source === 'bot' ? 'из бота' : 'из приложения'}`,
    ...(n.confirmed ? [] : ['Не подтверждена: ушла сама через 10 минут — возможно, не баг']),
    `От: ${n.user.first_name}${n.user.username ? ` @${n.user.username}` : ''} · id ${n.user.id}`,
  ];
  let body = n.text || '(без текста)';
  if (n.context) body += `\n\n${Object.entries(n.context).map(([k, v]) => `${k} ${v}`).join(' · ')}`;
  if (n.files) body += `\nСкриншотов: ${n.files}`;
  return `${head.join('\n')}\n\n${body}`;
}

/** «/bug», «/bug@бот» и «/bug текст» → текст после команды ('' — без текста); другое — null. */
export function bugCommand(text: string | undefined, botUsername: string): string | null {
  const m = /^\/bug(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(text ?? '');
  if (!m || (m[1] !== undefined && m[1].toLowerCase() !== botUsername.toLowerCase())) return null;
  return (m[2] ?? '').trim();
}

export type Submitted = { result: 'ok'; id: number } | { result: 'duplicate'; id: number } | { result: 'limit' } | { result: 'project_limit' };

/** Принять жалобу: лимиты, повтор того же текста за сутки (+1 у старой) и вставка — одной транзакцией в базе. */
export async function submitFeedback(
  sb: SupabaseClient,
  userId: number,
  f: { source: 'bot' | 'app'; text: string; attachments: Attachment[]; context: FeedbackContext | null; confirmed: boolean },
): Promise<Submitted> {
  const data = check(await sb.rpc('submit_feedback', {
    p_user: userId,
    p_source: f.source,
    p_text: f.text,
    p_attachments: f.attachments,
    p_context: f.context,
    p_confirmed: f.confirmed,
    p_per_hour: FEEDBACK.perHour,
    p_per_day: FEEDBACK.perDay,
    p_project_day: FEEDBACK.projectDay,
  }), 'submit_feedback');
  return data as Submitted;
}

/** Скриншот для владелицы: из бота — file_id Telegram, из приложения — байты, которые только что пришли. */
export type OwnerPhoto = { file_id: string } | { bytes: ArrayBuffer; type: ImageType };

/** Чаты владелицы: основной аккаунт и связанные (как у напоминаний в worker/cron.ts). Не задана — никому. */
async function ownerChats(env: Env, sb: SupabaseClient): Promise<number[]> {
  const owner = Number(env.OWNER_ID);
  if (!env.OWNER_ID || !Number.isSafeInteger(owner)) return [];
  const row = check(await sb.from('users').select('telegram_aliases').eq('id', owner).maybeSingle<{ telegram_aliases: number[] }>(), 'owner not read');
  return [owner, ...(row?.telegram_aliases ?? [])];
}

async function sendPhoto(env: Env, chat: number, photo: OwnerPhoto, caption: string): Promise<void> {
  if ('file_id' in photo) {
    await tg(env, 'sendPhoto', { chat_id: chat, photo: photo.file_id, caption });
    return;
  }
  const form = new FormData();
  form.set('chat_id', String(chat));
  form.set('caption', caption);
  form.set('photo', new Blob([photo.bytes], { type: photo.type }), `shot.${EXT[photo.type]}`);
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
  // Не JSON — тоже исключение: его ловит и пишет в лог notifyOwner.
  const body = JSON.parse(await res.text()) as { ok?: unknown; error_code?: number; description?: string } | null;
  if (body?.ok !== true) throw new TgError('sendPhoto', body?.error_code ?? res.status, body?.description ?? String(res.status));
}

/**
 * Новая жалоба — владелице: текст и скриншоты в каждый её чат. Не дошло — в лог: жалоба уже в базе, человеку
 * «Получили» сказано, и от сбоя Telegram она не пропадёт.
 */
export async function notifyOwner(env: Env, sb: SupabaseClient, note: OwnerNote, photos: OwnerPhoto[]): Promise<void> {
  let chats: number[] = [];
  try {
    chats = await ownerChats(env, sb);
  } catch (e) {
    console.error('feedback: owner chats not read', note.id, e);
  }
  for (const chat of chats) {
    try {
      await tg(env, 'sendMessage', { chat_id: chat, text: ownerMessage(note) });
      for (const photo of photos) await sendPhoto(env, chat, photo, `#${note.id}`);
    } catch (e) {
      console.error('feedback: owner not notified', chat, note.id, e);
    }
  }
}

/** Пути скриншотов в хранилище из attachments (jsonb нашей же таблицы, пишет его только Worker). */
export const storagePaths = (attachments: Attachment[]): string[] => attachments.flatMap((a) => (a.kind === 'storage' ? [a.path] : []));

/** Удалить скриншоты из хранилища. Пустой список хранилище не принимает (400) — тогда и звать его незачем. */
async function removeFiles(sb: SupabaseClient, paths: string[], what: string): Promise<void> {
  if (paths.length) check(await sb.storage.from(BUCKET).remove(paths), what);
}

/** Скриншоты жалоб человека — прочь из хранилища (перед удалением аккаунта: строки уйдут каскадом, файлы — нет). */
export async function removeUserFeedbackFiles(sb: SupabaseClient, userId: number): Promise<void> {
  const rows = check(await sb.from('feedback').select('attachments').eq('user_id', userId).returns<{ attachments: Attachment[] }[]>(), 'files not listed');
  await removeFiles(sb, rows.flatMap((r) => storagePaths(r.attachments)), 'files not removed');
}

/**
 * Срок хранения (cron раз в 15 минут): закрытые 14 дней назад и любые старше 60 дней — сначала файлы, потом строки.
 * Файлы не удалились — строки оставляем: на следующем тике попробуем снова, а не потеряем путь к файлу.
 */
export async function feedbackCleanup(env: Env): Promise<void> {
  const sb = db(env);
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const old = check(
    await sb
      .from('feedback')
      .select('id, attachments')
      .or(`closed_at.lt.${ago(FEEDBACK.keepClosedDays)},created_at.lt.${ago(FEEDBACK.keepDays)}`)
      // Хранилище удаляет не больше 1000 файлов за раз: 200 жалоб × 4 скриншота с запасом. Остальные — на следующем тике.
      .limit(200)
      .returns<{ id: number; attachments: Attachment[] }[]>(),
    'old not listed',
  );
  if (!old.length) return;
  await removeFiles(sb, old.flatMap((r) => storagePaths(r.attachments)), 'old files not removed');
  check(await sb.from('feedback').delete().in('id', old.map((r) => r.id)), 'old not deleted');
}
