import { Hono } from 'hono';
import type { TaskInput, TodoInput } from '../shared/types';
import { FREE_TASK_LIMIT, MAX_VOICE_SECONDS, VOICE_DAILY_LIMIT } from '../shared/types';
import { countActive, insertTasks, insertTodos, isPremium, takeVoiceQuota, today, USER_COLS, type UserRow } from './api';
import { addDays } from './day';
import { byTelegram, db, tg, type Env } from './env';
import { parseHabits, transcribe } from './voice';

interface TgFrom {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
}

interface Update {
  message?: {
    chat: { id: number; type: string };
    from?: TgFrom;
    text?: string;
    voice?: { file_id: string; duration: number };
  };
  callback_query?: {
    id: string;
    from: TgFrom;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

export const bot = new Hono<{ Bindings: Env }>();

const texts = {
  ru: {
    welcome: (name: string) =>
      `Привет, ${name}! 🌱\n\nLifeCommit — отмечай свои привычки, даже понемногу, и смотри, как зеленеет твоя карта. Скоро — вместе с друзьями.\n\nНажми кнопку, чтобы начать.`,
    open: 'Открыть LifeCommit',
    openFirst: 'Сначала открой LifeCommit — и потом можно диктовать привычки голосом.',
    tooLong: 'Слишком длинное сообщение. Скажи покороче — до полутора минут.',
    heard: (text: string) => `Расслышал: «${text}»`,
    nothing: 'Не понял, что добавить. Скажи, например: «читать двадцать страниц каждый день, спортзал три раза в неделю, а завтра купить молоко».',
    added: 'Добавлено:',
    skipped: (n: number) => `Не поместились (бесплатно — до ${n} привычек):`,
    undo: 'Отменить',
    undone: 'Отменено — всё это удалено.',
    today: 'сегодня',
    tomorrow: 'завтра',
    locale: 'ru-RU',
    failed: 'Не получилось разобрать сообщение. Попробуй ещё раз чуть позже.',
    limit: (n: number) => `На сегодня хватит: разбираю до ${n} сообщений в день. Завтра — снова можно, а пока привычки можно добавить в приложении.`,
    daily: 'каждый день',
    perWeek: (n: number) => `${n} ${n === 1 ? 'раз' : n < 5 ? 'раза' : 'раз'} в неделю`,
    days: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
    perDay: 'в день',
    quit: 'бросить',
  },
  en: {
    welcome: (name: string) =>
      `Hi, ${name}! 🌱\n\nLifeCommit — log your daily habits, even a little, and watch your map turn green. Friends are coming soon.\n\nTap the button to start.`,
    open: 'Open LifeCommit',
    openFirst: 'Open LifeCommit first — then you can dictate habits by voice.',
    tooLong: 'That message is too long. Keep it under a minute and a half.',
    heard: (text: string) => `I heard: "${text}"`,
    nothing: 'I could not tell what to add. Try: "read twenty pages every day, gym three times a week, and tomorrow buy milk".',
    added: 'Added:',
    skipped: (n: number) => `Did not fit (free plan: up to ${n} habits):`,
    undo: 'Undo',
    undone: 'Undone — all of it was removed.',
    today: 'today',
    tomorrow: 'tomorrow',
    locale: 'en-US',
    failed: 'Could not process the message. Please try again a bit later.',
    limit: (n: number) => `That's enough for today: I process up to ${n} messages a day. Try again tomorrow, or add habits in the app.`,
    daily: 'every day',
    perWeek: (n: number) => `${n} ${n === 1 ? 'time' : 'times'} a week`,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    perDay: 'a day',
    quit: 'quit',
  },
};

type Texts = typeof texts.ru;

/** Строка о привычке для ответа бота: «Читать — 20 страниц в день, каждый день». */
function describe(h: TaskInput, t: Texts): string {
  if (h.kind === 'abstain') return `• ${h.title} — ${t.quit}`;
  const when =
    h.schedule === 'per_week'
      ? t.perWeek(h.per_week ?? 3)
      : h.schedule === 'weekdays'
        ? t.days.filter((_, i) => ((h.weekdays ?? 127) & (1 << i)) !== 0).join(', ')
        : t.daily;
  const amount = h.kind === 'count' ? `${h.target}${h.unit ? ` ${h.unit}` : ''} ${t.perDay}, ` : '';
  return `• ${h.title} — ${amount}${when}`;
}

/** Строка о деле: «Купить молоко — завтра». */
function describeTodo(d: TodoInput, day: string, t: Texts): string {
  const when = !d.day || d.day <= day ? t.today : d.day === addDays(day, 1) ? t.tomorrow : new Date(`${d.day}T12:00:00Z`).toLocaleDateString(t.locale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `• ${d.title} — ${when}`;
}

const lang = (code?: string) => (code?.startsWith('ru') ? texts.ru : texts.en);

bot.post('/webhook', async (c) => {
  if (c.req.header('x-telegram-bot-api-secret-token') !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text('forbidden', 403);
  }
  const update = await c.req.json<Update>();
  const appUrl = new URL(c.req.url).origin;
  // Отвечаем Telegram сразу, работу доделываем в фоне: иначе при таймауте он повторит апдейт.
  c.executionCtx.waitUntil(handle(c.env, update, appUrl).catch((e) => console.error('bot update failed', e)));
  return c.text('ok');
});

async function handle(env: Env, update: Update, appUrl: string): Promise<void> {
  if (update.callback_query) return undo(env, update.callback_query);
  const msg = update.message;
  if (!msg?.from || msg.from.is_bot) return;
  const t = lang(msg.from.language_code);
  const sb = db(env);

  if (msg.chat.type === 'private' && msg.text?.startsWith('/start')) {
    // Человек сам написал боту — теперь ему можно присылать напоминания.
    // Связанный аккаунт (другой Telegram того же человека) отдельного пользователя не заводит.
    const { data: linked } = await sb.from('users').select('id').contains('telegram_aliases', [msg.from.id]).limit(1).maybeSingle<{ id: number }>();
    if (!linked) await sb.from('users').upsert(
      {
        id: msg.from.id,
        first_name: msg.from.first_name ?? '',
        last_name: msg.from.last_name ?? null,
        username: msg.from.username ?? null,
        bot_chat_ok: true,
      },
      { onConflict: 'id' },
    );
    const param = msg.text.split(' ')[1];
    const url = param && /^[\w-]{1,64}$/.test(param) ? `${appUrl}/?ref=${param}` : appUrl;
    await tg(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: t.welcome(msg.from.first_name),
      reply_markup: { inline_keyboard: [[{ text: t.open, web_app: { url } }]] },
    });
    return;
  }

  // Голосовое или обычный текст в личке — список привычек, которые человек хочет завести.
  if (msg.chat.type !== 'private') return;
  if (!msg.voice && (!msg.text || msg.text.startsWith('/'))) return;
  const chat = msg.chat.id;
  const say = (text: string, extra: object = {}) => tg(env, 'sendMessage', { chat_id: chat, text, ...extra });

  const { data: user } = await sb.from('users').select(USER_COLS).or(byTelegram(msg.from.id)).limit(1).maybeSingle<UserRow>();
  if (!user) {
    await say(t.openFirst, { reply_markup: { inline_keyboard: [[{ text: t.open, web_app: { url: appUrl } }]] } });
    return;
  }
  // Язык ответов — как в приложении, а не как в Telegram.
  const tt = user.language_code === 'en' ? texts.en : texts.ru;

  try {
    let text = msg.text ?? '';
    if (msg.voice && msg.voice.duration > MAX_VOICE_SECONDS) {
      await say(tt.tooLong);
      return;
    }
    // Лимит общий с голосом в мини-аппе.
    if (!(await takeVoiceQuota(sb, user.id))) {
      await say(tt.limit(VOICE_DAILY_LIMIT), { reply_markup: { inline_keyboard: [[{ text: tt.open, web_app: { url: appUrl } }]] } });
      return;
    }
    if (msg.voice) {
      await tg(env, 'sendChatAction', { chat_id: chat, action: 'typing' });
      const file = await tg<{ file_path: string }>(env, 'getFile', { file_id: msg.voice.file_id });
      const audio = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
      text = await transcribe(env, await audio.arrayBuffer(), user.language_code === 'en' ? 'en' : 'ru');
    }
    const day = today(user);
    const { habits, todos } = text ? await parseHabits(env, text, day) : { habits: [], todos: [] };
    if (habits.length === 0 && todos.length === 0) {
      await say([msg.voice && text ? tt.heard(text) : '', tt.nothing].filter(Boolean).join('\n\n'));
      return;
    }

    // Бесплатно — до пяти привычек: добавляем, сколько помещается, об остальных говорим прямо.
    const room = FREE_TASK_LIMIT === null || isPremium(user) ? habits.length : Math.max(0, FREE_TASK_LIMIT - (await countActive(sb, user)));
    const fit = habits.slice(0, room);
    const rest = habits.slice(room);
    const ids = fit.length ? await insertTasks(sb, user, fit) : [];
    const todoIds = todos.length ? await insertTodos(sb, user, todos) : [];

    const added = [...todos.map((d) => describeTodo(d, day, tt)), ...fit.map((h) => describe(h, tt))];
    const lines = [
      msg.voice ? tt.heard(text) : '',
      added.length ? `${tt.added}\n${added.join('\n')}` : '',
      rest.length ? `${tt.skipped(FREE_TASK_LIMIT ?? 0)}\n${rest.map((h) => describe(h, tt)).join('\n')}` : '',
    ].filter(Boolean);
    // «Отменить» знает, что удалить: привычки | дела. Telegram даёт кнопке не больше 64 байт — длиннее без неё.
    const undoData = `undo:${ids.join(',')}|${todoIds.join(',')}`;
    const canUndo = (ids.length || todoIds.length) && new TextEncoder().encode(undoData).length <= 64;
    const buttons = [{ text: tt.open, web_app: { url: appUrl } }, ...(canUndo ? [{ text: tt.undo, callback_data: undoData }] : [])];
    await say(lines.join('\n\n'), { reply_markup: { inline_keyboard: [buttons] } });
  } catch (e) {
    console.error('voice habits failed', e);
    await say(tt.failed);
  }
}

/** «Отменить» под ответом бота: удалить привычки и дела, которые он только что создал. */
async function undo(env: Env, q: NonNullable<Update['callback_query']>): Promise<void> {
  // «undo:привычки|дела»; у старых сообщений — только привычки, без «|».
  const [habitPart = '', todoPart = ''] = q.data?.startsWith('undo:') ? q.data.slice(5).split('|') : [];
  const idList = (part: string) => part.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const ids = idList(habitPart);
  const todoIds = idList(todoPart);
  const sb = db(env);
  const { data: user } = await sb.from('users').select('id, language_code').or(byTelegram(q.from.id)).limit(1).maybeSingle<{ id: number; language_code: string }>();
  const t = user?.language_code === 'en' ? texts.en : texts.ru;
  // Удаляем только свои: чужой id в данных кнопки ничего не заденет.
  const owner = user?.id ?? q.from.id;
  if (ids.length) await sb.from('tasks').delete().in('id', ids).eq('user_id', owner);
  if (todoIds.length) await sb.from('todos').delete().in('id', todoIds).eq('user_id', owner);
  await tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
  if (q.message) {
    await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: t.undone });
  }
}

// Только для локальной разработки: проверить распознавание и разбор без Telegram.
// POST /bot/dev-voice с аудио в теле → { text, habits }; с text/plain → { habits }. Ничего не создаёт.
bot.post('/dev-voice', async (c) => {
  if (c.env.DEV_AUTH_BYPASS !== '1') return c.text('not found', 404);
  const type = c.req.header('content-type') ?? '';
  const isText = type.startsWith('text/');
  const text = isText ? await c.req.text() : await transcribe(c.env, await c.req.arrayBuffer(), 'ru');
  // ?parse=0 — только распознавание: проверить Whisper, не тратя квоту разбора.
  if (c.req.query('parse') === '0') return c.json({ text });
  const started = Date.now();
  const parsed = await parseHabits(c.env, text, c.req.query('today') ?? new Date().toISOString().slice(0, 10));
  return c.json({ text, ...parsed, ms: Date.now() - started });
});

