// Жалоба из приложения (шторка «Сообщить о проблеме» на экране «Я»): текст, до 4 скриншотов и контекст.
// Скриншоты — в приватный bucket feedback Supabase Storage, владелице — сообщение с ними же.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_AUDIO_BYTES, takeVoiceQuota, type App } from './api';
import { BUCKET, cleanFeedback, EXT, FEEDBACK, imageType, notifyOwner, readContext, submitFeedback, type Attachment, type FeedbackContext, type ImageType } from './feedback';
import { transcribe } from './voice';

export const feedbackApi = new Hono<App>();

/** Тело формы: 4 картинки по 5 МБ и запас на текст и разметку. Больше — не разбираем. */
const MAX_BODY = FEEDBACK.maxFiles * FEEDBACK.maxImage + 1024 * 1024;

interface Image {
  bytes: ArrayBuffer;
  type: ImageType;
}

// multipart: text, context (JSON), files[] — картинки. Ответ {ok: true}; лимиты — 429, что не так с вводом — 400/413.
feedbackApi.post('/feedback', async (c) => {
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) throw new HTTPException(413, { message: 'too_big' });
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HTTPException(400, { message: 'bad_form' });
  }
  const rawText = form.get('text');
  const text = typeof rawText === 'string' ? cleanFeedback(rawText) : '';
  const rawContext = form.get('context');
  let context: FeedbackContext | null = null;
  if (typeof rawContext === 'string' && rawContext !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContext);
    } catch {
      throw new HTTPException(400, { message: 'bad_context' });
    }
    context = readContext(parsed);
  }
  const files = form.getAll('files');
  if (files.length > FEEDBACK.maxFiles) throw new HTTPException(400, { message: 'too_many_files' });
  const images: Image[] = [];
  for (const file of files) {
    if (typeof file === 'string') throw new HTTPException(400, { message: 'bad_file' });
    if (file.size > FEEDBACK.maxImage) throw new HTTPException(413, { message: 'file_too_big' });
    const bytes = await file.arrayBuffer();
    const type = imageType(new Uint8Array(bytes));
    if (!type) throw new HTTPException(400, { message: 'bad_file' });
    images.push({ bytes, type });
  }
  if (!text && !images.length) throw new HTTPException(400, { message: 'empty' });

  const user = c.get('user');
  const sb = c.get('sb');
  const submitted = await submitFeedback(sb, user.id, { source: 'app', text, attachments: [], context, confirmed: true });
  if (submitted.result === 'limit') throw new HTTPException(429, { message: 'feedback_limit' });
  if (submitted.result === 'project_limit') throw new HTTPException(429, { message: 'feedback_busy' });
  // Повтор того же текста за сутки — +1 у старой, владелице второй раз не пишем.
  if (submitted.result === 'duplicate') return c.json({ ok: true });

  await storeImages(sb, submitted.id, images);
  const note = { id: submitted.id, source: 'app' as const, confirmed: true, text, context, files: images.length, user };
  c.executionCtx.waitUntil(notifyOwner(c.env, sb, note, images));
  return c.json({ ok: true });
});

/**
 * Скриншоты — в хранилище, пути — в жалобу. Не вышло — убираем и загруженное, и саму жалобу (502): жалоба без
 * скриншотов — не та, что прислал человек, а повтор тогда считался бы «тем же текстом» и молча склеился бы с ней.
 */
async function storeImages(sb: SupabaseClient, id: number, images: Image[]): Promise<void> {
  if (!images.length) return;
  const paths = images.map((img, i) => `${id}/${i + 1}.${EXT[img.type]}`);
  const attachments: Attachment[] = paths.map((path) => ({ kind: 'storage', path }));
  const uploads = await Promise.all(images.map((img, i) => sb.storage.from(BUCKET).upload(paths[i]!, img.bytes, { contentType: img.type })));
  const failed = uploads.find((u) => u.error)?.error ?? (await sb.from('feedback').update({ attachments }).eq('id', id)).error;
  if (!failed) return;
  const [{ error: removeError }, { error: deleteError }] = await Promise.all([sb.storage.from(BUCKET).remove(paths), sb.from('feedback').delete().eq('id', id)]);
  // Всё в один лог: что не сохранилось и удалось ли прибрать за собой.
  console.error('feedback: screenshots not stored', id, failed, { removeError, deleteError });
  throw new HTTPException(502, { message: 'upload_failed' });
}

// Микрофон в шторке: голос → текст, который допишется в поле (человек увидит и поправит до отправки).
feedbackApi.post('/feedback/voice', async (c) => {
  const user = c.get('user');
  const audio = await c.req.arrayBuffer();
  if (audio.byteLength === 0) throw new HTTPException(400, { message: 'no_audio' });
  if (audio.byteLength > MAX_AUDIO_BYTES) throw new HTTPException(413, { message: 'too_long' });
  // Лимит общий с голосом в приложении и в боте.
  if (!(await takeVoiceQuota(c.get('sb'), user.id))) throw new HTTPException(429, { message: 'voice_limit' });
  try {
    const text = await transcribe(c.env, audio, user.language_code === 'en' ? 'en' : 'ru');
    return c.json({ text: cleanFeedback(text) });
  } catch (e) {
    console.error('feedback voice failed', e);
    throw new HTTPException(502, { message: 'failed' });
  }
});
