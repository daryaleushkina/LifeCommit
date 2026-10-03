// Бот в чате группы целиком: привязка чата, служебные сообщения, дела ответом боту (текст и голос),
// кнопки-отметки и «Отменить», «Сегодня в группе», проверка чата, утренний список и вечерний итог.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from './day';
import { groupChatsTick } from './groupBot';
import { ai, botUpdate, dbReady, env, net, sb, tg, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('тесты бота в группах пропущены: нет локальной Supabase (pnpm db:start)');

const BOT = { id: 7000000001, first_name: 'LifeCommit', is_bot: true, username: 'LifeCommit_bot' };
const newChat = () => -1_009_000_000_000 - Math.floor(Math.random() * 1e9);
/** Человек из чата, у которого нет LifeCommit. */
const stranger = () => 8_000_000_000_000 + Math.floor(Math.random() * 1e9);
const person = (id: number, lang = 'ru') => ({ id, first_name: 'Тест', language_code: lang });
let seq = 1;

/** Сообщение в групповом чате. */
const say = (chatId: number, fromId: number, text: string, extra: object = {}, lang = 'ru') =>
  botUpdate({ update_id: seq++, message: { message_id: seq++, chat: { id: chatId, type: 'supergroup', title: 'Семейный чат' }, from: person(fromId, lang), text, ...extra } });
/** Ответ на сообщение бота (текстом, голосом или чем-то ещё). */
const replyToBot = (chatId: number, fromId: number, extra: object) =>
  botUpdate({ update_id: seq++, message: { message_id: 4242, chat: { id: chatId, type: 'supergroup', title: 'Семейный чат' }, from: person(fromId), reply_to_message: { from: BOT }, ...extra } });
/** Служебное сообщение чата (без автора-человека). */
const service = (chatId: number, extra: object) => botUpdate({ update_id: seq++, message: { message_id: seq++, chat: { id: chatId, type: 'supergroup' }, ...extra } });
/** Нажали кнопку под сообщением бота; chatId = null — у кнопки нет сообщения. */
const press = (chatId: number | null, fromId: number, data: string) =>
  botUpdate({ update_id: seq++, callback_query: { id: `cb${seq++}`, from: person(fromId), data, ...(chatId !== null && { message: { message_id: 777, chat: { id: chatId, type: 'supergroup' } } }) } });
/** Бота добавили в чат, убрали и т. п. */
const botStatus = (chatId: number, fromId: number, status: string, opts: { title?: string; lang?: string; type?: string } = {}) =>
  botUpdate({ update_id: seq++, my_chat_member: { chat: { id: chatId, type: opts.type ?? 'group', title: opts.title ?? 'Семейный чат' }, from: person(fromId, opts.lang), new_chat_member: { status, user: BOT } } });

/** Gemini разбирает фразу в эти дела (формат — как в схеме worker/groupVoice.ts). */
const gemini = (items: object[]) =>
  net.on('https://generativelanguage.googleapis.com/', () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] }));
const draft = (d: object) => ({ title: '', mode: 'one', people: [], rotate: false, repeat: 'once', weekdays: [], day: null, time: null, duration: null, target: null, unit: null, currency: null, ...d });
/** Что ушло в Gemini последним: строка с участниками, говорящим, датой и фразой. */
const lastPrompt = () => {
  const call = net.calls.filter((c) => c.url.startsWith('https://generativelanguage.googleapis.com/')).at(-1)!;
  return JSON.parse(call.body).contents.at(-1).parts[0].text as string;
};

const todayOf = async (u: TestUser) => (await u.call('GET', '/today')).body.day as string;
const groupRow = async (id: number) => (await sb.from('groups').select('*').eq('id', id).single()).data!;
/** Вызовы метода Telegram в этом чате (тело — как ушло: текст, кнопки). */
const inChat = (method: string, chatId: number) => tg.sent(method).filter((c) => c.body.chat_id === chatId) as { method: string; body: Record<string, any> }[];
const texts = (chatId: number) => inChat('sendMessage', chatId).map((c) => c.body.text as string);

/** Группа «Семья» с подключённым чатом (как после /start g_…) и участниками по порядку вступления. */
async function family(names: string[] = [], opts: { lang?: string; timezone?: string; title?: string } = {}) {
  const owner = await user({ name: opts.lang === 'en' ? 'Ann' : 'Даша', lang: opts.lang, timezone: opts.timezone });
  const id = (await owner.call('POST', '/groups', { title: opts.title ?? 'Семья', kind: 'family' })).body.id as number;
  const members: TestUser[] = [];
  for (const name of names) {
    const u = await user({ name });
    await sb.from('group_members').insert({ group_id: id, user_id: u.id, role: 'member' });
    members.push(u);
  }
  const chatId = newChat();
  await sb.from('groups').update({ tg_chat_id: chatId, tg_chat_title: 'Семейный чат' }).eq('id', id);
  tg.calls = [];
  return { id, owner, members, chatId };
}

async function addItem(u: TestUser, gid: number, body: object): Promise<number> {
  const res = await u.call('POST', `/groups/${gid}/items`, body);
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe.skipIf(!ready)('подключение чата по /start g_<код>', () => {
  it('создатель подключает: привет, «Сегодня в группе» с кнопками, сообщение закреплено', async () => {
    const owner = await user({ name: 'Даша' });
    const id = (await owner.call('POST', '/groups', { title: 'Семья' })).body.id;
    const a = await addItem(owner, id, { title: 'Купить корм', mode: 'one' });
    const code = (await owner.call('POST', `/groups/${id}/invite`)).body.code;
    const day = await todayOf(owner);
    const chatId = newChat();
    tg.calls = [];
    await say(chatId, owner.id, `/start@LifeCommit_bot g_${code}`);

    const row = await groupRow(id);
    expect(row).toMatchObject({ tg_chat_id: chatId, tg_chat_title: 'Семейный чат', tg_today_day: day });
    const [hello, today] = inChat('sendMessage', chatId);
    expect(hello!.body.text).toBe('Привет! Этот чат теперь — группа «Семья» в LifeCommit.\n\nОтвечайте на мои сообщения текстом или голосом — добавлю общие дела. Отмечать можно кнопками прямо здесь.');
    expect(today!.body.text).toContain('<b>Сегодня в «Семья»</b> · 0 из 1');
    expect(today!.body.text).toContain('○ Купить корм');
    expect(today!.body.reply_markup.inline_keyboard).toEqual([
      [{ text: '✓ Купить корм', callback_data: `gm:${a}:${day}` }],
      [{ text: 'Открыть ↗', url: `https://t.me/LifeCommit_bot?startapp=grp_${id}` }],
    ]);
    expect(inChat('pinChatMessage', chatId)[0]!.body).toMatchObject({ message_id: row.tg_today_msg_id });
  });

  it('админ подключает, участник — нет: бот отказывает и выходит из чата, который ни к чему не привязан', async () => {
    const owner = await user({ name: 'Даша' });
    const id = (await owner.call('POST', '/groups', { title: 'Семья' })).body.id;
    const code = (await owner.call('POST', `/groups/${id}/invite`)).body.code;
    const masha = await user({ name: 'Маша' });
    await masha.call('POST', `/invites/${code}/join`);
    const chatId = newChat();
    await say(chatId, masha.id, `/start g_${code}`);
    expect(texts(chatId)).toEqual(['Подключить чат к группе «Семья» может только её создатель или админ.']);
    expect(inChat('leaveChat', chatId)).toHaveLength(1);
    expect((await groupRow(id)).tg_chat_id).toBeNull();

    await sb.from('group_members').update({ role: 'admin' }).eq('group_id', id).eq('user_id', masha.id);
    await say(chatId, masha.id, `/start g_${code}`);
    expect((await groupRow(id)).tg_chat_id).toBe(chatId);
  });

  it('человек из приложения не в группе — становится участником, но подключить не может; без приложения — отказ по-английски', async () => {
    const owner = await user({ name: 'Даша' });
    const id = (await owner.call('POST', '/groups', { title: 'Семья' })).body.id;
    const code = (await owner.call('POST', `/groups/${id}/invite`)).body.code;
    const petya = await user({ name: 'Петя' });
    const chatId = newChat();
    // Выйти не вышло (чата уже нет) — не беда.
    tg.reply('leaveChat', { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
    await say(chatId, petya.id, `/start g_${code}`);
    expect((await sb.from('group_members').select('role').eq('group_id', id).eq('user_id', petya.id).single()).data?.role).toBe('member');
    expect(inChat('leaveChat', chatId)).toHaveLength(1);

    const nobody = stranger();
    // Отказ доставить не удалось — всё равно выходим.
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: bot is not a member of the supergroup chat' });
    await say(chatId, nobody, `/start g_${code}`, {}, 'en');
    expect(texts(chatId).at(-1)).toBe('Only the owner or an admin of “Семья” can connect a chat to it.');
    expect(inChat('leaveChat', chatId)).toHaveLength(2);
    expect((await sb.from('group_members').select('user_id').eq('group_id', id)).data).toHaveLength(2);
  });

  it('отказ в чате, который уже подключён к другой группе: бот остаётся', async () => {
    const { chatId } = await family();
    const other = await user({ name: 'Петя' });
    const otherId = (await other.call('POST', '/groups', { title: 'Футбол' })).body.id;
    const code = (await other.call('POST', `/groups/${otherId}/invite`)).body.code;
    tg.calls = [];
    await say(chatId, stranger(), `/start g_${code}`);
    expect(texts(chatId)).toEqual(['Подключить чат к группе «Футбол» может только её создатель или админ.']);
    expect(tg.sent('leaveChat')).toEqual([]);
  });

  it('неизвестный код, /start и /today в неподключённом чате — бот молчит', async () => {
    const owner = await user();
    const chatId = newChat();
    await say(chatId, owner.id, '/start g_nosuchcode');
    await say(chatId, owner.id, '/start');
    await say(chatId, owner.id, '/today');
    expect(tg.calls).toEqual([]);
  });

  it('подключили другой чат: из прежнего бот прощается и выходит; чат, бывший у другой группы, от неё отвязан', async () => {
    const { id, owner, chatId: oldChat } = await family();
    const second = (await owner.call('POST', '/groups', { title: 'Дача' })).body.id;
    const newChatId = newChat();
    await sb.from('groups').update({ tg_chat_id: newChatId, tg_chat_title: 'Дачный чат' }).eq('id', second);
    const code = (await owner.call('POST', `/groups/${id}/invite`)).body.code;
    tg.calls = [];
    await say(newChatId, owner.id, `/start g_${code}`);
    expect(await groupRow(id)).toMatchObject({ tg_chat_id: newChatId, tg_chat_title: 'Семейный чат' });
    expect(await groupRow(second)).toMatchObject({ tg_chat_id: null, tg_chat_title: null });
    expect(texts(oldChat)).toEqual(['Этот чат отключили от группы «Семья» в LifeCommit. Пока!']);
    expect(inChat('leaveChat', oldChat)).toHaveLength(1);
    expect(texts(newChatId)[0]).toContain('Привет!');
  });

  it('повторный /start g_… в том же чате: бот не выходит из него', async () => {
    const { id, owner, chatId } = await family();
    const code = (await owner.call('POST', `/groups/${id}/invite`)).body.code;
    await say(chatId, owner.id, `/start g_${code}`);
    expect(tg.sent('leaveChat')).toEqual([]);
    expect((await groupRow(id)).tg_chat_id).toBe(chatId);
  });
});

describe.skipIf(!ready)('бота добавили или убрали (my_chat_member)', () => {
  const realSetTimeout = globalThis.setTimeout;
  beforeEach(() => {
    // Бот 2,5 с ждёт, не придёт ли следом /start g_…; в тестах не ждём.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, ms === 2500 ? 0 : ms, ...args)) as unknown as typeof setTimeout);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('бота убрали или выгнали — привязка снимается вместе с названием', async () => {
    for (const status of ['left', 'kicked']) {
      const { id, owner, chatId } = await family();
      await botStatus(chatId, owner.id, status);
      expect(await groupRow(id)).toMatchObject({ tg_chat_id: null, tg_chat_title: null, tg_today_msg_id: null });
    }
    expect(tg.calls).toEqual([]);
  });

  it('бот стал «ограниченным» — ничего не меняется', async () => {
    const { id, owner, chatId } = await family();
    await botStatus(chatId, owner.id, 'restricted');
    expect((await groupRow(id)).tg_chat_id).toBe(chatId);
    expect(tg.calls).toEqual([]);
  });

  it('добавил человек из приложения — заводится группа по названию чата и сразу подключается', async () => {
    const owner = await user({ name: 'Даша' });
    const chatId = newChat();
    await botStatus(chatId, owner.id, 'member', { title: 'Дача' });
    const { data } = await sb.from('groups').select('id, title, kind, tg_chat_id, tg_chat_title').eq('owner_id', owner.id);
    expect(data).toEqual([{ id: expect.any(Number), title: 'Дача', kind: 'other', tg_chat_id: chatId, tg_chat_title: 'Дача' }]);
    expect((await sb.from('group_members').select('role').eq('group_id', data![0]!.id).eq('user_id', owner.id).single()).data?.role).toBe('owner');
    expect(texts(chatId)[0]).toBe('Привет! Этот чат теперь — группа «Дача» в LifeCommit.\n\nОтвечайте на мои сообщения текстом или голосом — добавлю общие дела. Отмечать можно кнопками прямо здесь.');
    expect(texts(chatId)[1]).toContain('На сегодня дел нет.');
  });

  /** Запросы к базе с этими методом и путём (пары подряд: 'POST', '/rest/v1/groups', …) отвечают ошибкой, как будто PostgREST упал. */
  const failDb = (...pairs: string[]) => {
    const real = globalThis.fetch;
    const failing = new Set(pairs.flatMap((p, i) => (i % 2 ? [] : [`${p} ${pairs[i + 1]}`])));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const req = new Request(input as RequestInfo, init);
      if (req.url.startsWith(env.SUPABASE_URL) && failing.has(`${req.method} ${new URL(req.url).pathname}`)) return Response.json({ message: 'boom' }, { status: 500 });
      return real(req);
    });
  };

  it('группу завести не вышло — в лог и в чат «не получилось», молча не пропадаем', async () => {
    const owner = await user();
    const chatId = newChat();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failDb('POST', '/rest/v1/groups');
    await botStatus(chatId, owner.id, 'member', { title: 'Дача' });
    expect((await sb.from('groups').select('id').eq('owner_id', owner.id)).data).toEqual([]);
    expect(log).toHaveBeenCalledWith('group from chat: create failed', chatId, owner.id, expect.anything());
    expect(texts(chatId)).toEqual(['Не получилось подключить этот чат. Уберите бота из чата и добавьте ещё раз чуть позже.']);
  });

  it('владельца в группу записать не вышло — группа без владельца не остаётся', async () => {
    const owner = await user({ lang: 'en' });
    const chatId = newChat();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failDb('POST', '/rest/v1/group_members');
    await botStatus(chatId, owner.id, 'member', { title: 'Dacha', lang: 'en' });
    expect((await sb.from('groups').select('id').eq('owner_id', owner.id)).data).toEqual([]);
    expect(log).toHaveBeenCalledWith('group from chat: owner not added', expect.any(Number), owner.id, expect.anything());
    expect(texts(chatId)).toEqual(['Could not connect this chat. Remove the bot from the chat and add it again a bit later.']);
  });

  it('и убрать такую группу не вышло — это тоже в лог', async () => {
    const owner = await user();
    const chatId = newChat();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failDb('POST', '/rest/v1/group_members', 'DELETE', '/rest/v1/groups');
    await botStatus(chatId, owner.id, 'member');
    expect(log).toHaveBeenCalledWith('group from chat: orphan not removed', expect.any(Number), expect.anything());
    await sb.from('groups').delete().eq('owner_id', owner.id);
  });

  // 04.10.2026: привязка не записалась, а бот всё равно здоровался «этот чат теперь — группа…».
  it('привязать чат не вышло (/start g_…) — в лог и в чат «не получилось», привета нет, чат не привязан', async () => {
    const owner = await user({ name: 'Даша' });
    const id = (await owner.call('POST', '/groups', { title: 'Семья' })).body.id as number;
    const code = (await owner.call('POST', `/groups/${id}/invite`)).body.code;
    const chatId = newChat();
    tg.calls = [];
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failDb('PATCH', '/rest/v1/groups');
    await say(chatId, owner.id, `/start@LifeCommit_bot g_${code}`);
    expect(log).toHaveBeenCalledWith('group chat: bind failed', id, chatId, expect.anything());
    expect(texts(chatId)).toEqual(['Не получилось подключить этот чат. Уберите бота из чата и добавьте ещё раз чуть позже.']);
    vi.restoreAllMocks();
    expect((await groupRow(id)).tg_chat_id).toBeNull();
  });

  it('привязка: не прочиталась группа или не записался сам чат — тоже «не получилось»', async () => {
    const owner = await user({ name: 'Даша', lang: 'en' });
    const id = (await owner.call('POST', '/groups', { title: 'Семья' })).body.id as number;
    const code = (await owner.call('POST', `/groups/${id}/invite`)).body.code;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const readFails = newChat();
    failDb('GET', '/rest/v1/groups');
    await say(readFails, owner.id, `/start g_${code}`, {}, 'en');
    expect(texts(readFails)).toEqual(['Could not connect this chat. Remove the bot from the chat and add it again a bit later.']);
    vi.mocked(globalThis.fetch).mockRestore();
    // Отвязать чат от других групп удалось, а записать его самой группе — нет (запись с этим tg_chat_id).
    const bindFails = newChat();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const req = new Request(input as RequestInfo, init);
      if (req.method === 'PATCH' && req.url.startsWith(`${env.SUPABASE_URL}/rest/v1/groups`) && (await req.clone().text()).includes(`"tg_chat_id":${bindFails}`)) return Response.json({ message: 'boom' }, { status: 500 });
      return real(req);
    });
    await say(bindFails, owner.id, `/start g_${code}`, {}, 'en');
    expect(log).toHaveBeenCalledWith('group chat: bind failed', id, bindFails, expect.anything());
    expect(texts(bindFails)).toEqual(['Could not connect this chat. Remove the bot from the chat and add it again a bit later.']);
    vi.restoreAllMocks();
    expect((await groupRow(id)).tg_chat_id).toBeNull();
  });

  it('длинное название чата обрезается до 60 знаков, без названия — «Группа»', async () => {
    const owner = await user();
    await botStatus(newChat(), owner.id, 'member', { title: 'Очень длинное название семейного чата '.repeat(3) });
    const untitled = newChat();
    await botUpdate({ update_id: seq++, my_chat_member: { chat: { id: untitled, type: 'group' }, from: person(owner.id), new_chat_member: { status: 'member', user: BOT } } });
    const { data } = await sb.from('groups').select('title, tg_chat_id, tg_chat_title').eq('owner_id', owner.id).order('id');
    expect(data![0]!.title).toHaveLength(60);
    expect(data![0]!.title.endsWith('…')).toBe(true);
    expect(data![1]).toEqual({ title: 'Группа', tg_chat_id: untitled, tg_chat_title: null });
  });

  it('добавили по ссылке и /start уже подключил чат — новая группа не заводится', async () => {
    const { owner, chatId } = await family();
    await botStatus(chatId, owner.id, 'administrator');
    expect((await sb.from('groups').select('id').eq('owner_id', owner.id)).data).toHaveLength(1);
    expect(tg.calls).toEqual([]);
  });

  it('добавили по ссылке, но не админ группы: бот уже вышел — группу не заводим', async () => {
    const owner = await user();
    const chatId = newChat();
    tg.reply('getChatMember', { ok: true, result: { status: 'left', user: BOT } });
    await botStatus(chatId, owner.id, 'member');
    expect((await sb.from('groups').select('id').eq('owner_id', owner.id)).data).toEqual([]);
    expect(tg.sent('sendMessage')).toEqual([]);
  });

  it('бот не может проверить себя в чате (чата нет) — тоже не заводим', async () => {
    const owner = await user();
    const chatId = newChat();
    tg.reply('getChatMember', { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
    await botStatus(chatId, owner.id, 'member');
    expect((await sb.from('groups').select('id').eq('owner_id', owner.id)).data).toEqual([]);
  });

  it('добавил человек без приложения — просьба открыть LifeCommit на его языке', async () => {
    const chatId = newChat();
    await botStatus(chatId, stranger(), 'member');
    await botStatus(chatId, stranger(), 'member', { lang: 'en' });
    expect(texts(chatId)).toEqual(['Чтобы подключить этот чат, откройте LifeCommit — это пара секунд.', 'To connect this chat, open LifeCommit — it takes a couple of seconds.']);
    expect(inChat('sendMessage', chatId)[0]!.body.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Открыть LifeCommit', url: 'https://t.me/LifeCommit_bot?start=app' }]] });
  });

  it('название чата пустое или из пробелов — как без названия: «Группа»', async () => {
    const owner = await user();
    for (const title of ['', '   ']) await botStatus(newChat(), owner.id, 'member', { title });
    const { data } = await sb.from('groups').select('title').eq('owner_id', owner.id);
    expect(data).toEqual([{ title: 'Группа' }, { title: 'Группа' }]);
  });

  it('в личке это не про группы — разбирает обычный бот', async () => {
    const owner = await user();
    await botStatus(owner.id, owner.id, 'kicked', { type: 'private' });
    expect(tg.calls).toEqual([]);
  });
});

describe.skipIf(!ready)('служебные сообщения чата', () => {
  it('чат стал супергруппой (оба вида сообщений) и переименован — привязка и название едут следом', async () => {
    const { id, chatId } = await family();
    await sb.from('groups').update({ tg_today_msg_id: 555, tg_today_day: '2026-10-01' }).eq('id', id);
    const superId = newChat();
    await service(chatId, { migrate_to_chat_id: superId });
    expect(await groupRow(id)).toMatchObject({ tg_chat_id: superId, tg_today_msg_id: null, tg_today_day: null });
    const again = newChat();
    await service(again, { migrate_from_chat_id: superId });
    expect((await groupRow(id)).tg_chat_id).toBe(again);
    await service(again, { new_chat_title: 'Семья 2.0' });
    expect((await groupRow(id)).tg_chat_title).toBe('Семья 2.0');
    expect(tg.calls).toEqual([]);
  });
});

describe.skipIf(!ready)('дела ответом боту', () => {
  it('текстом: дела всех режимов, ответ с описанием и «Отменить», сообщение дня обновляется', async () => {
    const { id, owner, members: [masha, petya], chatId } = await family(['Маша', 'Петя']);
    const day = await todayOf(owner);
    await sb.from('groups').update({ tg_today_msg_id: 555, tg_today_day: day }).eq('id', id);
    gemini([
      draft({ title: 'Купить корм', day }),
      draft({ title: 'Мыть посуду', mode: 'assign', people: ['Маше'], repeat: 'daily', time: '21:00' }),
      draft({ title: 'Вынести мусор', mode: 'assign', people: ['я', 'Петя'], rotate: true, repeat: 'days', weekdays: ['TU', 'FR'] }),
      draft({ title: 'Зарядка', mode: 'assign', people: ['все'], repeat: 'weekdays' }),
      draft({ title: 'Уборка', mode: 'assign', people: ['all'], rotate: true, repeat: 'weekends' }),
      draft({ title: 'Ужин', mode: 'event', people: ['all'], day: addDays(day, 1), time: '19:00' }),
      draft({ title: 'Отпуск', mode: 'goal', target: 150000, unit: 'рублей', currency: 'RUB' }),
      draft({ title: 'Книги', mode: 'goal', target: 50, unit: 'книг' }),
      draft({ title: 'Шаги', mode: 'goal', target: 1000000 }),
    ]);
    await replyToBot(chatId, owner.id, { text: 'купить корм, Маше посуду, мусор по очереди я и Петя, копим 150 тысяч рублей' });

    expect(lastPrompt()).toContain(`Members: Даша, Маша, Петя\nSpeaker: Даша\n`);
    const { data: rows } = await sb.from('group_items').select('id, title, mode, assignees, all_members, rotate, rrule, created_by').eq('group_id', id).order('id');
    expect(rows).toHaveLength(9);
    expect(rows!.every((r) => r.created_by === owner.id)).toBe(true);
    expect(rows![1]).toMatchObject({ title: 'Мыть посуду', mode: 'assign', assignees: [masha.id], rrule: 'FREQ=DAILY' });
    expect(rows![2]).toMatchObject({ assignees: [owner.id, petya.id], rotate: true, rrule: 'FREQ=WEEKLY;BYDAY=TU,FR' });

    const answer = inChat('sendMessage', chatId)[0]!.body;
    expect(answer.reply_parameters).toEqual({ message_id: 4242 });
    const dinnerDay = new Date(`${addDays(day, 1)}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const lines = (answer.text as string).split('\n');
    expect(lines[0]).toBe('Добавил в «Семья»:');
    expect(lines.slice(1, 7)).toEqual([
      '• Купить корм — кто-то один · сегодня',
      '• Мыть посуду — Маша · каждый день, 21:00',
      '• Вынести мусор — по очереди: Даша → Петя · вт, пт',
      '• Зарядка — каждому · по будням',
      '• Уборка — по очереди: Даша → Маша → Петя · по выходным',
      `• Ужин — мероприятие · ${dinnerDay}, 19:00`,
    ]);
    expect(lines[7]).toMatch(/^• Отпуск — общая цель: 150\s000 ₽$/);
    expect(lines[8]).toBe('• Книги — общая цель: 50 книг');
    expect(lines[9]).toMatch(/^• Шаги — общая цель: 1\s000\s000$/);
    const undo = `gu:${rows!.map((r) => r.id).join(',')}`;
    expect(answer.reply_markup.inline_keyboard).toEqual([new TextEncoder().encode(undo).length <= 64 ? [{ text: 'Отменить', callback_data: undo }] : []]);
    // Сегодняшнее сообщение — правится, нового не шлём.
    const edit = inChat('editMessageText', chatId)[0]!.body;
    expect(edit.message_id).toBe(555);
    expect(edit.text).toContain('Купить корм');
    expect(inChat('sendMessage', chatId)).toHaveLength(1);
  });

  it('много дел сразу: больше 12 не берём; «Отменить» не влезает в 64 байта кнопки — ответ без кнопки', async () => {
    const { id, owner, chatId } = await family();
    // В свежей локальной базе id дел короткие — двигаем счётчик до пятизначных, чтобы 12 id точно не влезли в кнопку.
    const row = { group_id: id, title: 'x', mode: 'one', day: '2026-10-01' };
    const probe = (await sb.from('group_items').insert(row).select('id').single()).data!.id as number;
    if (probe < 10_000) await sb.from('group_items').insert(Array.from({ length: 10_000 - probe }, () => row));
    await sb.from('group_items').delete().eq('group_id', id);
    gemini(Array.from({ length: 14 }, (_, i) => draft({ title: `Дело ${i + 1}` })));
    await replyToBot(chatId, owner.id, { text: 'много всего' });
    const { data: rows } = await sb.from('group_items').select('id').eq('group_id', id).order('id');
    expect(rows).toHaveLength(12);
    expect(rows!.every((r) => r.id >= 10_000)).toBe(true);
    const answer = inChat('sendMessage', chatId)[0]!.body;
    expect((answer.text as string).split('\n')).toHaveLength(13);
    expect(answer.reply_markup.inline_keyboard).toEqual([[]]);
  });

  it('упоминание бота вместо ответа: имя бота из фразы убирается', async () => {
    const { id, owner, chatId } = await family();
    gemini([draft({ title: 'Купить хлеб' })]);
    await say(chatId, owner.id, '@LifeCommit_bot купить хлеб');
    expect(lastPrompt().endsWith('\nкупить хлеб')).toBe(true);
    expect((await sb.from('group_items').select('title').eq('group_id', id)).data).toEqual([{ title: 'Купить хлеб' }]);
  });

  it('голосом: расшифровка, «Расслышал» и добавленные дела', async () => {
    const { id, owner, chatId } = await family();
    const day = await todayOf(owner);
    ai.transcript = 'завтра купить корм';
    gemini([draft({ title: 'Купить корм', day: addDays(day, 1) })]);
    await replyToBot(chatId, owner.id, { voice: { file_id: 'voice-1', duration: 5 } });
    expect(inChat('sendChatAction', chatId)[0]!.body.action).toBe('typing');
    expect(tg.sent('getFile')[0]!.body).toEqual({ file_id: 'voice-1' });
    expect(ai.calls.some((c) => c.model.includes('whisper'))).toBe(true);
    const text = texts(chatId)[0]!;
    expect(text.startsWith('Расслышал: «завтра купить корм»\n\nДобавил в «Семья»:\n• Купить корм — кто-то один · ')).toBe(true);
    expect((await sb.from('group_items').select('day').eq('group_id', id).single()).data?.day).toBe(addDays(day, 1));
  });

  it('голос длиннее полутора минут и исчерпанный дневной лимит — вежливый отказ', async () => {
    const { owner, chatId } = await family();
    await replyToBot(chatId, owner.id, { voice: { file_id: 'v', duration: 91 } });
    expect(texts(chatId)).toEqual(['Слишком длинное сообщение — до полутора минут.']);
    expect(ai.calls).toEqual([]);
    await sb.from('voice_usage').upsert({ user_id: owner.id, day: new Date().toISOString().slice(0, 10), count: 20 });
    await replyToBot(chatId, owner.id, { text: 'купить корм' });
    expect(texts(chatId)[1]).toBe('На сегодня хватит: разбираю до 20 сообщений в день на человека.');
    expect(net.calls).toEqual([]);
  });

  it('не понял — подсказка; голос с пустой расшифровкой — только подсказка; с расшифровкой — и «Расслышал»', async () => {
    const { id, owner, chatId } = await family();
    const nothing = 'Не понял, что добавить. Скажите, например: «завтра купить корм Тесле, ингаляция каждый день в девять вечера».';
    gemini([]);
    await replyToBot(chatId, owner.id, { text: 'привет всем' });
    ai.transcript = '';
    await replyToBot(chatId, owner.id, { voice: { file_id: 'v', duration: 3 } });
    ai.transcript = 'ммм';
    await replyToBot(chatId, owner.id, { voice: { file_id: 'v', duration: 3 } });
    expect(texts(chatId)).toEqual([nothing, nothing, `Расслышал: «ммм»\n\n${nothing}`]);
    expect((await sb.from('group_items').select('id').eq('group_id', id)).data).toEqual([]);
  });

  it('Telegram не отдал голос — «Не получилось разобрать»', async () => {
    const { owner, chatId } = await family();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    tg.reply('getFile', { ok: false, error_code: 400, description: 'Bad Request: file is too big' });
    await replyToBot(chatId, owner.id, { voice: { file_id: 'v', duration: 3 } });
    expect(texts(chatId)).toEqual(['Не получилось разобрать. Попробуйте ещё раз чуть позже.']);
    expect(log).toHaveBeenCalledWith('group add failed', expect.anything());
    log.mockRestore();
  });

  it('пишет человек без приложения — приглашение открыть LifeCommit, дела не добавляются', async () => {
    const { id, chatId } = await family();
    await replyToBot(chatId, stranger(), { text: 'купить корм' });
    const msg = inChat('sendMessage', chatId)[0]!.body;
    expect(msg.text).toBe('Сначала откройте LifeCommit и вступите в группу');
    expect(msg.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Открыть LifeCommit', url: 'https://t.me/LifeCommit_bot?start=app' }]] });
    expect((await sb.from('group_items').select('id').eq('group_id', id)).data).toEqual([]);
    expect(net.calls).toEqual([]);
  });

  it('человек из приложения, ещё не в группе, — становится участником и добавляет дела', async () => {
    const { id, chatId } = await family();
    const petya = await user({ name: 'Петя' });
    gemini([draft({ title: 'Футбол в субботу', mode: 'event', people: ['all'], repeat: 'days', weekdays: ['SA'] })]);
    await replyToBot(chatId, petya.id, { text: 'по субботам футбол' });
    expect((await sb.from('group_members').select('role').eq('group_id', id).eq('user_id', petya.id).single()).data?.role).toBe('member');
    expect((await sb.from('group_items').select('created_by, rrule, all_members').eq('group_id', id).single()).data).toEqual({ created_by: petya.id, rrule: 'FREQ=WEEKLY;BYDAY=SA', all_members: true });
    expect(texts(chatId)[0]).toContain('• Футбол в субботу — мероприятие · сб');
  });

  it('англоязычная группа: ответ и даты по-английски, валюта — только названная', async () => {
    const { owner, chatId } = await family([], { lang: 'en', title: 'Team' });
    const day = await todayOf(owner);
    gemini([
      draft({ title: 'Party', mode: 'event', people: ['all'], day: addDays(day, 5) }),
      draft({ title: 'Trip', mode: 'goal', target: 2000, unit: 'dollars', currency: 'USD' }),
      draft({ title: 'Run', mode: 'assign', people: ['me'], repeat: 'weekly', weekdays: ['MO'] }),
    ]);
    await replyToBot(chatId, owner.id, { text: 'party next week, save $2000 for a trip, I run on mondays' });
    const party = new Date(`${addDays(day, 5)}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    expect(texts(chatId)[0]).toBe(`Added to “Team”:\n• Party — event · ${party}\n• Trip — shared goal: 2,000 $\n• Run — Ann · Mon`);
  });

  it('англоязычная группа: привет, голос и очередь — по-английски', async () => {
    const owner = await user({ name: 'Ann', lang: 'en' });
    const id = (await owner.call('POST', '/groups', { title: 'Team' })).body.id;
    const bob = await user({ name: 'Bob', lang: 'en' });
    await sb.from('group_members').insert({ group_id: id, user_id: bob.id, role: 'member' });
    const code = (await owner.call('POST', `/groups/${id}/invite`)).body.code;
    const chatId = newChat();
    await say(chatId, owner.id, `/start g_${code}`, {}, 'en');
    expect(texts(chatId)).toEqual([
      "Hi! This chat is now the “Team” group in LifeCommit.\n\nReply to my messages with text or voice and I'll add shared to-dos. Check them off with the buttons right here.",
      '<b>Today in “Team”</b>\n\nNothing for today.\n\n<i>Reply to this message with text or voice to add to-dos.</i>',
    ]);
    tg.calls = [];
    ai.transcript = 'we take turns taking out the trash every day';
    gemini([draft({ title: 'Trash', mode: 'assign', people: ['me', 'Bob'], rotate: true, repeat: 'daily' })]);
    await replyToBot(chatId, owner.id, { voice: { file_id: 'v', duration: 4 } });
    expect(texts(chatId)).toEqual(['I heard: “we take turns taking out the trash every day”\n\nAdded to “Team”:\n• Trash — taking turns: Ann → Bob · every day']);
    // Сообщение дня правится: сегодня очередь Ann.
    expect(inChat('editMessageText', chatId)[0]!.body.text).toContain("○ Trash — Ann's turn");
  });

  it('не боту, без текста, в неподключённом чате, от бота и без автора — бот молчит', async () => {
    const { owner, chatId } = await family();
    await say(chatId, owner.id, 'просто болтаем');
    await replyToBot(chatId, owner.id, { sticker: { file_id: 's' } });
    await replyToBot(newChat(), owner.id, { text: 'купить корм' });
    await botUpdate({ update_id: seq++, message: { message_id: 1, chat: { id: chatId, type: 'supergroup' }, from: BOT, text: '@LifeCommit_bot привет' } });
    await service(chatId, { text: '@LifeCommit_bot от имени канала' });
    expect(tg.calls).toEqual([]);
    expect(net.calls).toEqual([]);
  });
});

describe.skipIf(!ready)('кнопки под сообщениями бота', () => {
  it('✓ — отметка с именем в сообщении дня; ещё раз — отметка снята', async () => {
    const { id, owner, members: [masha], chatId } = await family(['Маша']);
    const day = await todayOf(owner);
    const a = await addItem(owner, id, { title: 'Ингаляция', mode: 'one', rrule: 'FREQ=DAILY' });
    await sb.from('groups').update({ tg_today_msg_id: 555, tg_today_day: day }).eq('id', id);
    tg.calls = [];
    // Ответ на нажатие опоздал — отметка всё равно сохраняется.
    tg.reply('answerCallbackQuery', { ok: false, error_code: 400, description: 'Bad Request: query is too old and response timeout expired or query ID is invalid' });
    await press(chatId, masha.id, `gm:${a}:${day}`);
    expect((await sb.from('group_item_marks').select('user_id, day').eq('item_id', a)).data).toEqual([{ user_id: masha.id, day }]);
    expect(tg.sent('answerCallbackQuery')[0]!.body).toMatchObject({ text: 'Готово ✓' });
    expect(inChat('editMessageText', chatId)[0]!.body.text).toContain('✓ <s>Ингаляция</s> — Маша');
    await press(chatId, masha.id, `gm:${a}:${day}`);
    expect((await sb.from('group_item_marks').select('user_id').eq('item_id', a)).data).toEqual([]);
    expect(tg.sent('answerCallbackQuery')[1]!.body).toMatchObject({ text: 'Отметка снята' });
  });

  it('чужое назначенное — «не на тебе»; отмеченное вчера вчерашней кнопкой — «уже сделал»', async () => {
    const { id, owner, members: [masha], chatId } = await family(['Маша']);
    const day = await todayOf(owner);
    const toMasha = await addItem(owner, id, { title: 'Посуда', mode: 'assign', assignees: [masha.id] });
    await press(chatId, owner.id, `gm:${toMasha}:${day}`);
    expect(tg.sent('answerCallbackQuery')[0]!.body.text).toBe('Это дело сегодня не на тебе');
    // Кнопка удалённого дела — тоже отказ, без отметки.
    await owner.call('DELETE', `/groups/${id}/items/${toMasha}`);
    await press(chatId, masha.id, `gm:${toMasha}:${day}`);
    expect(tg.sent('answerCallbackQuery').at(-1)!.body.text).toBe('Это дело сегодня не на тебе');
    expect((await sb.from('group_item_marks').select('item_id').eq('item_id', toMasha)).data).toEqual([]);
    const daily = await addItem(owner, id, { title: 'Зарядка', mode: 'one', rrule: 'FREQ=DAILY', day: addDays(day, -2) });
    await owner.call('PUT', `/groups/${id}/items/${daily}/mark`, { day: addDays(day, -1) });
    tg.calls = [];
    await press(chatId, owner.id, `gm:${daily}:${addDays(day, -1)}`);
    expect(tg.sent('answerCallbackQuery')[0]!.body.text).toBe('Уже кто-то сделал');
    expect((await sb.from('group_item_marks').select('day').eq('item_id', daily)).data).toEqual([{ day: addDays(day, -1) }]);
  });

  it('без приложения: кнопка открывает бота с приглашением; действующее приглашение переиспользуется', async () => {
    const { id, owner, chatId } = await family();
    const day = await todayOf(owner);
    const a = await addItem(owner, id, { title: 'Корм', mode: 'one' });
    // Приглашение, которое кончится меньше чем через сутки, не годится.
    await sb.from('invites').insert({ code: `soon${Math.random().toString(36).slice(2, 10)}`, inviter_id: owner.id, group_id: id, expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    const nobody = stranger();
    await press(chatId, nobody, `gm:${a}:${day}`);
    await press(chatId, nobody, `gm:${a}:${day}`);
    const [first, second] = tg.sent('answerCallbackQuery').map((c) => c.body.url as string);
    expect(first).toMatch(/^https:\/\/t\.me\/LifeCommit_bot\?start=g_[a-z2-9]{10}$/);
    expect(second).toBe(first);
    const code = first!.split('g_')[1];
    expect((await sb.from('invites').select('inviter_id, group_id').eq('code', code).single()).data).toEqual({ inviter_id: owner.id, group_id: id });
    expect((await sb.from('group_item_marks').select('item_id').eq('item_id', a)).data).toEqual([]);
  });

  it('кнопка из неподключённого чата или без сообщения — просто ответ без действия', async () => {
    const owner = await user();
    await press(newChat(), owner.id, 'gm:1:2026-10-03');
    await press(null, owner.id, 'gu:1,2');
    expect(tg.calls.map((c) => c.method)).toEqual(['answerCallbackQuery', 'answerCallbackQuery']);
    expect(tg.calls[0]!.body).toEqual({ callback_query_id: expect.any(String) });
  });

  it('«Отменить»: удаляет только добавивший, сообщение заменяется на «Отменено»', async () => {
    const { id, owner, members: [masha], chatId } = await family(['Маша']);
    gemini([draft({ title: 'Корм' }), draft({ title: 'Посуда' })]);
    await replyToBot(chatId, owner.id, { text: 'корм и посуда' });
    const ids = ((await sb.from('group_items').select('id').eq('group_id', id).order('id')).data ?? []).map((r) => r.id);
    expect(ids).toHaveLength(2);
    tg.calls = [];
    // Чужое «Отменить» ничего не удаляет и не трогает сообщение — кнопка остаётся у того, кто добавил.
    await press(chatId, masha.id, `gu:${ids.join(',')}`);
    expect((await sb.from('group_items').select('id').eq('group_id', id).is('archived_at', null)).data).toHaveLength(2);
    expect(tg.sent('answerCallbackQuery')).toHaveLength(1);
    expect(inChat('editMessageText', chatId).filter((c) => c.body.message_id === 777)).toEqual([]);

    // Сообщение с кнопкой уже удалили — отмена всё равно срабатывает.
    tg.reply('editMessageText', { ok: false, error_code: 400, description: 'Bad Request: message to edit not found' });
    await press(chatId, owner.id, `gu:${ids.join(',')}`);
    expect((await sb.from('group_items').select('id').eq('group_id', id).is('archived_at', null)).data).toEqual([]);
    expect(inChat('editMessageText', chatId).find((c) => c.body.message_id === 777)!.body.text).toBe('Отменено — эти дела удалены.');
    // Мусор в данных кнопки — ничего не удаляем.
    tg.calls = [];
    await press(chatId, owner.id, 'gu:abc,-1');
    expect(tg.sent('answerCallbackQuery')).toHaveLength(1);
    expect(inChat('editMessageText', chatId).filter((c) => c.body.message_id === 777)).toEqual([]);
  });
});

describe.skipIf(!ready)('«Сегодня в группе»', () => {
  it('/today — новое сообщение и закрепить; пусто — «На сегодня дел нет»; /start без кода — то же', async () => {
    const { id, owner, chatId } = await family();
    const day = await todayOf(owner);
    await say(chatId, owner.id, '/today');
    expect(texts(chatId)[0]).toBe('<b>Сегодня в «Семья»</b>\n\nНа сегодня дел нет.\n\n<i>Ответьте на это сообщение текстом или голосом — добавлю дела.</i>');
    const row = await groupRow(id);
    expect(row.tg_today_day).toBe(day);
    expect(inChat('pinChatMessage', chatId)[0]!.body.message_id).toBe(row.tg_today_msg_id);
    // Закрепить не дали — не беда, сообщение всё равно запомнено.
    tg.reply('pinChatMessage', { ok: false, error_code: 400, description: 'Bad Request: not enough rights to manage pinned messages in the chat' });
    await say(chatId, owner.id, '/start');
    expect(inChat('sendMessage', chatId)).toHaveLength(2);
    expect((await groupRow(id)).tg_today_msg_id).not.toBe(row.tg_today_msg_id);
  });

  it('правка из приложения: «не изменилось» — новое не шлём; сообщение удалили — шлём новое', async () => {
    const { id, owner, chatId } = await family();
    const day = await todayOf(owner);
    const a = await addItem(owner, id, { title: 'Корм', mode: 'one', rrule: 'FREQ=DAILY' });
    await sb.from('groups').update({ tg_today_msg_id: 555, tg_today_day: day }).eq('id', id);
    tg.calls = [];
    tg.reply('editMessageText', { ok: false, error_code: 400, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' });
    await owner.call('POST', `/groups/${id}/items/${a}/skip`, { day: addDays(day, 3) });
    expect(inChat('editMessageText', chatId)).toHaveLength(1);
    expect(inChat('sendMessage', chatId)).toEqual([]);

    tg.reply('editMessageText', { ok: false, error_code: 400, description: 'Bad Request: message to edit not found' });
    await owner.call('PUT', `/groups/${id}/items/${a}/mark`, {});
    const sent = inChat('sendMessage', chatId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.text).toContain('<s>Корм</s>');
    expect((await groupRow(id)).tg_today_msg_id).not.toBe(555);
  });

  it('чат удалён — привязка снимается тихо; стал супергруппой — переезжает, сообщение уходит в новый чат', async () => {
    const gone = await family();
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: the group chat was deleted' });
    await say(gone.chatId, gone.owner.id, '/today');
    expect(await groupRow(gone.id)).toMatchObject({ tg_chat_id: null, tg_chat_title: null });
    expect(tg.sent('sendMessage')).toHaveLength(1);

    const { id, owner, chatId } = await family();
    const superId = newChat();
    tg.reply('sendMessage', { ok: false, error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: superId } });
    await say(chatId, owner.id, '/today');
    const row = await groupRow(id);
    expect(row.tg_chat_id).toBe(superId);
    expect(row.tg_chat_title).toBe('Семейный чат');
    expect(inChat('sendMessage', superId)).toHaveLength(1);
    expect(row.tg_today_msg_id).not.toBeNull();
  });

  it('временная беда Telegram (лимит) — привязка остаётся, приложение отвечает как обычно', async () => {
    const { id, owner, chatId } = await family();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    tg.reply('sendMessage', { ok: false, error_code: 429, description: 'Too Many Requests: retry after 5', parameters: { retry_after: 5 } });
    const res = await owner.call('POST', `/groups/${id}/items`, { title: 'Корм', mode: 'one' });
    expect(res.status).toBe(201);
    expect(log).toHaveBeenCalledWith('chat refresh failed', expect.anything());
    expect((await groupRow(id)).tg_chat_id).toBe(chatId);
    log.mockRestore();
  });

  it('создатель выпал из участников (данные разошлись) — бот не падает, список пустой', async () => {
    const { id, owner, chatId } = await family();
    await addItem(owner, id, { title: 'Корм', mode: 'one' });
    await sb.from('group_members').delete().eq('group_id', id).eq('user_id', owner.id);
    tg.calls = [];
    await say(chatId, owner.id, '/today');
    expect(texts(chatId)[0]).toContain('На сегодня дел нет.');
  });

  it('группа без создателя (удалил аккаунт): бот не падает, список пустой', async () => {
    const chatId = newChat();
    const { data } = await sb.from('groups').insert({ title: 'Сироты', owner_id: null, tg_chat_id: chatId }).select('id').single();
    try {
      await say(chatId, stranger(), '/today');
      expect(texts(chatId)[0]).toContain('На сегодня дел нет.');
    } finally {
      await sb.from('groups').delete().eq('id', data!.id);
    }
  });

  // BUG: при удалении аккаунта (api.ts, DELETE /account) группа остаётся без создателя (owner_id = null):
  // бот строит список дня глазами создателя (chatView) и видит пустоту, утренний список и итог (groupChatsTick)
  // её пропускают, а приглашение для людей без приложения (inviteFor) не сохраняется — inviter_id обязателен.
  // Нужно передавать группу самому давнему участнику, как при «Выйти» (groups.ts, /groups/:id/leave).
  it('создатель удалил аккаунт — группа переходит участнику, в чате по-прежнему видны дела', async () => {
    const { id, owner, members: [masha], chatId } = await family(['Маша']);
    await addItem(owner, id, { title: 'Корм', mode: 'one' });
    await owner.call('DELETE', '/account');
    await say(chatId, masha.id, '/today');
    expect(texts(chatId)[0]).toContain('Корм');
  });
});

describe.skipIf(!ready)('проверка чата при открытии группы', () => {
  const check = async (u: TestUser, id: number) => (await u.call('POST', `/groups/${id}/chat/check`)).body.tg_chat_title;

  it('чат жив: новое название сохраняется; то же или без названия — прежнее', async () => {
    const { id, owner, chatId } = await family();
    tg.reply('getChat', { ok: true, result: { id: chatId, title: 'Семья ❤️', type: 'supergroup' } });
    expect(await check(owner, id)).toBe('Семья ❤️');
    expect((await groupRow(id)).tg_chat_title).toBe('Семья ❤️');
    tg.reply('getChat', { ok: true, result: { id: chatId, title: 'Семья ❤️', type: 'supergroup' } });
    expect(await check(owner, id)).toBe('Семья ❤️');
    tg.reply('getChat', { ok: true, result: { id: chatId, type: 'supergroup' } });
    expect(await check(owner, id)).toBe('Семья ❤️');
    // Сеть при проверке бота упала — считаем, что он на месте.
    tg.reply('getChatMember', { ok: false, error_code: 502, description: 'Bad Gateway' });
    tg.reply('getChat', { ok: true, result: { id: chatId, title: 'Семья ❤️', type: 'supergroup' } });
    expect(await check(owner, id)).toBe('Семья ❤️');
    expect((await groupRow(id)).tg_chat_id).toBe(chatId);
  });

  it('бота в чате нет (вышел, выгнали, нет доступа) — чат отвязывается', async () => {
    for (const reply of [
      { ok: true, result: { status: 'left', user: BOT } },
      { ok: true, result: { status: 'kicked', user: BOT } },
      { ok: false, error_code: 403, description: 'Forbidden: bot is not a member of the supergroup chat' },
    ]) {
      const { id, owner } = await family();
      tg.reply('getChatMember', reply);
      expect(await check(owner, id)).toBeNull();
      expect(await groupRow(id)).toMatchObject({ tg_chat_id: null, tg_chat_title: null });
    }
  });

  it('getChat: чата нет — отвязываем; стал супергруппой — переносим; лимит — оставляем как было', async () => {
    const gone = await family();
    tg.reply('getChat', { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
    expect(await check(gone.owner, gone.id)).toBeNull();
    expect((await groupRow(gone.id)).tg_chat_id).toBeNull();

    const moved = await family();
    const superId = newChat();
    tg.reply('getChat', { ok: false, error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: superId } });
    expect(await check(moved.owner, moved.id)).toBe('Семейный чат');
    expect((await groupRow(moved.id)).tg_chat_id).toBe(superId);

    const busy = await family();
    tg.reply('getChat', { ok: false, error_code: 429, description: 'Too Many Requests: retry after 3', parameters: { retry_after: 3 } });
    expect(await check(busy.owner, busy.id)).toBe('Семейный чат');
    expect((await groupRow(busy.id)).tg_chat_id).toBe(busy.chatId);
  });
});

// Утро и вечер — по времени создателя группы. Пояс +05:45 (Катманду): в окна 08:00 и 21:00 попадает
// только он, а не группы с целочасовыми поясами, которые параллельно заводят другие тесты.
// Тик зовём напрямую: cronTick заодно разослал бы напоминания и синхронизировал календари чужих тестов.
describe.skipIf(!ready)('утренний список и вечерний итог', () => {
  const DAY = '2026-10-05';
  const MORNING = `${DAY}T02:20:00Z`; // 08:05 в Катманду
  const EVENING = `${DAY}T15:20:00Z`; // 21:05
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const kathmandu = (names: string[] = []) => family(names, { timezone: 'Asia/Kathmandu' });

  it('утром — новый список дня (даже если сегодняшний уже есть); второй тик в том же окне — ничего', async () => {
    at(MORNING);
    const { id, owner, chatId } = await kathmandu();
    await addItem(owner, id, { title: 'Корм', mode: 'one' });
    await sb.from('groups').update({ tg_today_msg_id: 555, tg_today_day: DAY }).eq('id', id);
    tg.calls = [];
    await groupChatsTick(env);
    expect(texts(chatId)).toHaveLength(1);
    expect(texts(chatId)[0]).toContain('<b>Сегодня в «Семья»</b> · 0 из 1');
    expect(inChat('editMessageText', chatId)).toEqual([]);
    const row = await groupRow(id);
    expect(row.tg_morning_day).toBe(DAY);
    expect(row.tg_today_msg_id).not.toBe(555);
    await groupChatsTick(env);
    expect(texts(chatId)).toHaveLength(1);
  });

  it('утром только общие цели — список не шлём, но утро отмечено', async () => {
    at(MORNING);
    const { id, owner, chatId } = await kathmandu();
    await addItem(owner, id, { title: 'Отпуск', mode: 'goal', target: 1000 });
    tg.calls = [];
    await groupChatsTick(env);
    expect(texts(chatId)).toEqual([]);
    expect((await groupRow(id)).tg_morning_day).toBe(DAY);
  });

  it('утренний список не ушёл (лимит Telegram) — тик не падает, утро отмечено', async () => {
    at(MORNING);
    const { id, owner, chatId } = await kathmandu();
    await addItem(owner, id, { title: 'Корм', mode: 'one' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    tg.calls = [];
    tg.reply('sendMessage', { ok: false, error_code: 429, description: 'Too Many Requests: retry after 5' });
    await groupChatsTick(env);
    expect(log).toHaveBeenCalledWith('group chat tick failed', id, expect.anything());
    expect(inChat('sendMessage', chatId)).toHaveLength(1);
    expect(await groupRow(id)).toMatchObject({ tg_chat_id: chatId, tg_morning_day: DAY });
  });

  it('вечером — итог: сколько сделали и что осталось, без имён', async () => {
    at(EVENING);
    const { id, owner, members: [masha], chatId } = await kathmandu(['Маша']);
    const a = await addItem(owner, id, { title: 'Корм', mode: 'one' });
    const all = await addItem(owner, id, { title: 'Зарядка', mode: 'assign', all_members: true });
    await masha.call('PUT', `/groups/${id}/items/${a}/mark`, {});
    await owner.call('PUT', `/groups/${id}/items/${all}/mark`, {});
    tg.calls = [];
    await groupChatsTick(env);
    expect(texts(chatId)).toEqual(['<b>Итоги дня в «Семья»</b>\nСделали 2 из 3.\nОсталось: Зарядка.']);
    expect((await groupRow(id)).tg_digest_day).toBe(DAY);
    await groupChatsTick(env);
    expect(texts(chatId)).toHaveLength(1);
  });

  it('вечером всё сделано — «отличный день»; по-английски — тоже', async () => {
    at(EVENING);
    const ru = await kathmandu();
    const a = await addItem(ru.owner, ru.id, { title: 'Корм', mode: 'one' });
    await ru.owner.call('PUT', `/groups/${ru.id}/items/${a}/mark`, {});
    const en = await family([], { lang: 'en', timezone: 'Asia/Kathmandu', title: 'Team' });
    await addItem(en.owner, en.id, { title: 'Run', mode: 'one' });
    tg.calls = [];
    await groupChatsTick(env);
    expect(texts(ru.chatId)).toEqual(['<b>Итоги дня в «Семья»</b>\nВсё сделали — отличный день!']);
    expect(texts(en.chatId)).toEqual(['<b>Today in “Team” — summary</b>\nDone 0 of 1.\nLeft: Run.']);
  });

  it('вечером без дел на сегодня итога нет; выключенный итог не шлём', async () => {
    at(EVENING);
    const events = await kathmandu();
    await addItem(events.owner, events.id, { title: 'Ужин', mode: 'event', time: '19:00' });
    const off = await kathmandu();
    await addItem(off.owner, off.id, { title: 'Корм', mode: 'one' });
    await off.owner.call('PATCH', `/groups/${off.id}`, { chat_digest: false });
    tg.calls = [];
    await groupChatsTick(env);
    expect(texts(events.chatId)).toEqual([]);
    expect((await groupRow(events.id)).tg_digest_day).toBe(DAY);
    expect(texts(off.chatId)).toEqual([]);
    expect((await groupRow(off.id)).tg_digest_day).toBeNull();
  });

  it('итог не дошёл: чат удалён — отвязываем; лимит — привязка остаётся, тик не падает', async () => {
    at(EVENING);
    const gone = await kathmandu();
    await addItem(gone.owner, gone.id, { title: 'Корм', mode: 'one' });
    tg.calls = [];
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' });
    await groupChatsTick(env);
    expect(await groupRow(gone.id)).toMatchObject({ tg_chat_id: null, tg_digest_day: DAY });

    const busy = await kathmandu();
    await addItem(busy.owner, busy.id, { title: 'Корм', mode: 'one' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    tg.reply('sendMessage', { ok: false, error_code: 429, description: 'Too Many Requests: retry after 5' });
    await groupChatsTick(env);
    expect(log).toHaveBeenCalledWith('group chat tick failed', busy.id, expect.anything());
    expect(await groupRow(busy.id)).toMatchObject({ tg_chat_id: busy.chatId, tg_digest_day: DAY });
  });

  it('вне окон и в группе без создателя — ничего', async () => {
    at(`${DAY}T05:00:00Z`); // 10:45
    const { id, owner, chatId } = await kathmandu();
    await addItem(owner, id, { title: 'Корм', mode: 'one' });
    const orphanChat = newChat();
    const { data } = await sb.from('groups').insert({ title: 'Сироты', owner_id: null, tg_chat_id: orphanChat }).select('id').single();
    try {
      tg.calls = [];
      await groupChatsTick(env);
      at(MORNING);
      await groupChatsTick(env);
      expect(texts(orphanChat)).toEqual([]);
      expect(texts(chatId)).toHaveLength(1);
    } finally {
      await sb.from('groups').delete().eq('id', data!.id);
    }
  });
});
