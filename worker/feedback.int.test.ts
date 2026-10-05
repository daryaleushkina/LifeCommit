// Жалобы пользователей (docs/feedback.md, этап 1 — приём): база, лимиты и повторы; приём из приложения
// (POST /api/feedback, голос), /bug в боте, таймер черновиков и удаление по сроку.
// Всё, что пишет в feedback, — в этом файле: тесты внутри файла идут по очереди, и счёт «за сутки на проект» не
// гуляет от соседних файлов, которые vitest гоняет параллельно.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FEEDBACK, feedbackCleanup } from './feedback';
import { ai, botUpdate, cronTick, dbReady, env, request, sb, tg, user, type TestUser, type TgCall } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('feedback-тесты пропущены: нет локальной Supabase (pnpm db:start)');

interface Submitted {
  result: 'ok' | 'duplicate' | 'limit' | 'project_limit';
  id?: number;
}

/** Принять жалобу так, как это делает Worker: лимиты — 3 в час, 10 в сутки, на проект — сколько задано. */
async function submit(userId: number, text: string, more: { project?: number; confirmed?: boolean; attachments?: object[] } = {}): Promise<Submitted> {
  const { data, error } = await sb.rpc('submit_feedback', {
    p_user: userId,
    p_source: 'app',
    p_text: text,
    p_attachments: more.attachments ?? [],
    p_context: { route: 'today' },
    p_confirmed: more.confirmed ?? true,
    p_per_hour: 3,
    p_per_day: 10,
    p_project_day: more.project ?? 200,
  });
  if (error) throw error;
  return data as Submitted;
}

const rows = async (userId: number) =>
  ((await sb.from('feedback').select('id, source, status, text, attachments, context, confirmed, dup_count').eq('user_id', userId).order('id')).data ?? []) as {
    id: number;
    text: string;
    dup_count: number;
    confirmed: boolean;
  }[];

/** Сдвинуть время подачи всех жалоб человека в прошлое. */
const age = (userId: number, minutes: number) => sb.from('feedback').update({ created_at: new Date(Date.now() - minutes * 60_000).toISOString() }).eq('user_id', userId);

describe.skipIf(!ready)('жалобы: приём в базе', () => {
  it('жалоба ложится целиком: откуда, текст, вложения, контекст, подтверждена ли', async () => {
    const u = await user();
    const r = await submit(u.id, 'Не сохраняется дело', { confirmed: false, attachments: [{ kind: 'storage', path: 'x/1.jpg' }] });
    expect(r).toEqual({ result: 'ok', id: expect.any(Number) });
    expect(await rows(u.id)).toEqual([
      {
        id: r.id,
        source: 'app',
        status: 'new',
        text: 'Не сохраняется дело',
        attachments: [{ kind: 'storage', path: 'x/1.jpg' }],
        context: { route: 'today' },
        confirmed: false,
        dup_count: 0,
      },
    ]);
  });

  it('больше трёх в час — отказ; час прошёл — снова можно', async () => {
    const u = await user();
    for (const n of [1, 2, 3]) expect((await submit(u.id, `Жалоба ${n}`)).result).toBe('ok');
    expect(await submit(u.id, 'Жалоба 4')).toEqual({ result: 'limit' });
    await age(u.id, 61);
    expect((await submit(u.id, 'Жалоба 5')).result).toBe('ok');
    expect(await rows(u.id)).toHaveLength(4);
  });

  it('больше десяти в сутки — отказ, даже если в последний час тихо', async () => {
    const u = await user();
    const old = Array.from({ length: 10 }, (_, i) => ({ user_id: u.id, source: 'bot', text: `Старая ${i}`, created_at: new Date(Date.now() - (2 + i) * 3_600_000).toISOString() }));
    expect((await sb.from('feedback').insert(old)).error).toBeNull();
    expect(await submit(u.id, 'Одиннадцатая')).toEqual({ result: 'limit' });
  });

  it('тот же текст за сутки — не новая жалоба, а счётчик у старой (без учёта регистра и пробелов)', async () => {
    const u = await user();
    const first = await submit(u.id, 'Кнопка  не нажимается');
    expect(await submit(u.id, '  кнопка не НАЖИМАЕТСЯ ')).toEqual({ result: 'duplicate', id: first.id });
    expect(await rows(u.id)).toEqual([expect.objectContaining({ id: first.id, dup_count: 1 })]);
    // Повтор не тратит лимит: ещё две разные проходят.
    expect((await submit(u.id, 'Другое')).result).toBe('ok');
    expect((await submit(u.id, 'Третье')).result).toBe('ok');
  });

  it('повтор чужого текста или через сутки — новая жалоба; пустой текст повтором не считается', async () => {
    const a = await user();
    const b = await user();
    await submit(a.id, 'Белый экран');
    expect((await submit(b.id, 'Белый экран')).result).toBe('ok');
    await age(a.id, 25 * 60);
    expect((await submit(a.id, 'Белый экран')).result).toBe('ok');
    const c = await user();
    expect((await submit(c.id, '', { attachments: [{ kind: 'tg_photo', file_id: 'f1' }] })).result).toBe('ok');
    expect((await submit(c.id, '', { attachments: [{ kind: 'tg_photo', file_id: 'f2' }] })).result).toBe('ok');
  });

  // Локальная база общая: параллельные файлы и чужие хуки в соседних worktree добавляют и удаляют жалобы, поэтому
  // тест не опирается на сегодняшний счёт (05.10.2026 «счёт + 1» мигал). Своя жалоба a — строка, которую никто не тронет.
  it('потолок проекта за сутки — общий на всех', async () => {
    const a = await user();
    const b = await user();
    expect((await submit(a.id, 'Первая', { project: 1_000_000 })).result).toBe('ok');
    // У b своих жалоб нет, но потолок считает всех: жалоба a уже есть, при потолке 1 — отказ.
    expect(await submit(b.id, 'Вторая', { project: 1 })).toEqual({ result: 'project_limit' });
    expect((await submit(b.id, 'Вторая', { project: 1_000_000 })).result).toBe('ok');
  });

  it('одновременные отправки не проходят лимит вдвоём', async () => {
    const u = await user();
    await submit(u.id, 'Раз');
    await submit(u.id, 'Два');
    const results = await Promise.all(['Три', 'Четыре', 'Пять'].map((t) => submit(u.id, t)));
    expect(results.filter((r) => r.result === 'ok')).toHaveLength(1);
    expect(await rows(u.id)).toHaveLength(3);
  });

  it('удалили человека — его жалобы и черновик уходят вместе с ним', async () => {
    const u = await user();
    await submit(u.id, 'Жалоба');
    expect((await sb.from('feedback_drafts').insert({ user_id: u.id, chat_id: u.id, text: 'черновик' })).error).toBeNull();
    expect((await sb.from('users').delete().eq('id', u.id)).error).toBeNull();
    expect(await rows(u.id)).toEqual([]);
    expect((await sb.from('feedback_drafts').select('user_id').eq('user_id', u.id)).data).toEqual([]);
  });
});

// ── Приём из приложения ──

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const image = (magic: number[], size = 64, type = 'image/png') => new File([new Uint8Array([...magic, ...new Array(size - magic.length).fill(7)])], 'shot', { type });

/** Форма, как её шлёт шторка «Сообщить о проблеме». */
function form(fields: { text?: string; context?: string; files?: (File | string)[] }): FormData {
  const f = new FormData();
  if (fields.text !== undefined) f.set('text', fields.text);
  if (fields.context !== undefined) f.set('context', fields.context);
  for (const file of fields.files ?? []) f.append('files', file);
  return f;
}

const post = (u: TestUser, body: BodyInit, path = '/feedback', headers: Record<string, string> = {}) =>
  request(`/api${path}`, { method: 'POST', headers: { Authorization: `tma ${u.initData}`, ...headers }, body });

const OWNER = env.OWNER_ID;
afterEach(() => {
  env.OWNER_ID = OWNER;
});

/** Что ушло владелице (в любой из её чатов). */
const toOwner = (method: string, chat = env.OWNER_ID) => tg.sent(method).filter((c) => String(c.body.chat_id) === String(chat));

/** Пока идёт run, запросы, на которые указывает match, отвечают 500 — как будто база или хранилище споткнулись. */
async function failing<T>(match: (req: Request) => boolean | Promise<boolean>, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    return (await match(req)) ? Response.json({ message: 'boom', code: 'XX000', statusCode: '500', error: 'boom' }, { status: 500 }) : real(req);
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}
/** Запись жалобы в базе — и прямой вызов, и через черновик бота. */
const submitting = (req: Request) => /\/rpc\/(submit_feedback|send_feedback_draft)/.test(req.url);
const rest = (path: string, method?: string) => (req: Request) => req.url.includes(path) && (!method || req.method === method);

describe.skipIf(!ready)('POST /api/feedback', () => {
  it('текст, скриншоты и контекст: жалоба в базе, файлы в хранилище, владелице — сообщение и картинки', async () => {
    const u = await user({ name: 'Даша' });
    const res = await post(
      u,
      form({
        text: 'Не сохраняется дело\r\n\n\nНа экране «Сегодня»\u202E',
        context: JSON.stringify({ version: 'abc1234', platform: 'ios', screen: 'me', initData: 'не брать' }),
        files: [image(PNG), image(JPEG, 128, 'image/jpeg')],
      }),
    );
    expect(res).toEqual({ status: 200, body: { ok: true } });
    const [row] = (await sb.from('feedback').select('id, source, text, attachments, context, confirmed').eq('user_id', u.id)).data!;
    expect(row).toEqual({
      id: expect.any(Number),
      source: 'app',
      text: 'Не сохраняется дело\n\nНа экране «Сегодня»',
      attachments: [
        { kind: 'storage', path: expect.stringMatching(new RegExp(`^${u.id}/[0-9a-f-]{36}/1\\.png$`)) },
        { kind: 'storage', path: expect.stringMatching(new RegExp(`^${u.id}/[0-9a-f-]{36}/2\\.jpg$`)) },
      ],
      context: { version: 'abc1234', platform: 'ios', screen: 'me' },
      confirmed: true,
    });
    const folder = (row!.attachments as { path: string }[])[0]!.path.replace(/\/1\.png$/, '');
    const files = (await sb.storage.from('feedback').list(folder)).data!.map((f) => f.name);
    expect(files.sort()).toEqual(['1.png', '2.jpg']);
    const stored = await sb.storage.from('feedback').download(`${folder}/2.jpg`);
    expect(stored.data?.size).toBe(128);

    const [note] = toOwner('sendMessage');
    expect(note?.body.text).toBe(`🐞 Жалоба #${row!.id} · из приложения\nОт: Даша @u${u.id} · id ${u.id}\n\nНе сохраняется дело\n\nНа экране «Сегодня»\n\nversion abc1234 · platform ios · screen me\nСкриншотов: 2`);
    expect(toOwner('sendPhoto').map((c) => c.body)).toEqual([
      { chat_id: String(env.OWNER_ID), caption: `#${row!.id}`, photo: '[file]' },
      { chat_id: String(env.OWNER_ID), caption: `#${row!.id}`, photo: '[file]' },
    ]);
    // Человеку бот ничего не пишет: «Получили» показывает сама шторка.
    expect(tg.sent('sendMessage').filter((c) => c.body.chat_id === u.id)).toEqual([]);
  });

  it('только скриншот, без текста — тоже жалоба; без контекста — context пустой', async () => {
    const u = await user();
    expect((await post(u, form({ files: [image(PNG)] }))).status).toBe(200);
    const { data } = await sb.from('feedback').select('text, context, attachments').eq('user_id', u.id);
    expect(data).toEqual([{ text: '', context: null, attachments: [{ kind: 'storage', path: expect.stringMatching(/^\d+\/[0-9a-f-]{36}\/1\.png$/) }] }]);
  });

  it('пусто — 400 empty; не форма — 400 bad_form; битый контекст — 400 bad_context; ничего не записано', async () => {
    const u = await user();
    expect(await post(u, form({ text: ' \u200B\n ' }))).toEqual({ status: 400, body: { error: 'empty' } });
    expect(await post(u, JSON.stringify({ text: 'Жалоба' }), '/feedback', { 'content-type': 'application/json' })).toEqual({ status: 400, body: { error: 'bad_form' } });
    expect(await post(u, form({ text: 'Жалоба', context: '{не json' }))).toEqual({ status: 400, body: { error: 'bad_context' } });
    expect((await sb.from('feedback').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect(tg.calls).toEqual([]);
  });

  it('файлы: больше 4 — 400, не картинка (хоть и названа png) — 400, строка вместо файла — 400, больше 5 МБ — 413', async () => {
    const u = await user();
    const cases: [FormData, number, string][] = [
      [form({ text: 'a', files: [1, 2, 3, 4, 5].map(() => image(PNG)) }), 400, 'too_many_files'],
      [form({ text: 'a', files: [new File(['<svg onload=alert(1)>'], 'x.png', { type: 'image/png' })] }), 400, 'bad_file'],
      [form({ text: 'a', files: ['не файл'] }), 400, 'bad_file'],
      [form({ text: 'a', files: [image(PNG, 5 * 1024 * 1024 + 1)] }), 413, 'file_too_big'],
    ];
    for (const [body, status, error] of cases) expect(await post(u, body)).toEqual({ status, body: { error } });
    expect((await sb.from('feedback').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('тело больше 21 МБ — 413 too_big, форму не разбираем', async () => {
    const u = await user();
    const res = await post(u, form({ text: 'a' }), '/feedback', { 'content-length': String(22 * 1024 * 1024) });
    expect(res).toEqual({ status: 413, body: { error: 'too_big' } });
  });

  it('три в час — дальше 429 feedback_limit; повтор того же текста — не новая жалоба и лимит не тратит', async () => {
    const u = await user();
    expect((await post(u, form({ text: 'Первая' }))).status).toBe(200);
    expect(await post(u, form({ text: 'первая ' }))).toEqual({ status: 200, body: { ok: true } });
    expect((await post(u, form({ text: 'Вторая' }))).status).toBe(200);
    expect((await post(u, form({ text: 'Третья' }))).status).toBe(200);
    expect(await post(u, form({ text: 'Четвёртая' }))).toEqual({ status: 429, body: { error: 'feedback_limit' } });
    const { data } = await sb.from('feedback').select('text, dup_count').eq('user_id', u.id).order('id');
    expect(data).toEqual([
      { text: 'Первая', dup_count: 1 },
      { text: 'Вторая', dup_count: 0 },
      { text: 'Третья', dup_count: 0 },
    ]);
    // Владелице — только о новых: три сообщения, повтор без сообщения.
    expect(toOwner('sendMessage')).toHaveLength(3);
  });

  it('тот же текст, но со скриншотами — новая жалоба, а не повтор: скриншоты не теряются', async () => {
    const u = await user();
    expect((await post(u, form({ text: 'Не работает кнопка' }))).status).toBe(200);
    expect((await post(u, form({ text: 'Не работает кнопка', files: [image(PNG)] }))).status).toBe(200);
    const { data } = await sb.from('feedback').select('dup_count, attachments').eq('user_id', u.id).order('id');
    expect(data).toEqual([
      { dup_count: 0, attachments: [] },
      { dup_count: 0, attachments: [{ kind: 'storage', path: expect.any(String) }] },
    ]);
    expect(toOwner('sendPhoto')).toHaveLength(1);
  });

  // Раньше тест забивал общую базу до 200 жалоб за сегодня — и пока заполнитель лежал, параллельные прогоны
  // (другие файлы, чужие хуки) получали «потолок проекта» (05.10.2026). Теперь потолок на время теста — 1,
  // а «сегодня уже есть жалоба» обеспечивает своя жалоба другого человека.
  it('потолок проекта за сутки — 429 feedback_busy', async () => {
    const other = await user();
    expect((await post(other, form({ text: 'Чужая' }))).status).toBe(200);
    const limits = FEEDBACK as { projectDay: number };
    const cap = limits.projectDay;
    limits.projectDay = 1;
    try {
      const u = await user();
      expect(await post(u, form({ text: 'Ещё одна' }))).toEqual({ status: 429, body: { error: 'feedback_busy' } });
    } finally {
      limits.projectDay = cap;
    }
  });

  it('хранилище не приняло файл — жалобы нет, загруженное убрано, 502 upload_failed (человек повторит)', async () => {
    const u = await user();
    let uploads = 0;
    const tried: string[] = [];
    const upload = (req: Request) => {
      if (req.method !== 'POST' || !req.url.includes('/storage/v1/object/feedback/')) return false;
      tried.push(decodeURIComponent(req.url.split('/storage/v1/object/feedback/')[1]!));
      return ++uploads === 2;
    };
    expect(await failing(upload, () => post(u, form({ text: 'Со скриншотами', files: [image(PNG), image(PNG)] })))).toEqual({ status: 502, body: { error: 'upload_failed' } });
    expect((await sb.from('feedback').select('id').eq('user_id', u.id)).data).toEqual([]);
    // Первый файл, который успел лечь, убран: в папке жалобы пусто.
    expect(tried).toHaveLength(2);
    expect((await sb.storage.from('feedback').list(tried[0]!.replace(/\/1\.png$/, ''))).data).toEqual([]);
    // Тот же текст сразу снова — новая жалоба, а не «повтор» удалённой; первый файл не остался сиротой.
    expect((await post(u, form({ text: 'Со скриншотами', files: [image(PNG)] }))).status).toBe(200);
    const [row] = (await sb.from('feedback').select('id, dup_count').eq('user_id', u.id)).data!;
    expect(row!.dup_count).toBe(0);
    expect(tg.sent('sendMessage')).toHaveLength(1);
  });

  it('база не приняла жалобу — 500, владелице ничего', async () => {
    const u = await user();
    expect((await failing(rest('/rpc/submit_feedback'), () => post(u, form({ text: 'Жалоба' })))).status).toBe(500);
    expect(tg.calls).toEqual([]);
  });

  it('скриншот владелице не ушёл или чаты владелицы не прочитались — жалоба принята, сбой в логе', async () => {
    const u = await user();
    tg.reply('sendPhoto', { ok: false, error_code: 400, description: 'Bad Request: IMAGE_PROCESS_FAILED' });
    expect((await post(u, form({ text: 'Первая', files: [image(PNG), image(PNG)] }))).status).toBe(200);
    // Первый скриншот не ушёл — второй в этот чат уже не шлём, но сообщение было.
    expect(toOwner('sendMessage')).toHaveLength(1);
    expect(toOwner('sendPhoto')).toHaveLength(1);
    tg.calls = [];
    const owner = String(env.OWNER_ID);
    expect((await failing((req) => req.url.includes('select=telegram_aliases') && req.url.includes(`id=eq.${owner}`), () => post(u, form({ text: 'Вторая' })))).status).toBe(200);
    expect(tg.calls).toEqual([]);
    expect((await sb.from('feedback').select('text').eq('user_id', u.id).order('id')).data).toEqual([{ text: 'Первая' }, { text: 'Вторая' }]);
  });

  it('владелица с двумя аккаунтами — сообщение в оба; Telegram отказал — жалоба всё равно принята', async () => {
    const owner = await user();
    const alias = 9_200_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', owner.id);
    env.OWNER_ID = String(owner.id);
    const u = await user();
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    expect((await post(u, form({ text: 'Жалоба' }))).status).toBe(200);
    expect(tg.sent('sendMessage').map((c) => c.body.chat_id)).toEqual([owner.id, alias]);
    expect((await sb.from('feedback').select('id').eq('user_id', u.id)).data).toHaveLength(1);
  });

  it('владелица не задана — жалоба принята, сообщений нет', async () => {
    env.OWNER_ID = undefined;
    const u = await user();
    expect((await post(u, form({ text: 'Жалоба' }))).status).toBe(200);
    expect(tg.calls).toEqual([]);
  });

  it('без входа — 401, жалоба не принимается', async () => {
    const res = await request('/api/feedback', { method: 'POST', body: form({ text: 'Жалоба' }) });
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!ready)('POST /api/feedback/voice', () => {
  beforeEach(() => {
    ai.transcript = 'кнопка не нажимается';
  });

  it('голос → текст для поля (без разбора в дела), лимит голоса общий', async () => {
    const u = await user();
    const res = await post(u, new Blob([new Uint8Array(2000)], { type: 'audio/webm' }), '/feedback/voice');
    expect(res).toEqual({ status: 200, body: { text: 'кнопка не нажимается' } });
    expect(ai.calls.every((c) => c.model.includes('whisper'))).toBe(true);
    expect((await sb.from('voice_usage').select('count').eq('user_id', u.id)).data).toEqual([{ count: 1 }]);
    expect((await sb.from('feedback').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('пусто — 400 no_audio; длиннее 3 МБ — 413; лимит голоса кончился — 429 voice_limit', async () => {
    const u = await user();
    expect(await post(u, new Blob([]), '/feedback/voice')).toEqual({ status: 400, body: { error: 'no_audio' } });
    expect(await post(u, new Blob([new Uint8Array(3_000_001)]), '/feedback/voice')).toEqual({ status: 413, body: { error: 'too_long' } });
    await sb.from('voice_usage').insert({ user_id: u.id, day: new Date().toISOString().slice(0, 10), count: 20 });
    expect(await post(u, new Blob([new Uint8Array(2000)]), '/feedback/voice')).toEqual({ status: 429, body: { error: 'voice_limit' } });
  });

  it('по-английски — распознаём как английский', async () => {
    const u = await user({ lang: 'en' });
    const run = env.AI.run;
    const inputs: unknown[] = [];
    env.AI.run = (async (_model: string, input: unknown) => {
      inputs.push(input);
      return { text: 'button is broken' };
    }) as unknown as Ai['run'];
    try {
      expect(await post(u, new Blob([new Uint8Array(2000)]), '/feedback/voice')).toEqual({ status: 200, body: { text: 'button is broken' } });
    } finally {
      env.AI.run = run;
    }
    expect(inputs[0]).toMatchObject({ language: 'en' });
  });

  it('распознавание упало — 502 failed', async () => {
    const u = await user();
    const run = env.AI.run;
    env.AI.run = (async () => {
      throw new Error('Failed to decode audio file');
    }) as unknown as Ai['run'];
    try {
      expect(await post(u, new Blob([new Uint8Array(2000)]), '/feedback/voice')).toEqual({ status: 502, body: { error: 'failed' } });
    } finally {
      env.AI.run = run;
    }
  });
});

describe.skipIf(!ready)('удаление аккаунта', () => {
  it('скриншоты жалоб уходят из хранилища вместе с человеком', async () => {
    const u = await user();
    expect((await post(u, form({ text: 'Жалоба', files: [image(PNG), image(PNG)] }))).status).toBe(200);
    const [row] = (await sb.from('feedback').select('id, attachments').eq('user_id', u.id)).data!;
    const folder = (row!.attachments as { path: string }[])[0]!.path.replace(/\/1\.png$/, '');
    expect((await sb.storage.from('feedback').list(folder)).data).toHaveLength(2);
    expect((await u.call('DELETE', '/account')).status).toBe(200);
    expect((await sb.storage.from('feedback').list(folder)).data).toEqual([]);
    expect((await sb.from('feedback').select('id').eq('id', row!.id)).data).toEqual([]);
  });

  it('удаление аккаунта не трогает чужие скриншоты', async () => {
    const a = await user();
    const b = await user();
    expect((await post(a, form({ text: 'Моя', files: [image(PNG)] }))).status).toBe(200);
    expect((await post(b, form({ text: 'Чужая', files: [image(PNG)] }))).status).toBe(200);
    const [theirs] = (await sb.from('feedback').select('id, attachments').eq('user_id', b.id)).data!;
    const path = (theirs!.attachments as { path: string }[])[0]!.path;
    expect((await a.call('DELETE', '/account')).status).toBe(200);
    expect((await sb.storage.from('feedback').download(path)).error).toBeNull();
    expect((await sb.from('feedback').select('id').eq('id', theirs!.id)).data).toHaveLength(1);
  });

  it('жалобы без скриншотов (или их нет вовсе) — аккаунт удаляется, хранилище не трогаем', async () => {
    const a = await user();
    expect((await post(a, form({ text: 'Без картинок' }))).status).toBe(200);
    expect((await a.call('DELETE', '/account')).status).toBe(200);
    const b = await user();
    expect((await b.call('DELETE', '/account')).status).toBe(200);
  });

  it('хранилище не ответило — аккаунт не удаляется (500), чтобы файлы не остались сиротами; свои группы при этом не отданы', async () => {
    const u = await user();
    const other = await user();
    const { id: group } = (await u.call<{ id: number }>('POST', '/groups', { title: 'Семья', kind: 'family' })).body;
    const { code } = (await u.call<{ code: string }>('POST', `/groups/${group}/invite`)).body;
    expect((await other.call('POST', `/invites/${code}/join`)).status).toBe(200);
    expect((await post(u, form({ text: 'Жалоба', files: [image(PNG)] }))).status).toBe(200);
    expect((await failing(rest('/storage/v1/object/feedback', 'DELETE'), () => u.call('DELETE', '/account'))).status).toBe(500);
    expect((await sb.from('users').select('id').eq('id', u.id)).data).toHaveLength(1);
    expect((await sb.from('groups').select('owner_id').eq('id', group).single()).data).toEqual({ owner_id: u.id });
  });
});

// ── /bug в боте ──

let seq = 0;
const person = (id: number, more: object = {}) => ({ id, first_name: 'Даша', language_code: 'ru', ...more });
const message = (u: { id: number }, body: object, chat = u.id) => botUpdate({ update_id: ++seq, message: { message_id: 1000 + seq, chat: { id: chat, type: 'private' }, from: person(u.id), ...body } });
const say = (u: { id: number }, text: string) => message(u, { text });
const photo = (u: { id: number }, file: string, caption?: string) =>
  message(u, { photo: [{ file_id: `${file}-small`, width: 90, height: 160 }, { file_id: file, width: 1170, height: 2532 }], ...(caption && { caption }) });
const press = (u: { id: number }, data: string, messageId = 777) => botUpdate({ update_id: ++seq, callback_query: { id: `cb-${seq}`, from: person(u.id), data, message: { message_id: messageId, chat: { id: u.id } } } });
const replies = (chat: number) => tg.sent('sendMessage').filter((c) => c.body.chat_id === chat);
const draft = async (userId: number) =>
  (await sb.from('feedback_drafts').select('chat_id, text, attachments, prompt_message_id').eq('user_id', userId).maybeSingle()).data as {
    chat_id: number;
    text: string;
    attachments: object[];
    prompt_message_id: number | null;
  } | null;
type Button = { text: string; callback_data?: string };
const keyboard = (c: TgCall | undefined) => (c?.body.reply_markup as { inline_keyboard: Button[][] } | undefined)?.inline_keyboard;

describe.skipIf(!ready)('/bug в боте', () => {
  it('/bug — приглашение с «Отправить» и «Отмена», черновик открыт', async () => {
    const u = await user();
    await say(u, '/bug');
    const [prompt] = replies(u.id);
    expect(prompt?.body.text).toBe('Что случилось? Напиши, скажи голосом или пришли скриншоты — можно несколькими сообщениями. Когда всё, нажми «Отправить».');
    expect(keyboard(prompt)).toEqual([[{ text: 'Отправить', callback_data: 'fb:send' }, { text: 'Отмена', callback_data: 'fb:cancel' }]]);
    expect(await draft(u.id)).toEqual({ chat_id: u.id, text: '', attachments: [], prompt_message_id: expect.any(Number) });
  });

  it('пока черновик открыт: текст, скриншоты с подписью и голос копятся в нём, а не разбираются в дела', async () => {
    const u = await user();
    ai.transcript = 'и календарь пустой';
    // Отметка 👌 не поставилась — не важно: сообщение в черновике.
    tg.reply('setMessageReaction', { ok: false, error_code: 400, description: 'Bad Request: REACTION_INVALID' });
    await say(u, '/bug не открывается календарь');
    await say(u, 'после обновления');
    await photo(u, 'shot-1', 'вот так');
    await message(u, { voice: { file_id: 'voice-1', duration: 30 } });
    expect(await draft(u.id)).toEqual(
      expect.objectContaining({
        text: 'не открывается календарь\nпосле обновления\nвот так\nи календарь пустой',
        attachments: [{ kind: 'tg_photo', file_id: 'shot-1' }],
      }),
    );
    // На каждое — тихая отметка 👌, на голос — что расслышал.
    expect(tg.sent('setMessageReaction')).toHaveLength(3);
    expect(replies(u.id).map((c) => c.body.text)).toEqual([expect.stringMatching(/^Что случилось\?/), 'Расслышал: «и календарь пустой»']);
    expect((await sb.from('todos').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('«Отправить» — жалоба в базе (подтверждена), черновика нет, кнопки сменились на «Получили», владелице — текст и скриншоты', async () => {
    const u = await user({ name: 'Даша' });
    await say(u, '/bug');
    await say(u, 'Белый экран');
    await photo(u, 'shot-1');
    await press(u, 'fb:send', 555);
    const [row] = (await sb.from('feedback').select('id, source, text, attachments, confirmed').eq('user_id', u.id)).data!;
    expect(row).toEqual({ id: expect.any(Number), source: 'bot', text: 'Белый экран', attachments: [{ kind: 'tg_photo', file_id: 'shot-1' }], confirmed: true });
    expect(await draft(u.id)).toBeNull();
    expect(tg.sent('editMessageText').map((c) => c.body)).toEqual([{ chat_id: u.id, message_id: 555, text: 'Получили, спасибо!' }]);
    expect(tg.sent('answerCallbackQuery')).toHaveLength(1);
    expect(toOwner('sendMessage')[0]?.body.text).toBe(`🐞 Жалоба #${row!.id} · из бота\nОт: Даша @u${u.id} · id ${u.id}\n\nБелый экран\nСкриншотов: 1`);
    expect(toOwner('sendPhoto').map((c) => c.body)).toEqual([{ chat_id: Number(env.OWNER_ID), photo: 'shot-1', caption: `#${row!.id}` }]);
  });

  it('база не приняла жалобу при «Отправить» — черновик на месте, человеку «не получилось, нажми ещё раз»; второй раз уходит', async () => {
    const u = await user();
    await say(u, '/bug');
    await say(u, 'Важная жалоба');
    await failing(submitting, () => press(u, 'fb:send', 561));
    expect(await draft(u.id)).toEqual(expect.objectContaining({ text: 'Важная жалоба' }));
    expect(tg.sent('answerCallbackQuery').map((c) => c.body.text)).toEqual(['Не получилось отправить — нажми ещё раз']);
    expect(tg.sent('editMessageText')).toEqual([]);
    await press(u, 'fb:send', 561);
    expect((await sb.from('feedback').select('text').eq('user_id', u.id)).data).toEqual([{ text: 'Важная жалоба' }]);
    expect(tg.sent('editMessageText').map((c) => c.body.text)).toEqual(['Получили, спасибо!']);
  });

  it('только скриншот, без текста — «Отправить» отправляет', async () => {
    const u = await user();
    await say(u, '/bug');
    await photo(u, 'only-shot');
    await press(u, 'fb:send', 562);
    expect((await sb.from('feedback').select('text, attachments').eq('user_id', u.id)).data).toEqual([{ text: '', attachments: [{ kind: 'tg_photo', file_id: 'only-shot' }] }]);
  });

  it('альбом: 6 скриншотов разом — в черновике ровно 4 разных, про лишние сказано дважды', async () => {
    const u = await user();
    await say(u, '/bug');
    await Promise.all([1, 2, 3, 4, 5, 6].map((n) => photo(u, `alb-${n}`)));
    const files = (await draft(u.id))!.attachments as { file_id: string }[];
    expect(new Set(files.map((f) => f.file_id)).size).toBe(4);
    expect(replies(u.id).filter((c) => String(c.body.text).startsWith('Больше 4 скриншотов'))).toHaveLength(2);
  });

  it('Telegram не дал сменить кнопки на «Получили» — владелице жалоба всё равно приходит', async () => {
    const u = await user();
    await say(u, '/bug');
    await say(u, 'Кнопки не сменились');
    tg.reply('editMessageText', { ok: false, error_code: 400, description: 'Bad Request: message to edit not found' });
    await press(u, 'fb:send', 563);
    expect(toOwner('sendMessage')[0]?.body.text).toContain('Кнопки не сменились');
  });

  it('«Отправить» без единого сообщения — подсказка, черновик остаётся', async () => {
    const u = await user();
    await say(u, '/bug');
    await press(u, 'fb:send');
    expect(tg.sent('answerCallbackQuery').map((c) => c.body.text)).toEqual(['Сначала напиши, что случилось']);
    expect(await draft(u.id)).not.toBeNull();
    expect((await sb.from('feedback').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('«Отмена» — черновик удалён, ничего не отправлено; дальше сообщения — снова дела', async () => {
    const u = await user();
    await say(u, '/bug');
    await say(u, 'передумала');
    await press(u, 'fb:cancel', 556);
    expect(await draft(u.id)).toBeNull();
    expect(tg.sent('editMessageText').map((c) => c.body)).toEqual([{ chat_id: u.id, message_id: 556, text: 'Отменено — ничего не отправили.' }]);
    expect((await sb.from('feedback').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect(toOwner('sendMessage')).toEqual([]);
  });

  it('кнопка под старым приглашением, когда черновика уже нет, — «уже нет», кнопки убраны', async () => {
    const u = await user();
    // Служебные ответы Telegram не прошли — не важно.
    tg.reply('answerCallbackQuery', { ok: false, error_code: 400, description: 'Bad Request: query is too old' });
    tg.reply('editMessageReplyMarkup', { ok: false, error_code: 400, description: 'Bad Request: message to edit not found' });
    await press(u, 'fb:send', 557);
    await press(u, 'fb:cancel', 558);
    expect(tg.sent('answerCallbackQuery').map((c) => c.body.text)).toEqual(['Этой жалобы уже нет — отправлена или отменена.', 'Этой жалобы уже нет — отправлена или отменена.']);
    expect(tg.sent('editMessageReplyMarkup').map((c) => c.body.message_id)).toEqual([557, 558]);
  });

  it('кнопка без сообщения (Telegram его не прислал) — черновик закрывается, править нечего', async () => {
    const u = await user();
    await say(u, '/bug');
    await say(u, 'Текст');
    const bare = (data: string) => botUpdate({ update_id: ++seq, callback_query: { id: `cb-${seq}`, from: person(u.id), data } });
    await bare('fb:cancel');
    expect(await draft(u.id)).toBeNull();
    await bare('fb:send');
    expect(tg.sent('answerCallbackQuery').map((c) => c.body.text)).toEqual([undefined, 'Этой жалобы уже нет — отправлена или отменена.']);
    expect(tg.sent('editMessageText')).toEqual([]);
    expect(tg.sent('editMessageReplyMarkup')).toEqual([]);
  });

  it('чужой человек жмёт кнопку — «уже нет» на языке его Telegram', async () => {
    const stranger = { id: 9_500_000_000_000 + Math.floor(Math.random() * 1_000_000_000) };
    await botUpdate({ update_id: ++seq, callback_query: { id: `cb-${seq}`, from: { id: stranger.id, first_name: 'X', language_code: 'en' }, data: 'fb:send', message: { message_id: 9, chat: { id: stranger.id } } } });
    expect(tg.sent('answerCallbackQuery').map((c) => c.body.text)).toEqual(['This report is no longer open — it was sent or cancelled.']);
  });

  it('/bug ещё раз — собранное остаётся, кнопки у старого приглашения убраны, новое — внизу', async () => {
    const u = await user();
    await say(u, '/bug');
    const first = (await draft(u.id))!.prompt_message_id;
    await say(u, 'Кнопка не жмётся');
    await say(u, '/bug@LifeCommit_bot');
    expect(tg.sent('editMessageReplyMarkup').map((c) => c.body)).toEqual([{ chat_id: u.id, message_id: first, reply_markup: { inline_keyboard: [] } }]);
    const now = (await draft(u.id))!;
    expect(now.text).toBe('Кнопка не жмётся');
    expect(now.prompt_message_id).not.toBe(first);
  });

  it('тот же скриншот дважды — в черновике один раз; уже приложенный пятым — 👌, а не «не приложил»', async () => {
    const u = await user();
    await say(u, '/bug');
    await photo(u, 'same');
    await photo(u, 'same');
    expect((await draft(u.id))!.attachments).toEqual([{ kind: 'tg_photo', file_id: 'same' }]);
    for (const n of [2, 3, 4]) await photo(u, `shot-${n}`);
    await photo(u, 'same');
    expect((await draft(u.id))!.attachments).toHaveLength(4);
    expect(replies(u.id).slice(1)).toEqual([]);
    expect(tg.sent('setMessageReaction')).toHaveLength(6);
  });

  it('тот же текст, но со скриншотом — новая жалоба, а не повтор', async () => {
    const u = await user();
    expect((await sb.from('feedback').insert({ user_id: u.id, source: 'bot', text: 'Белый экран' })).error).toBeNull();
    await say(u, '/bug');
    await say(u, 'Белый экран');
    await photo(u, 'white');
    await press(u, 'fb:send', 564);
    expect((await sb.from('feedback').select('dup_count').eq('user_id', u.id).order('id')).data).toEqual([{ dup_count: 0 }, { dup_count: 0 }]);
  });

  it('черновик ушёл, пока шло сообщение, — не ставим 👌, а говорим, что жалоба уже ушла', async () => {
    const u = await user();
    await say(u, '/bug');
    await say(u, 'Первое');
    // Таймер или кнопка забрали черновик как раз между «есть ли черновик» и «дописать».
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.includes('/rpc/append_feedback_draft')) await sb.from('feedback_drafts').delete().eq('user_id', u.id);
      return real(req);
    }) as typeof fetch;
    try {
      await say(u, 'Опоздавшее');
    } finally {
      globalThis.fetch = real;
    }
    expect(tg.sent('setMessageReaction')).toHaveLength(1);
    expect(replies(u.id).at(-1)?.body.text).toBe('Жалоба уже ушла. Чтобы добавить ещё, пришли /bug.');
  });

  it('без аккаунта и с Telegram не по-русски — ответ по-английски, как во всём боте', async () => {
    const stranger = { id: 9_600_000_000_000 + Math.floor(Math.random() * 1_000_000_000) };
    await botUpdate({ update_id: ++seq, message: { message_id: 1, chat: { id: stranger.id, type: 'private' }, from: { id: stranger.id, first_name: 'Hans', language_code: 'de' }, text: '/bug' } });
    expect(replies(stranger.id).map((c) => c.body.text)).toEqual(['Open LifeCommit first — then you can report a problem.']);
  });

  it('пятый скриншот не берём и говорим об этом; стикер — подсказка, что можно прислать', async () => {
    const u = await user();
    await say(u, '/bug');
    for (const n of [1, 2, 3, 4, 5]) await photo(u, `shot-${n}`);
    await message(u, { sticker: { file_id: 'sticker-1' } });
    expect((await draft(u.id))!.attachments).toHaveLength(4);
    expect(replies(u.id).slice(1).map((c) => c.body.text)).toEqual(['Больше 4 скриншотов не возьму — этот не приложил.', 'Возьму текст, голосовое или скриншот (картинкой).']);
  });

  it('голос: длиннее двух минут — просим короче; лимит голоса кончился — просим текстом; распознать не вышло — тоже', async () => {
    const u = await user();
    await say(u, '/bug');
    await message(u, { voice: { file_id: 'v-long', duration: 121 } });
    await sb.from('voice_usage').insert({ user_id: u.id, day: new Date().toISOString().slice(0, 10), count: 20 });
    await message(u, { voice: { file_id: 'v-2', duration: 10 } });
    await sb.from('voice_usage').delete().eq('user_id', u.id);
    const run = env.AI.run;
    env.AI.run = (async () => {
      throw new Error('Failed to decode audio file');
    }) as unknown as Ai['run'];
    try {
      await message(u, { voice: { file_id: 'v-3', duration: 10 } });
    } finally {
      env.AI.run = run;
    }
    expect(replies(u.id).slice(1).map((c) => c.body.text)).toEqual([
      'Слишком длинное голосовое — до двух минут.',
      'Голосовых на сегодня хватит — напиши, пожалуйста, текстом.',
      'Не получилось разобрать голосовое — напиши, пожалуйста, текстом.',
    ]);
    expect((await draft(u.id))!.text).toBe('');
  });

  it('лимит жалоб — «Уже много за сегодня», черновик закрыт, владелице ничего', async () => {
    const u = await user();
    const rows = [1, 2, 3].map((n) => ({ user_id: u.id, source: 'bot', text: `Старая ${n}` }));
    expect((await sb.from('feedback').insert(rows)).error).toBeNull();
    await say(u, '/bug');
    await say(u, 'Четвёртая');
    await press(u, 'fb:send', 559);
    expect(tg.sent('editMessageText').map((c) => c.body.text)).toEqual(['Уже много за сегодня — завтра примем ещё.']);
    expect(await draft(u.id)).toBeNull();
    expect(toOwner('sendMessage')).toEqual([]);
  });

  it('дописать в черновик не вышло (база споткнулась) — человеку «пришли ещё раз», а не тишина', async () => {
    const u = await user();
    await say(u, '/bug');
    await failing(rest('/rpc/append_feedback_draft'), () => say(u, 'Потерялось бы'));
    expect(replies(u.id).at(-1)?.body.text).toBe('Не получилось записать — пришли это ещё раз.');
    expect(tg.sent('setMessageReaction')).toEqual([]);
  });

  it('/bug текст: приглашение не ушло — текст всё равно в черновике', async () => {
    const u = await user();
    tg.reply('sendMessage', { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1' });
    await say(u, '/bug не грузится лента');
    expect((await draft(u.id))!.text).toBe('не грузится лента');
  });

  it('текст черновика — не длиннее 2000 символов, начало сохраняется', async () => {
    const u = await user();
    await say(u, '/bug');
    await say(u, `начало ${'а'.repeat(1500)}`);
    await say(u, 'б'.repeat(1500));
    const text = (await draft(u.id))!.text;
    expect(text).toHaveLength(2000);
    expect(text.startsWith('начало ')).toBe(true);
  });

  it('команда при открытом черновике — как обычно (/start здоровается), в черновик не попадает', async () => {
    const u = await user();
    await say(u, '/bug');
    await say(u, '/start');
    expect((await draft(u.id))!.text).toBe('');
    expect(replies(u.id).at(-1)?.body.text).toMatch(/^Привет/);
  });

  it('без аккаунта — сначала открыть LifeCommit', async () => {
    const stranger = { id: 9_300_000_000_000 + Math.floor(Math.random() * 1_000_000_000) };
    await say(stranger, '/bug');
    expect(replies(stranger.id).map((c) => c.body.text)).toEqual(['Сначала открой LifeCommit — потом можно сообщить о проблеме.']);
    expect((await sb.from('feedback_drafts').select('user_id').eq('chat_id', stranger.id)).data).toEqual([]);
  });

  it('со связанного аккаунта — черновик на основного, ответы — в чат, откуда пишут', async () => {
    const main = await user();
    const alias = { id: 9_400_000_000_000 + Math.floor(Math.random() * 1_000_000_000) };
    await sb.from('users').update({ telegram_aliases: [alias.id] }).eq('id', main.id);
    await say(alias, '/bug');
    await say(alias, 'С другого аккаунта');
    expect(await draft(main.id)).toEqual(expect.objectContaining({ chat_id: alias.id, text: 'С другого аккаунта' }));
    await press(alias, 'fb:send');
    expect((await sb.from('feedback').select('text').eq('user_id', main.id)).data).toEqual([{ text: 'С другого аккаунта' }]);
  });

  it('по-английски — тексты на английском', async () => {
    const u = await user({ lang: 'en' });
    await sb.from('users').update({ language_code: 'en' }).eq('id', u.id);
    await say(u, '/bug');
    await say(u, 'Broken');
    ai.transcript = 'the calendar is empty';
    await message(u, { voice: { file_id: 'v-en', duration: 5 } });
    for (const n of [1, 2, 3, 4, 5]) await photo(u, `en-${n}`);
    await press(u, 'fb:send', 560);
    expect(replies(u.id).map((c) => c.body.text)).toEqual([
      expect.stringMatching(/^What happened\?/),
      'I heard: "the calendar is empty"',
      'I take up to 4 screenshots — this one is not attached.',
    ]);
    expect(tg.sent('editMessageText')[0]?.body.text).toBe('Got it, thank you!');
  });
});

// ── Таймер черновиков и удаление по сроку ──

/** Сдвинуть «последнее сообщение» черновика в прошлое. */
const staleDraft = (userId: number, minutes: number) => sb.from('feedback_drafts').update({ updated_at: new Date(Date.now() - minutes * 60_000).toISOString() }).eq('user_id', userId);

describe.skipIf(!ready)('таймер черновиков (cron раз в 5 минут)', () => {
  it('10 минут тишины — жалоба уходит сама, не подтверждённой; человеку «Получили», кнопки убраны', async () => {
    const u = await user();
    await say(u, '/bug');
    await say(u, 'Не грузится');
    const prompt = (await draft(u.id))!.prompt_message_id;
    await staleDraft(u.id, 11);
    tg.calls = [];
    await cronTick('*/5 * * * *');
    expect((await sb.from('feedback').select('text, confirmed').eq('user_id', u.id)).data).toEqual([{ text: 'Не грузится', confirmed: false }]);
    expect(await draft(u.id)).toBeNull();
    expect(replies(u.id).map((c) => c.body.text)).toEqual(['Получили, спасибо!']);
    expect(tg.sent('editMessageReplyMarkup').map((c) => c.body)).toEqual([{ chat_id: u.id, message_id: prompt, reply_markup: { inline_keyboard: [] } }]);
    expect(toOwner('sendMessage')[0]?.body.text).toContain('Не подтверждена: ушла сама через 10 минут');
  });

  it('пустой черновик — закрывается молча; свежий — не трогаем; лимит — «Уже много»', async () => {
    const empty = await user();
    const fresh = await user();
    const limited = await user();
    await say(empty, '/bug');
    await say(fresh, '/bug');
    await say(fresh, 'Пишу');
    await say(limited, '/bug');
    await say(limited, 'Четвёртая');
    expect((await sb.from('feedback').insert([1, 2, 3].map((n) => ({ user_id: limited.id, source: 'bot', text: `Старая ${n}` })))).error).toBeNull();
    await staleDraft(empty.id, 11);
    await staleDraft(limited.id, 11);
    await staleDraft(fresh.id, 5);
    tg.calls = [];
    await cronTick('*/5 * * * *');
    expect(await draft(empty.id)).toBeNull();
    expect(replies(empty.id)).toEqual([]);
    expect(await draft(fresh.id)).not.toBeNull();
    expect(await draft(limited.id)).toBeNull();
    expect(replies(limited.id).map((c) => c.body.text)).toEqual(['Уже много за сегодня — завтра примем ещё.']);
  });

  it('приглашения нет, «Получили» не дошло (бот заблокирован) — владелице жалоба всё равно приходит', async () => {
    const u = await user();
    expect((await sb.from('feedback_drafts').insert({ user_id: u.id, chat_id: u.id, text: 'Без приглашения', updated_at: new Date(Date.now() - 11 * 60_000).toISOString() })).error).toBeNull();
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    await cronTick('*/5 * * * *');
    expect((await sb.from('feedback').select('text, confirmed').eq('user_id', u.id)).data).toEqual([{ text: 'Без приглашения', confirmed: false }]);
    expect(toOwner('sendMessage')[0]?.body.text).toContain('Без приглашения');
  });

  it('один черновик споткнулся о базу — остальные уходят, а он остаётся до следующего тика; база не ответила вовсе — тик не падает', async () => {
    const a = await user();
    const b = await user();
    const stale = new Date(Date.now() - 11 * 60_000).toISOString();
    expect((await sb.from('feedback_drafts').insert([a, b].map((x) => ({ user_id: x.id, chat_id: x.id, text: `От ${x.id}`, updated_at: stale })))).error).toBeNull();
    await failing(async (req) => submitting(req) && (await req.clone().text()).includes(String(a.id)), () => cronTick('*/5 * * * *'));
    expect((await sb.from('feedback').select('text').eq('user_id', b.id)).data).toEqual([{ text: `От ${b.id}` }]);
    expect((await sb.from('feedback').select('text').eq('user_id', a.id)).data).toEqual([]);
    // Жалоба не пропала: черновик на месте, следующий тик её отправит.
    expect(await draft(a.id)).toEqual(expect.objectContaining({ text: `От ${a.id}` }));
    await cronTick('*/5 * * * *');
    expect((await sb.from('feedback').select('text').eq('user_id', a.id)).data).toEqual([{ text: `От ${a.id}` }]);
    await failing(rest('/rest/v1/feedback_drafts'), () => cronTick('*/5 * * * *'));
  });

  it('база не приняла жалобу по таймеру — черновик остаётся, человеку ничего не пишем', async () => {
    const u = await user();
    expect((await sb.from('feedback_drafts').insert({ user_id: u.id, chat_id: u.id, text: 'Не потерять', updated_at: new Date(Date.now() - 11 * 60_000).toISOString() })).error).toBeNull();
    await failing(submitting, () => cronTick('*/5 * * * *'));
    expect(await draft(u.id)).toEqual(expect.objectContaining({ text: 'Не потерять' }));
    expect(replies(u.id)).toEqual([]);
  });

  // 15-минутный тик здесь не зовём: он забирает календари всех пользователей базы, в том числе чужих тестов,
  // которые vitest гоняет параллельно, и ломал бы их. Что 5-минутный не шлёт напоминаний — проверяем.
  it('5-минутный тик — только черновики: напоминаний не шлёт', async () => {
    const u = await user();
    await say(u, '/bug');
    await say(u, 'Ждёт');
    await staleDraft(u.id, 11);
    await sb.from('users').update({ bot_chat_ok: true, remind_evening: new Date().toISOString().slice(11, 16), timezone: 'UTC' }).eq('id', u.id);
    await sb.from('tasks').insert({ user_id: u.id, title: 'Читать', kind: 'check', schedule: 'daily' });
    tg.calls = [];
    await cronTick('*/5 * * * *');
    expect(replies(u.id).map((c) => c.body.text)).toEqual(['Получили, спасибо!']);
  });
});

describe.skipIf(!ready)('удаление по сроку (feedbackCleanup — его зовёт cron раз в 15 минут)', () => {
  it('закрытые 14 дней назад и поданные 60 дней назад — прочь вместе со скриншотами; остальные остаются', async () => {
    const u = await user();
    const ids: Record<string, number> = {};
    for (const text of ['Закрыта давно', 'Подана давно', 'Закрыта недавно', 'Новая']) {
      const { data, error } = await sb.from('feedback').insert({ user_id: u.id, source: 'app', text }).select('id').single();
      expect(error).toBeNull();
      ids[text] = data!.id as number;
      const path = `${data!.id}/1.png`;
      expect((await sb.storage.from('feedback').upload(path, new Uint8Array(PNG), { contentType: 'image/png' })).error).toBeNull();
      expect((await sb.from('feedback').update({ attachments: [{ kind: 'storage', path }] }).eq('id', data!.id)).error).toBeNull();
    }
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    await sb.from('feedback').update({ closed_at: ago(15), status: 'deployed' }).eq('id', ids['Закрыта давно']);
    await sb.from('feedback').update({ created_at: ago(61) }).eq('id', ids['Подана давно']);
    await sb.from('feedback').update({ closed_at: ago(13), status: 'wontfix' }).eq('id', ids['Закрыта недавно']);
    const bot = (await sb.from('feedback').insert({ user_id: u.id, source: 'bot', text: 'Из бота', created_at: ago(61), attachments: [{ kind: 'tg_photo', file_id: 'f' }] }).select('id').single()).data!;
    await feedbackCleanup(env);
    expect((await sb.from('feedback').select('id').eq('id', bot.id)).data).toEqual([]);
    // Старых больше нет — второй проход ничего не делает.
    await feedbackCleanup(env);
    const left = ((await sb.from('feedback').select('text').eq('user_id', u.id).order('id')).data ?? []).map((r) => r.text);
    expect(left).toEqual(['Закрыта недавно', 'Новая']);
    expect((await sb.storage.from('feedback').list(String(ids['Закрыта давно']))).data).toEqual([]);
    expect((await sb.storage.from('feedback').list(String(ids['Подана давно']))).data).toEqual([]);
    expect((await sb.storage.from('feedback').list(String(ids['Новая']))).data).toHaveLength(1);
  });
});
