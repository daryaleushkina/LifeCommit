import { Hono } from 'hono';
import type { TaskInput } from '../shared/types';
import { FREE_TASK_LIMIT } from '../shared/types';
import { countActive, insertTasks, isPremium, USER_COLS, type UserRow } from './api';
import { db, tg, type Env } from './env';
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

/** Голосовые длиннее не разбираем: это уже не список привычек, а бесплатный лимит распознавания общий. */
const MAX_VOICE_SECONDS = 90;

export const bot = new Hono<{ Bindings: Env }>();

const texts = {
  ru: {
    welcome: (name: string) =>
      `Привет, ${name}! 🌱\n\nLifeCommit — отмечай свои привычки, даже понемногу, и смотри, как зеленеет твоя карта. Скоро — вместе с друзьями.\n\nНажми кнопку, чтобы начать.`,
    open: 'Открыть LifeCommit',
    openFirst: 'Сначала открой LifeCommit — и потом можно диктовать привычки голосом.',
    tooLong: 'Слишком длинное сообщение. Скажи покороче — до полутора минут.',
    heard: (text: string) => `Расслышал: «${text}»`,
    nothing: 'Не понял, какие привычки добавить. Скажи, например: «читать двадцать страниц каждый день, спортзал три раза в неделю и бросить курить».',
    added: 'Добавлено:',
    skipped: (n: number) => `Не поместились (бесплатно — до ${n} привычек):`,
    undo: 'Отменить',
    undone: 'Отменено — эти привычки удалены.',
    failed: 'Не получилось разобрать сообщение. Попробуй ещё раз чуть позже.',
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
    nothing: 'I could not tell which habits to add. Try: "read twenty pages every day, gym three times a week and quit smoking".',
    added: 'Added:',
    skipped: (n: number) => `Did not fit (free plan: up to ${n} habits):`,
    undo: 'Undo',
    undone: 'Undone — these habits were removed.',
    failed: 'Could not process the message. Please try again a bit later.',
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
    await sb.from('users').upsert(
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

  const { data: user } = await sb.from('users').select(USER_COLS).eq('id', msg.from.id).maybeSingle<UserRow>();
  if (!user) {
    await say(t.openFirst, { reply_markup: { inline_keyboard: [[{ text: t.open, web_app: { url: appUrl } }]] } });
    return;
  }
  // Язык ответов — как в приложении, а не как в Telegram.
  const tt = user.language_code === 'en' ? texts.en : texts.ru;

  try {
    let text = msg.text ?? '';
    if (msg.voice) {
      if (msg.voice.duration > MAX_VOICE_SECONDS) {
        await say(tt.tooLong);
        return;
      }
      await tg(env, 'sendChatAction', { chat_id: chat, action: 'typing' });
      const file = await tg<{ file_path: string }>(env, 'getFile', { file_id: msg.voice.file_id });
      const audio = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
      text = await transcribe(env, await audio.arrayBuffer(), user.language_code === 'en' ? 'en' : 'ru');
    }
    const habits = text ? await parseHabits(env, text) : [];
    if (habits.length === 0) {
      await say([msg.voice && text ? tt.heard(text) : '', tt.nothing].filter(Boolean).join('\n\n'));
      return;
    }

    // Бесплатно — до пяти привычек: добавляем, сколько помещается, об остальных говорим прямо.
    const room = isPremium(user) ? habits.length : Math.max(0, FREE_TASK_LIMIT - (await countActive(sb, user)));
    const fit = habits.slice(0, room);
    const rest = habits.slice(room);
    const ids = fit.length ? await insertTasks(sb, user, fit) : [];

    const lines = [
      msg.voice ? tt.heard(text) : '',
      fit.length ? `${tt.added}\n${fit.map((h) => describe(h, tt)).join('\n')}` : '',
      rest.length ? `${tt.skipped(FREE_TASK_LIMIT)}\n${rest.map((h) => describe(h, tt)).join('\n')}` : '',
    ].filter(Boolean);
    const buttons = [{ text: tt.open, web_app: { url: appUrl } }, ...(ids.length ? [{ text: tt.undo, callback_data: `undo:${ids.join(',')}` }] : [])];
    await say(lines.join('\n\n'), { reply_markup: { inline_keyboard: [buttons] } });
  } catch (e) {
    console.error('voice habits failed', e);
    await say(tt.failed);
  }
}

/** «Отменить» под ответом бота: удалить привычки, которые он только что создал. */
async function undo(env: Env, q: NonNullable<Update['callback_query']>): Promise<void> {
  const ids = (q.data?.startsWith('undo:') ? q.data.slice(5).split(',') : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const sb = db(env);
  const { data: user } = await sb.from('users').select('language_code').eq('id', q.from.id).maybeSingle<{ language_code: string }>();
  const t = user?.language_code === 'en' ? texts.en : texts.ru;
  // Удаляем только свои: чужой id в данных кнопки ничего не заденет.
  if (ids.length) await sb.from('tasks').delete().in('id', ids).eq('user_id', q.from.id);
  await tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
  if (q.message) {
    await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: t.undone });
  }
}

// Только для локальной разработки: проверить распознавание и разбор без Telegram.
// POST /bot/dev-voice с аудио в теле → { text, habits }; с text/plain → { habits }. Ничего не создаёт.
bot.post('/dev-voice', async (c) => {
  if (c.env.DEV_AUTH_BYPASS !== '1') return c.text('not found', 404);
  const isText = (c.req.header('content-type') ?? '').startsWith('text/');
  const text = isText ? await c.req.text() : await transcribe(c.env, await c.req.arrayBuffer(), 'ru');
  return c.json({ text, habits: await parseHabits(c.env, text) });
});
