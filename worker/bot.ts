import { Hono } from 'hono';
import { db, tg, type Env } from './env';

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
  };
}

export const bot = new Hono<{ Bindings: Env }>();

const texts = {
  ru: {
    welcome: (name: string) =>
      `Привет, ${name}! 🌱\n\nLifeCommit — отмечай свои привычки, даже понемногу, и смотри, как зеленеет твоя карта. Скоро — вместе с друзьями.\n\nНажми кнопку, чтобы начать.`,
    open: 'Открыть LifeCommit',
  },
  en: {
    welcome: (name: string) =>
      `Hi, ${name}! 🌱\n\nLifeCommit — log your daily habits, even a little, and watch your map turn green. Friends are coming soon.\n\nTap the button to start.`,
    open: 'Open LifeCommit',
  },
};

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
  }
}
