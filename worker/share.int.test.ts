// «Поделиться»: картинка уходит в Telegram (личка с ботом, сообщение сразу удаляется), дальше — в чат или по ссылке.
import { afterEach, describe, expect, it } from 'vitest';
import worker from './index';
import { ctx, dbReady, env, request, tg, user } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('share-тесты пропущены: нет локальной Supabase (pnpm db:start)');

const APP = 'https://lifecommit.test';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** file_id, которого ещё нет в кэше картинок (кэш общий на все тесты файла). */
const freshFileId = () => `file-${crypto.randomUUID().replaceAll('-', '')}`;

/** Запрос к Worker как снаружи — с заголовками ответа. */
async function fetchRaw(path: string) {
  const c = ctx();
  const res = await worker.fetch(new Request(`${APP}${path}`), env, c as unknown as ExecutionContext);
  await c.settle();
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}

// Скачивание файла из Telegram harness всегда отдаёт; для отказа подменяем fetch поверх него.
const harnessFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = harnessFetch;
});
function failFileDownloads() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/`)) return new Response('gone', { status: 404 });
    return harnessFetch(req);
  }) as typeof fetch;
}

/** Загрузить картинку от имени человека. */
const upload = (u: Awaited<ReturnType<typeof user>>, body: BodyInit, type = 'image/jpeg') =>
  request(`/api/share`, { method: 'POST', headers: { Authorization: `tma ${u.initData}`, 'content-type': type }, body });

describe.skipIf(!ready)('POST /api/share', () => {
  it('JPEG: загружаем в личку без звука, берём самый крупный размер, сообщение удаляем', async () => {
    const u = await user();
    const res = await upload(u, JPEG);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ file_id: 'photo-file-id-1234567890', url: `${APP}/share/photo-file-id-1234567890.jpg` });
    expect(tg.sent('sendPhoto')[0]!.body).toEqual({ chat_id: String(u.id), disable_notification: 'true', photo: '[file]' });
    expect(tg.sent('deleteMessage')[0]!.body).toEqual({ chat_id: u.id, message_id: 200 });
  });

  it('PNG от старых клиентов тоже принимаем; удалить сообщение не вышло — не страшно', async () => {
    const u = await user();
    // крупный размер — первым в списке: всё равно берём его
    tg.reply('sendPhoto', { ok: true, result: { message_id: 201, photo: [{ file_id: 'big-file-id-123456789012', width: 1080 }, { file_id: 'small-file-id-0000000000', width: 90 }] } });
    tg.reply('deleteMessage', { ok: false, error_code: 400, description: 'Bad Request: message to delete not found' });
    const res = await upload(u, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
    expect(res.status).toBe(200);
    expect(res.body.file_id).toBe('big-file-id-123456789012');
    expect(tg.sent('deleteMessage')[0]!.body).toEqual({ chat_id: u.id, message_id: 201 });
  });

  it('пустая и слишком большая картинка — 400, в Telegram не ходим', async () => {
    const u = await user();
    expect(await upload(u, new Uint8Array(0))).toEqual({ status: 400, body: { error: 'bad_image' } });
    expect(await upload(u, new Uint8Array(6_000_001))).toEqual({ status: 400, body: { error: 'bad_image' } });
    expect(tg.sent('sendPhoto')).toEqual([]);
  });

  it('бот заблокирован или человек ему не писал — 403; другой отказ Telegram — 502', async () => {
    const u = await user();
    tg.reply('sendPhoto', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    expect(await upload(u, JPEG)).toEqual({ status: 403, body: { error: 'share_upload' } });
    tg.reply('sendPhoto', { ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" });
    expect((await upload(u, JPEG)).status).toBe(403);
    tg.reply('sendPhoto', { ok: false, error_code: 400, description: 'Bad Request: PHOTO_INVALID_DIMENSIONS' });
    expect(await upload(u, JPEG)).toEqual({ status: 502, body: { error: 'share_upload' } });
    // ни описания, ни результата
    tg.reply('sendPhoto', { ok: false });
    expect((await upload(u, JPEG)).status).toBe(502);
    tg.reply('sendPhoto', { ok: true });
    expect((await upload(u, JPEG)).status).toBe(502);
    expect(tg.sent('deleteMessage')).toEqual([]);
  });

  it('без входа — 401', async () => {
    expect((await request('/api/share', { method: 'POST', body: JPEG })).status).toBe(401);
  });
});

describe.skipIf(!ready)('POST /api/share/chat', () => {
  it('подготовленное сообщение для выбора чата; подпись обрезается до 200 знаков', async () => {
    const u = await user();
    const res = await u.call('POST', '/share/chat', { file_id: 'photo-file-id-1234567890', caption: 'а'.repeat(300) });
    expect(res).toEqual({ status: 200, body: { prepared_id: 'prepared-1' } });
    const [call] = tg.sent('savePreparedInlineMessage');
    expect(call!.body).toMatchObject({
      user_id: u.id,
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
      result: { type: 'photo', photo_file_id: 'photo-file-id-1234567890', caption: 'а'.repeat(200) },
    });
    expect((call!.body.result as { id: string }).id).toMatch(/^[0-9a-f-]{32}$/);
  });

  it('Telegram не дал подготовить — картинка приходит в личку', async () => {
    const u = await user();
    tg.reply('savePreparedInlineMessage', { ok: false, error_code: 400, description: 'Bad Request: method not available' });
    const res = await u.call('POST', '/share/chat', { file_id: 'photo-file-id-1234567890' });
    expect(res).toEqual({ status: 200, body: { sent: true } });
    expect(tg.sent('sendPhoto')[0]!.body).toEqual({ chat_id: u.id, photo: 'photo-file-id-1234567890', caption: '' });
  });

  it('нет file_id или он не похож на file_id — 400', async () => {
    const u = await user();
    expect(await u.call('POST', '/share/chat', {})).toEqual({ status: 400, body: { error: 'bad_file' } });
    expect(await u.call('POST', '/share/chat', { file_id: 'short' })).toEqual({ status: 400, body: { error: 'bad_file' } });
    expect(await u.call('POST', '/share/chat', { file_id: '../../etc/passwd-0123456789' })).toEqual({ status: 400, body: { error: 'bad_file' } });
    expect(tg.calls).toEqual([]);
  });
});

describe.skipIf(!ready)('GET /share/<file_id>', () => {
  it('отдаёт картинку из Telegram, не раскрывая токен; второй раз — из кэша', async () => {
    const id = freshFileId();
    const first = await fetchRaw(`/share/${id}.jpg`);
    expect(first.status).toBe(200);
    expect([...first.bytes]).toEqual([1, 2, 3]);
    expect(first.headers.get('content-type')).toBe('image/jpeg');
    expect(first.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(first.headers.get('content-disposition')).toBe('inline; filename="lifecommit.jpg"');
    expect(tg.sent('getFile')).toEqual([{ method: 'getFile', body: { file_id: id } }]);

    const second = await fetchRaw(`/share/${id}.jpg`);
    expect(second.status).toBe(200);
    expect([...second.bytes]).toEqual([1, 2, 3]);
    expect(tg.sent('getFile')).toHaveLength(1);
  });

  it('и с .png, и без расширения', async () => {
    const id = freshFileId();
    expect((await fetchRaw(`/share/${id}.png`)).status).toBe(200);
    expect((await fetchRaw(`/share/${freshFileId()}`)).status).toBe(200);
    expect(tg.sent('getFile')[0]!.body).toEqual({ file_id: id });
  });

  it('не file_id — 404, в Telegram не ходим', async () => {
    expect((await fetchRaw('/share/short.jpg')).status).toBe(404);
    expect((await fetchRaw(`/share/${'x'.repeat(10)}%2F${'y'.repeat(20)}.jpg`)).status).toBe(404);
    expect(tg.calls).toEqual([]);
  });

  it('Telegram не знает файл, не дал путь или не отдал файл — 404', async () => {
    tg.reply('getFile', { ok: false, error_code: 400, description: 'Bad Request: invalid file_id' });
    expect((await fetchRaw(`/share/${freshFileId()}.jpg`)).status).toBe(404);
    tg.reply('getFile', { ok: true, result: {} });
    expect((await fetchRaw(`/share/${freshFileId()}.jpg`)).status).toBe(404);
    failFileDownloads();
    const id = freshFileId();
    expect((await fetchRaw(`/share/${id}.jpg`)).status).toBe(404);
    // отказ не закэширован: файл появился — отдаём
    globalThis.fetch = harnessFetch;
    expect((await fetchRaw(`/share/${id}.jpg`)).status).toBe(200);
  });
});

describe.skipIf(!ready)('Worker: адреса', () => {
  it('неизвестный адрес API — 404 в JSON; неизвестный адрес вне API — обычный 404', async () => {
    const u = await user();
    expect(await u.call('GET', '/no-such-thing')).toEqual({ status: 404, body: { error: 'not_found' } });
    expect((await request('/nowhere')).status).toBe(404);
  });
});
