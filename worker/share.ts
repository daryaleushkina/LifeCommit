// «Поделиться» (дизайн круги 19–20): картинку рисует мини-апп, сюда она приходит готовым PNG.
// Хранилища у нас нет и не нужно: картинку загружаем в Telegram — боту в личку человеку без звука
// и сразу удаляем сообщение (file_id остаётся рабочим). Дальше:
//  • сторис — Telegram просит ссылку на картинку: отдаём её через /share/<file_id>, Worker проксирует файл из Telegram
//    (токен бота наружу не уходит);
//  • в чат — подготовленное сообщение (savePreparedInlineMessage) → в мини-аппе shareMessage, человек выбирает чат;
//    если Telegram не дал подготовить — бот присылает картинку в личку, оттуда её пересылают;
//  • сохранить — та же ссылка в downloadFile.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AuthVars } from './auth';
import { tg, type Env } from './env';

/** Картинка 1080×1920 PNG обычно 0,3–1,5 МБ; больше — что-то не так. */
const MAX_BYTES = 6_000_000;
/** file_id у Telegram — буквы, цифры, «-» и «_». */
const FILE_ID = /^[A-Za-z0-9_-]{20,200}$/;

type App = { Bindings: Env; Variables: AuthVars };

interface PhotoSize {
  file_id: string;
  width: number;
}

/** Загрузить картинку в Telegram: личка с ботом, без звука, сообщение тут же удаляется. */
async function upload(env: Env, chatId: number, png: ArrayBuffer): Promise<string> {
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('disable_notification', 'true');
  form.set('photo', new Blob([png], { type: 'image/png' }), 'lifecommit.png');
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
  const body = (await res.json()) as { ok: boolean; result?: { message_id: number; photo: PhotoSize[] }; description?: string };
  if (!body.ok || !body.result) throw new HTTPException(body.description?.includes('blocked') || body.description?.includes("can't initiate") ? 403 : 502, { message: 'share_upload' });
  await tg(env, 'deleteMessage', { chat_id: chatId, message_id: body.result.message_id }).catch(() => {});
  return body.result.photo.reduce((a, b) => (b.width > a.width ? b : a)).file_id;
}

export const shareApi = new Hono<App>();

shareApi.post('/share', async (c) => {
  const png = await c.req.arrayBuffer();
  if (png.byteLength === 0 || png.byteLength > MAX_BYTES) throw new HTTPException(400, { message: 'bad_image' });
  const fileId = await upload(c.env, c.get('tgUser').id, png);
  return c.json({ file_id: fileId, url: `${new URL(c.req.url).origin}/share/${fileId}.jpg` });
});

/** В чат: подготовленное сообщение с картинкой; не вышло — картинка приходит в личку с ботом. */
shareApi.post('/share/chat', async (c) => {
  const { file_id: fileId, caption } = await c.req.json<{ file_id?: string; caption?: string }>();
  if (!fileId || !FILE_ID.test(fileId)) throw new HTTPException(400, { message: 'bad_file' });
  const chatId = c.get('tgUser').id;
  const text = (caption ?? '').slice(0, 200);
  try {
    const prepared = await tg<{ id: string }>(c.env, 'savePreparedInlineMessage', {
      user_id: chatId,
      result: { type: 'photo', id: crypto.randomUUID().slice(0, 32), photo_file_id: fileId, caption: text },
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
    });
    return c.json({ prepared_id: prepared.id });
  } catch (e) {
    console.warn('share: prepared message failed, sending to DM', e);
    await tg(c.env, 'sendPhoto', { chat_id: chatId, photo: fileId, caption: text });
    return c.json({ sent: true });
  }
});

/** Картинка по ссылке — для сторис и «Сохранить»: отдаём файл из Telegram, не раскрывая токен. */
export const shareFiles = new Hono<{ Bindings: Env }>();

shareFiles.get('/:file', async (c) => {
  const fileId = c.req.param('file').replace(/\.(jpg|png)$/, '');
  if (!FILE_ID.test(fileId)) return c.notFound();
  const file = await tg<{ file_path?: string }>(c.env, 'getFile', { file_id: fileId }).catch(() => null);
  if (!file?.file_path) return c.notFound();
  const res = await fetch(`https://api.telegram.org/file/bot${c.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!res.ok || !res.body) return c.notFound();
  return new Response(res.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400', 'content-disposition': 'inline; filename="lifecommit.jpg"' } });
});
