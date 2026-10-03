// Бот в личке: /start, привычки и дела из текста и голосовых, дневной лимит, «Отменить», служебные адреса разработки.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, logicalDay } from './day';
import type { Env } from './env';
import worker from './index';
import { ai, botUpdate, ctx, dbReady, env, net, request, sb, tg, user, type TgCall } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('bot-тесты пропущены: нет локальной Supabase (pnpm db:start)');

const GEMINI = 'https://generativelanguage.googleapis.com/';
const APP = 'https://lifecommit.test';

// Пользователи, которых завёл сам бот (/start), — harness о них не знает, убираем сами.
const extra: number[] = [];
afterEach(async () => {
  const ids = extra.splice(0);
  if (ids.length) await sb.from('users').delete().in('id', ids);
});
// Ответы Workers AI harness между тестами не сбрасывает — возвращаем умолчания.
beforeEach(() => {
  ai.transcript = 'купить молоко';
  ai.parse = '{"habits":[],"todos":[]}';
});
const newId = () => {
  const id = 9_100_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  extra.push(id);
  return id;
};

let seq = 0;
const person = (id: number, more: object = {}) => ({ id, first_name: 'Даша', language_code: 'ru', ...more });
/** Человек пишет боту в личку. */
const say = (id: number, text: string, from: object = {}) => botUpdate({ update_id: ++seq, message: { message_id: seq, chat: { id, type: 'private' }, from: person(id, from), text } });
/** Человек присылает голосовое. */
const voice = (id: number, duration: number, file_id = 'voice-file-id') =>
  botUpdate({ update_id: ++seq, message: { message_id: seq, chat: { id, type: 'private' }, from: person(id), voice: { file_id, duration } } });
/** Человек нажимает кнопку под ответом бота. */
const press = (id: number, data: string | undefined, withMessage = true) =>
  botUpdate({ update_id: ++seq, callback_query: { id: `cb-${seq}`, from: person(id), ...(data !== undefined && { data }), ...(withMessage && { message: { message_id: 55, chat: { id } } }) } });

/** Gemini отвечает этим разбором на любой запрос. */
const gemini = (answer: object) => net.on(GEMINI, () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }));
const habit = (title: string, more: object = {}) => ({ title, kind: 'check', target: 0, unit: '', schedule: 'daily', weekdays: [], per_week: 0, ...more });
const todo = (title: string, day = '', more: object = {}) => ({ title, day, time: '', duration: 0, location: '', ...more });

/** Что бот написал в этот чат. */
const replies = (chat: number) => tg.sent('sendMessage').filter((c) => c.body.chat_id === chat);
const textOf = (c: TgCall | undefined) => c?.body.text as string;
type Button = { text: string; web_app?: { url: string }; callback_data?: string };
const buttons = (c: TgCall | undefined) => (c?.body.reply_markup as { inline_keyboard: Button[][] }).inline_keyboard[0]!;

const moscowDay = () => logicalDay('Europe/Moscow', 4);
const utcDay = () => new Date().toISOString().slice(0, 10);

/** Запрос к Worker с другим окружением (без ключа Gemini, без режима разработки, свой Workers AI). */
async function requestAs(patch: Partial<Env>, path: string, init: RequestInit = {}) {
  const c = ctx();
  const res = await worker.fetch(new Request(`${APP}${path}`, init), { ...env, ...patch }, c as unknown as ExecutionContext);
  await c.settle();
  return { status: res.status, text: await res.text() };
}

/** Workers AI, который делает то, что скажет тест. */
const aiThat = (run: (model: string, input: Record<string, unknown>) => unknown) =>
  ({ run: async (model: string, input: Record<string, unknown>) => run(model, input) }) as unknown as Ai;

describe.skipIf(!ready)('webhook', () => {
  it('чужой или пустой секрет — 403, ничего не делаем', async () => {
    const u = await user();
    const wrong = await botUpdate({ message: { chat: { id: u.id, type: 'private' }, from: person(u.id), text: '/start' } }, 'wrong-secret');
    expect(wrong.status).toBe(403);
    expect(wrong.body).toBe('forbidden');
    const none = await request('/bot/webhook', { method: 'POST', body: '{}' });
    expect(none.status).toBe(403);
    expect(tg.calls).toEqual([]);
  });

  it('секрет не задан — не пускаем никого, даже с пустым заголовком', async () => {
    const id = newId();
    const update = JSON.stringify({ message: { chat: { id, type: 'private' }, from: person(id), text: '/start' } });
    const noHeader = await requestAs({ TELEGRAM_WEBHOOK_SECRET: undefined as unknown as string }, '/bot/webhook', { method: 'POST', body: update });
    const empty = await requestAs({ TELEGRAM_WEBHOOK_SECRET: '' }, '/bot/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': '' }, body: update });
    expect([noHeader.status, empty.status]).toEqual([403, 403]);
    expect(tg.calls).toEqual([]);
    expect((await sb.from('users').select('id').eq('id', id)).data).toEqual([]);
  });

  it('битый JSON с верным секретом — 400 bad_json (ошибка запроса, а не сервера)', async () => {
    const res = await request('/bot/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET }, body: '{не json' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad_json' });
  });

  it('апдейты групповых чатов уходят в групповой обработчик', async () => {
    // смена названия чата, к которому ничего не привязано: обработчик группы забрал апдейт, в личку ничего не идёт
    const res = await botUpdate({ update_id: ++seq, message: { chat: { id: -1009000000001, type: 'supergroup' }, from: person(1), new_chat_title: 'Новое' } });
    expect(res).toEqual({ status: 200, body: 'ok' });
    expect(tg.calls).toEqual([]);
  });

  it('Telegram отказал в ответе — апдейт всё равно принят, Worker не падает', async () => {
    const id = newId();
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    const res = await say(id, '/start');
    expect(res).toEqual({ status: 200, body: 'ok' });
    expect(tg.sent('sendMessage')).toHaveLength(1);
  });

  it('незнакомые апдейты и чужие чаты бот пропускает молча', async () => {
    const u = await user();
    const answers = [
      await botUpdate({ update_id: ++seq, edited_message: { chat: { id: u.id, type: 'private' }, text: 'правка' } }),
      // канал — не группа и не личка
      await botUpdate({ update_id: ++seq, message: { chat: { id: -100, type: 'channel' }, from: person(u.id), text: '/start' } }),
      await botUpdate({ update_id: ++seq, message: { chat: { id: -100, type: 'channel' }, from: person(u.id), text: 'читать каждый день' } }),
      // команда, стикер (нет ни текста, ни голоса), другой бот, сообщение без автора
      await say(u.id, '/help'),
      await botUpdate({ update_id: ++seq, message: { chat: { id: u.id, type: 'private' }, from: person(u.id), sticker: { file_id: 'x' } } }),
      await botUpdate({ update_id: ++seq, message: { chat: { id: u.id, type: 'private' }, from: person(u.id, { is_bot: true }), text: 'читать' } }),
      await botUpdate({ update_id: ++seq, message: { chat: { id: u.id, type: 'private' }, text: 'читать' } }),
    ];
    for (const a of answers) expect(a).toEqual({ status: 200, body: 'ok' });
    expect(tg.calls).toEqual([]);
    expect(net.calls).toEqual([]);
    const { data } = await sb.from('voice_usage').select('count').eq('user_id', u.id);
    expect(data).toEqual([]);
  });
});

describe.skipIf(!ready)('/start', () => {
  it('новый человек: заводим пользователя, теперь ему можно писать; приветствие с кнопкой', async () => {
    const id = newId();
    await say(id, '/start', { last_name: 'Л', username: `u${id}` });
    const { data } = await sb.from('users').select('first_name, last_name, username, bot_chat_ok').eq('id', id).single();
    expect(data).toEqual({ first_name: 'Даша', last_name: 'Л', username: `u${id}`, bot_chat_ok: true });
    const [msg] = replies(id);
    expect(textOf(msg)).toMatch(/^Привет, Даша! 🌱/);
    // Текст — нейтральный (03.10.2026): без «как в GitHub», «даже чуть-чуть» и «как зеленеет карта».
    expect(textOf(msg)).toContain('привычки, цели и дела на каждый день');
    expect(textOf(msg)).not.toMatch(/зеленеет|GitHub|понемногу|чуть-чуть/);
    expect(buttons(msg)).toEqual([{ text: 'Открыть LifeCommit', web_app: { url: APP } }]);
  });

  it('уже знакомый: включаем личку; язык приветствия — из Telegram', async () => {
    const u = await user({ name: 'Kate', lang: 'en' });
    expect((await sb.from('users').select('bot_chat_ok').eq('id', u.id).single()).data?.bot_chat_ok).toBe(false);
    await say(u.id, '/start', { first_name: 'Kate', language_code: 'en' });
    expect((await sb.from('users').select('bot_chat_ok').eq('id', u.id).single()).data?.bot_chat_ok).toBe(true);
    const [msg] = replies(u.id);
    expect(textOf(msg)).toMatch(/^Hi, Kate! 🌱/);
    expect(buttons(msg)[0]!.text).toBe('Open LifeCommit');
  });

  it('без имени в Telegram — пустое имя в базе', async () => {
    const id = newId();
    await say(id, '/start', { first_name: undefined });
    const { data } = await sb.from('users').select('first_name, last_name, username').eq('id', id).single();
    expect(data).toEqual({ first_name: '', last_name: null, username: null });
  });

  it('параметр-приглашение: ?ref= в кнопке; кривой параметр — просто приложение', async () => {
    const id = newId();
    await say(id, '/start friend_42');
    await say(id, '/start bad.param');
    // «g_» не по формату — обычная ссылка-приглашение
    await say(id, '/start g_AB');
    const urls = replies(id).map((m) => buttons(m)[0]!.web_app!.url);
    expect(urls).toEqual([`${APP}/?ref=friend_42`, APP, `${APP}/?ref=g_AB`]);
  });

  it('из чата группы (g_код): кнопка ведёт на «Вступить», текст по языку Telegram', async () => {
    const id = newId();
    await say(id, '/start g_abc123');
    await say(id, '/start g_abc123', { language_code: undefined });
    const [ru, en] = replies(id);
    expect(textOf(ru)).toBe('Откройте LifeCommit — и дела группы появятся у вас на «Сегодня».');
    expect(buttons(ru)).toEqual([{ text: 'Открыть LifeCommit', web_app: { url: `${APP}/?join=abc123` } }]);
    expect(textOf(en)).toBe("Open LifeCommit — the group's to-dos will show up on your Today.");
    expect(buttons(en)[0]!.text).toBe('Open LifeCommit');
  });

  it('связанный аккаунт отдельного пользователя не заводит', async () => {
    const main = await user();
    const alias = newId();
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', main.id);
    await say(alias, '/start');
    const { data } = await sb.from('users').select('id').eq('id', alias);
    expect(data).toEqual([]);
    expect(textOf(replies(alias)[0])).toMatch(/^Привет, Даша!/);
  });
});

describe.skipIf(!ready)('текст в личке', () => {
  it('не открывал приложение — просим сначала открыть', async () => {
    const id = newId();
    await say(id, 'читать каждый день');
    const [msg] = replies(id);
    expect(textOf(msg)).toBe('Сначала открой LifeCommit — и потом можно диктовать привычки голосом.');
    expect(buttons(msg)).toEqual([{ text: 'Открыть LifeCommit', web_app: { url: APP } }]);
    expect((await sb.from('users').select('id').eq('id', id)).data).toEqual([]);
    expect(net.calls).toEqual([]);
  });

  it('привычки и дела из Gemini — в базе; ответ со списком и «Отменить»', async () => {
    const u = await user();
    const day = moscowDay();
    gemini({
      habits: [
        habit('Читать', { kind: 'count', target: 20, unit: 'страниц' }),
        habit('Вода', { kind: 'count', target: 8 }),
        habit('Спортзал', { schedule: 'per_week', per_week: 3 }),
        habit('Не курить', { kind: 'abstain' }),
      ],
      todos: [todo('Позвонить маме'), todo('Купить молоко', addDays(day, 1))],
    });
    await say(u.id, 'хочу читать двадцать страниц, пить 8 стаканов, спортзал три раза в неделю, бросить курить; позвонить маме, завтра купить молоко');

    const prompt = net.calls.find((c) => c.url.startsWith(GEMINI))!.body;
    expect(prompt).toContain(`Today is ${day}`);
    const [msg] = replies(u.id);
    expect(textOf(msg)).toBe(
      ['Добавлено:', '• Позвонить маме — сегодня', '• Купить молоко — завтра', '• Читать — 20 страниц в день, каждый день', '• Вода — 8 в день, каждый день', '• Спортзал — 3 раза в неделю', '• Не курить — бросить'].join('\n'),
    );
    const { data: tasks } = await sb.from('tasks').select('id, title, kind, unit, schedule, per_week').eq('user_id', u.id).order('id');
    expect(tasks?.map(({ id: _, ...t }) => t)).toEqual([
      { title: 'Читать', kind: 'count', unit: 'страниц', schedule: 'daily', per_week: null },
      { title: 'Вода', kind: 'count', unit: null, schedule: 'daily', per_week: null },
      { title: 'Спортзал', kind: 'check', unit: null, schedule: 'per_week', per_week: 3 },
      { title: 'Не курить', kind: 'abstain', unit: null, schedule: 'daily', per_week: null },
    ]);
    const { data: todos } = await sb.from('todos').select('id, title, day').eq('user_id', u.id).order('id');
    expect(todos?.map((t) => [t.title, t.day])).toEqual([
      ['Позвонить маме', day],
      ['Купить молоко', addDays(day, 1)],
    ]);
    expect(buttons(msg)).toEqual([
      { text: 'Открыть LifeCommit', web_app: { url: APP } },
      { text: 'Отменить', callback_data: `undo:${tasks!.map((t) => t.id).join(',')}|${todos!.map((t) => t.id).join(',')}` },
    ]);
    // Попытка взята из дневного лимита.
    expect((await sb.from('voice_usage').select('count').eq('user_id', u.id).single()).data?.count).toBe(1);
  });

  it('расписание по дням и раз в неделю, дальние и прошедшие даты', async () => {
    const u = await user();
    const day = moscowDay();
    gemini({
      habits: [habit('Йога', { schedule: 'per_week', per_week: 1 }), habit('Бассейн', { schedule: 'per_week', per_week: 5 }), habit('Бег', { schedule: 'weekdays', weekdays: [1, 4] })],
      todos: [todo('Старое', '2020-01-01', { duration: 99_999 }), todo('К врачу', addDays(day, 10), { time: '9:05', duration: 45.4, location: ' Поликлиника ' })],
    });
    await say(u.id, 'йога раз в неделю, бассейн пять раз, бег по понедельникам и четвергам, к врачу через десять дней');
    const text = textOf(replies(u.id)[0]);
    expect(text).toContain('• Старое — сегодня');
    expect(text).toMatch(/^• К врачу — \d{1,2} [а-я]+$/m);
    expect(text).toContain('• Йога — 1 раз в неделю');
    expect(text).toContain('• Бассейн — 5 раз в неделю');
    expect(text).toContain('• Бег — пн, чт');
    const { data } = await sb.from('tasks').select('title, weekdays').eq('user_id', u.id).eq('schedule', 'weekdays');
    expect(data).toEqual([{ title: 'Бег', weekdays: 0b0001001 }]);
    // время, длительность и место дела — из разбора; невозможная длительность отброшена
    const { data: todos } = await sb.from('todos').select('title, day, time, duration_min, details').eq('user_id', u.id).order('id');
    expect(todos).toEqual([
      { title: 'Старое', day, time: null, duration_min: null, details: null },
      { title: 'К врачу', day: addDays(day, 10), time: '09:05:00', duration_min: 45, details: { location: 'Поликлиника' } },
    ]);
  });

  it('язык ответов — как в приложении: английский', async () => {
    const u = await user({ lang: 'en' });
    const day = moscowDay();
    gemini({
      habits: [
        habit('Read', { kind: 'count', target: 20, unit: 'pages' }),
        habit('Gym', { schedule: 'per_week', per_week: 1 }),
        habit('Swim', { schedule: 'per_week', per_week: 3 }),
        habit('Run', { schedule: 'weekdays', weekdays: [6, 7] }),
        habit('Sugar', { kind: 'abstain' }),
      ],
      todos: [todo('Call mom'), todo('Buy milk', addDays(day, 1)), todo('Dentist', addDays(day, 10))],
    });
    await say(u.id, 'read 20 pages a day, gym once a week, swim three times, run on weekends, quit sugar, call mom, buy milk tomorrow, dentist in ten days', { language_code: 'ru' });
    const [msg] = replies(u.id);
    const text = textOf(msg);
    expect(text.split('\n').slice(0, 3)).toEqual(['Added:', '• Call mom — today', '• Buy milk — tomorrow']);
    expect(text).toMatch(/^• Dentist — [A-Z][a-z]+ \d{1,2}$/m);
    expect(text).toContain('• Read — 20 pages a day, every day');
    expect(text).toContain('• Gym — 1 time a week');
    expect(text).toContain('• Swim — 3 times a week');
    expect(text).toContain('• Run — Sat, Sun');
    expect(text).toContain('• Sugar — quit');
    expect(buttons(msg).map((b) => b.text)).toEqual(['Open LifeCommit', 'Undo']);
  });

  it('Gemini упал или ответил пусто — разбирает Workers AI', async () => {
    const u = await user();
    net.on(GEMINI, () => new Response('overloaded', { status: 503 }));
    ai.parse = JSON.stringify({ habits: [habit('Читать')], todos: [] });
    await say(u.id, 'читать');
    net.on(GEMINI, () => Response.json({ candidates: [] }));
    ai.parse = JSON.stringify({ habits: [], todos: [todo('Позвонить')] });
    await say(u.id, 'позвонить');
    expect(ai.calls.filter((c) => c.model.includes('llama'))).toHaveLength(2);
    expect((await sb.from('tasks').select('title').eq('user_id', u.id)).data).toEqual([{ title: 'Читать' }]);
    expect((await sb.from('todos').select('title').eq('user_id', u.id)).data).toEqual([{ title: 'Позвонить' }]);
  });

  it('ничего не разобрали (мусор от модели) — подсказка, как сказать', async () => {
    const u = await user();
    net.on(GEMINI, () => new Response('nope', { status: 500 }));
    ai.parse = 'это не JSON';
    await say(u.id, 'привет');
    expect(textOf(replies(u.id)[0])).toBe('Не понял, что добавить. Скажи, например: «читать двадцать страниц каждый день, спортзал три раза в неделю, а завтра купить молоко».');
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('только дела — «Отменить» знает только дела', async () => {
    const u = await user();
    gemini({ habits: [], todos: [todo('Купить хлеб')] });
    await say(u.id, 'купить хлеб');
    const { data } = await sb.from('todos').select('id').eq('user_id', u.id).single();
    expect(buttons(replies(u.id)[0])[1]).toEqual({ text: 'Отменить', callback_data: `undo:|${data!.id}` });
  });

  it('много за раз: всё добавлено, а «Отменить» не влезает в 64 байта — кнопки нет', async () => {
    const u = await user();
    gemini({ habits: Array.from({ length: 8 }, (_, i) => habit(`Привычка ${i}`)), todos: Array.from({ length: 12 }, (_, i) => todo(`Дело ${i}`)) });
    await say(u.id, 'длинный список');
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toHaveLength(8);
    expect((await sb.from('todos').select('id').eq('user_id', u.id)).data).toHaveLength(12);
    expect(buttons(replies(u.id)[0])).toEqual([{ text: 'Открыть LifeCommit', web_app: { url: APP } }]);
  });

  it('дневной лимит (20 разборов, общий с мини-аппом): дальше — вежливый отказ, модель не зовём', async () => {
    const u = await user();
    await sb.from('voice_usage').upsert({ user_id: u.id, day: utcDay(), count: 20 });
    await say(u.id, 'читать каждый день');
    const [msg] = replies(u.id);
    expect(textOf(msg)).toBe('На сегодня хватит: разбираю до 20 сообщений в день. Завтра — снова можно, а пока привычки можно добавить в приложении.');
    expect(buttons(msg)).toEqual([{ text: 'Открыть LifeCommit', web_app: { url: APP } }]);
    expect(net.calls).toEqual([]);
    expect((await sb.from('voice_usage').select('count').eq('user_id', u.id).single()).data?.count).toBe(20);
  });

  it('лимит по-английски — для тех, у кого приложение на английском', async () => {
    const u = await user({ lang: 'en' });
    await sb.from('voice_usage').upsert({ user_id: u.id, day: utcDay(), count: 20 });
    await say(u.id, 'read every day');
    const [msg] = replies(u.id);
    expect(textOf(msg)).toBe("That's enough for today: I process up to 20 messages a day. Try again tomorrow, or add habits in the app.");
    expect(buttons(msg)[0]!.text).toBe('Open LifeCommit');
  });

  it('со связанного аккаунта — в того же пользователя', async () => {
    const main = await user();
    const alias = newId();
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', main.id);
    gemini({ habits: [habit('Читать')], todos: [] });
    await say(alias, 'читать');
    expect((await sb.from('tasks').select('title').eq('user_id', main.id)).data).toEqual([{ title: 'Читать' }]);
    expect(textOf(replies(alias)[0])).toBe('Добавлено:\n• Читать — каждый день');
  });
});

describe.skipIf(!ready)('голосовое в личке', () => {
  it('распознаём Whisper, разбираем, добавляем; в ответе — что расслышали', async () => {
    const u = await user();
    const day = moscowDay();
    ai.transcript = 'завтра купить молоко';
    gemini({ habits: [], todos: [todo('Купить молоко', addDays(day, 1))] });
    await voice(u.id, 4, 'voice-file-1');
    expect(tg.sent('sendChatAction')).toEqual([{ method: 'sendChatAction', body: { chat_id: u.id, action: 'typing' } }]);
    expect(tg.sent('getFile')[0]!.body).toEqual({ file_id: 'voice-file-1' });
    expect(ai.calls[0]!.model).toContain('whisper-large-v3-turbo');
    expect(net.calls.find((c) => c.url.startsWith(GEMINI))!.body).toContain('завтра купить молоко');
    expect(textOf(replies(u.id)[0])).toBe('Расслышал: «завтра купить молоко»\n\nДобавлено:\n• Купить молоко — завтра');
  });

  it('длиннее полутора минут — не распознаём и лимит не тратим', async () => {
    const u = await user();
    await voice(u.id, 91);
    expect(textOf(replies(u.id)[0])).toBe('Слишком длинное сообщение. Скажи покороче — до полутора минут.');
    expect(tg.sent('getFile')).toEqual([]);
    expect((await sb.from('voice_usage').select('count').eq('user_id', u.id)).data).toEqual([]);
  });

  it('тишина — модель не зовём, только подсказка', async () => {
    const u = await user();
    ai.transcript = '';
    await voice(u.id, 3);
    expect(textOf(replies(u.id)[0])).toMatch(/^Не понял, что добавить/);
    expect(net.calls).toEqual([]);
  });

  it('расслышали, но добавлять нечего — показываем, что расслышали', async () => {
    const u = await user({ lang: 'en' });
    ai.transcript = 'hello there';
    gemini({ habits: [], todos: [] });
    await voice(u.id, 3);
    expect(textOf(replies(u.id)[0])).toBe('I heard: "hello there"\n\nI could not tell what to add. Try: "read twenty pages every day, gym three times a week, and tomorrow buy milk".');
  });

  it('Telegram не отдал файл — «не получилось», без падения', async () => {
    const u = await user();
    tg.reply('getFile', { ok: false, error_code: 400, description: 'Bad Request: invalid file_id' });
    await voice(u.id, 5);
    expect(textOf(replies(u.id)[0])).toBe('Не получилось разобрать сообщение. Попробуй ещё раз чуть позже.');
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toEqual([]);
  });
});

describe.skipIf(!ready)('«Отменить»', () => {
  it('удаляет только что созданные привычки и дела, сообщение меняется на «Отменено»', async () => {
    const u = await user();
    gemini({ habits: [habit('Читать')], todos: [todo('Купить хлеб')] });
    await say(u.id, 'читать и купить хлеб');
    const data = buttons(replies(u.id)[0])[1]!.callback_data!;
    tg.calls = [];
    const res = await press(u.id, data);
    expect(res.status).toBe(200);
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect((await sb.from('todos').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect(tg.sent('answerCallbackQuery')).toHaveLength(1);
    expect(tg.sent('editMessageText')[0]!.body).toEqual({ chat_id: u.id, message_id: 55, text: 'Отменено — всё это удалено.' });
  });

  it('чужие id в данных кнопки ничего не задевают', async () => {
    const owner = await user();
    const stranger = await user();
    const task = await owner.call('POST', '/tasks', { title: 'Моё', kind: 'check', target: 1 });
    const td = await owner.call('POST', '/todos', { title: 'Моё дело' });
    await press(stranger.id, `undo:${task.body.id}|${td.body.id}`);
    expect((await sb.from('tasks').select('title').eq('id', task.body.id)).data).toEqual([{ title: 'Моё' }]);
    expect((await sb.from('todos').select('title').eq('id', td.body.id)).data).toEqual([{ title: 'Моё дело' }]);
  });

  it('старые сообщения: только привычки, без «|»; по-английски', async () => {
    const u = await user({ lang: 'en' });
    const task = await u.call('POST', '/tasks', { title: 'Read', kind: 'check', target: 1 });
    await press(u.id, `undo:${task.body.id}`);
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect(tg.sent('editMessageText')[0]!.body.text).toBe('Undone — all of it was removed.');
  });

  it('со связанного аккаунта — удаляет у основного', async () => {
    const main = await user();
    const alias = newId();
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', main.id);
    const task = await main.call('POST', '/tasks', { title: 'Читать', kind: 'check', target: 1 });
    await press(alias, `undo:${task.body.id}|`);
    expect((await sb.from('tasks').select('id').eq('user_id', main.id)).data).toEqual([]);
  });

  it('незнакомый человек, мусор в данных, чужая кнопка, сообщение не пришло — только ответ на нажатие', async () => {
    const u = await user();
    const task = await u.call('POST', '/tasks', { title: 'Цело', kind: 'check', target: 1 });
    const stranger = newId();
    await press(stranger, `undo:${task.body.id}`, false);
    await press(u.id, 'undo:abc,-1,0|x,1.5', false);
    await press(u.id, 'something-else', false);
    await press(u.id, undefined, false);
    expect(tg.sent('answerCallbackQuery')).toHaveLength(4);
    expect(tg.sent('editMessageText')).toEqual([]);
    expect((await sb.from('tasks').select('title').eq('user_id', u.id)).data).toEqual([{ title: 'Цело' }]);
  });
});

describe.skipIf(!ready)('адреса разработки', () => {
  it('dev-voice: текст разбирается, «сегодня» можно задать', async () => {
    gemini({ habits: [habit('Читать', { kind: 'count', target: 20, unit: 'страниц' })], todos: [] });
    const res = await request('/bot/dev-voice?today=2026-01-07', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'читать 20 страниц' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: 'читать 20 страниц', by: 'gemini', todos: [], habits: [{ title: 'Читать', kind: 'count', target: 20, unit: 'страниц' }] });
    expect(typeof res.body.ms).toBe('number');
    expect(net.calls[0]!.body).toContain('Today is 2026-01-07, Wednesday.');
  });

  it('dev-voice: аудио распознаётся; ?parse=0 — без разбора', async () => {
    ai.transcript = 'бросить курить';
    // больше 32 КБ — base64 собирается кусками
    const audio = new Uint8Array(70_000).fill(7);
    const only = await request('/bot/dev-voice?parse=0', { method: 'POST', headers: { 'content-type': 'audio/ogg' }, body: audio });
    expect(only.body).toEqual({ text: 'бросить курить' });
    expect(net.calls).toEqual([]);
    gemini({ habits: [habit('Не курить', { kind: 'abstain' })], todos: [] });
    // без content-type — тоже аудио
    const full = await request('/bot/dev-voice', { method: 'POST', body: audio });
    expect(full.body).toMatchObject({ text: 'бросить курить', habits: [{ title: 'Не курить', kind: 'abstain' }] });
  });

  it('dev-voice: Whisper turbo упал — подхватывает старый Whisper; оба упали — 500', async () => {
    const models: string[] = [];
    const fallback = aiThat((model) => {
      models.push(model);
      if (model.includes('turbo')) throw new Error('Failed to decode audio file');
      return {};
    });
    // turbo ответил без текста — пустая фраза
    const silent = await requestAs({ AI: aiThat(() => ({})) }, '/bot/dev-voice?parse=0', { method: 'POST', body: new Uint8Array([1]) });
    expect(JSON.parse(silent.text)).toEqual({ text: '' });
    const ok = await requestAs({ AI: fallback }, '/bot/dev-voice?parse=0', { method: 'POST', body: new Uint8Array([1, 2, 3]) });
    expect(JSON.parse(ok.text)).toEqual({ text: '' });
    expect(models).toEqual(['@cf/openai/whisper-large-v3-turbo', '@cf/openai/whisper']);

    let tries = 0;
    const broken = aiThat(() => {
      tries++;
      throw new Error('AI down');
    });
    const failed = await requestAs({ AI: broken }, '/bot/dev-voice?parse=0', { method: 'POST', body: new Uint8Array([1]) });
    expect(failed.status).toBe(500);
    // turbo один раз, запасной — два
    expect(tries).toBe(3);
  });

  it('dev-voice без ключа Gemini — сразу Workers AI; ответ модели уже объектом', async () => {
    const parsedObject = aiThat((model) => (model.includes('llama') ? { response: { habits: [habit('Вода', { kind: 'count', target: 8, unit: 'стаканов' })], todos: [] } } : { text: '' }));
    const res = await requestAs({ GEMINI_API_KEY: undefined, AI: parsedObject }, '/bot/dev-voice', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'вода 8 стаканов' });
    expect(JSON.parse(res.text)).toMatchObject({ by: 'workers-ai', habits: [{ title: 'Вода', target: 8, unit: 'стаканов' }] });
    expect(net.calls).toEqual([]);
  });

  it('dev-group: разбор фразы в группе — участники и говорящий из адреса', async () => {
    gemini({ items: [{ title: 'Мыть посуду', mode: 'assign', people: ['Алёна'], rotate: false, repeat: 'daily', weekdays: [], day: null, time: null, duration: null, target: null, unit: null, currency: null }] });
    const res = await request(`/bot/dev-group?members=${encodeURIComponent('Даша,Алёна')}&speaker=${encodeURIComponent('Алёна')}&today=2026-10-02`, { method: 'POST', body: 'Алёна моет посуду каждый вечер' });
    expect(res.body).toEqual([expect.objectContaining({ title: 'Мыть посуду', mode: 'assign', assignees: [2], rrule: 'FREQ=DAILY', day: '2026-10-02' })]);
    expect(net.calls[0]!.body).toContain('Speaker: Алёна');
  });

  it('dev-group: ?raw=1 — сырой ответ модели; Gemini упал — Workers AI; по умолчанию говорит первый', async () => {
    net.on(GEMINI, () => new Response('', { status: 429 }));
    ai.parse = JSON.stringify({ items: [{ title: 'Ужин', mode: 'event' }] });
    const raw = await request('/bot/dev-group?raw=1', { method: 'POST', body: 'ужин в семь' });
    expect(raw.body).toEqual({ items: [{ title: 'Ужин', mode: 'event' }] });
    expect(net.calls[0]!.body).toContain('Speaker: Даша');
    const noKey = await requestAs({ GEMINI_API_KEY: undefined }, '/bot/dev-group?raw=1', { method: 'POST', body: 'ужин' });
    expect(JSON.parse(noKey.text)).toEqual({ items: [{ title: 'Ужин', mode: 'event' }] });
    expect(net.calls).toHaveLength(1);
  });

  it('без DEV_AUTH_BYPASS обоих адресов нет', async () => {
    const voiceRes = await requestAs({ DEV_AUTH_BYPASS: undefined }, '/bot/dev-voice', { method: 'POST', body: 'x' });
    const groupRes = await requestAs({ DEV_AUTH_BYPASS: undefined }, '/bot/dev-group', { method: 'POST', body: 'x' });
    expect([voiceRes, groupRes]).toEqual([
      { status: 404, text: 'not found' },
      { status: 404, text: 'not found' },
    ]);
  });
});
