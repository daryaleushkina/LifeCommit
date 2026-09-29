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
    successful_payment?: { currency: string; total_amount: number; telegram_payment_charge_id: string; invoice_payload: string };
  };
  pre_checkout_query?: { id: string; from: TgFrom; currency: string; total_amount: number; invoice_payload: string };
}

export const bot = new Hono<{ Bindings: Env }>();

const texts = {
  ru: {
    welcome: (name: string) =>
      `Привет, ${name}! 🌱\n\nLifeCommit — ежедневные дела без стыда: отмечай, что успел, смотри, как зеленеет твоя карта, и делай вместе с друзьями.\n\nНажми кнопку, чтобы начать.`,
    open: 'Открыть LifeCommit',
    thanks: (n: number) => `Спасибо за ${n} ⭐! Это правда помогает 💚`,
  },
  en: {
    welcome: (name: string) =>
      `Hi, ${name}! 🌱\n\nLifeCommit is daily habits without shame: log what you did, watch your map turn green, and do it together with friends.\n\nTap the button to start.`,
    open: 'Open LifeCommit',
    thanks: (n: number) => `Thank you for ${n} ⭐! It really helps 💚`,
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
  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    const ok = q.currency === 'XTR' && q.invoice_payload.startsWith('donate:');
    await tg(env, 'answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok, error_message: ok ? undefined : 'Unknown invoice' });
    return;
  }

  const msg = update.message;
  if (!msg?.from || msg.from.is_bot) return;
  const t = lang(msg.from.language_code);
  const sb = db(env);

  if (msg.successful_payment) {
    const p = msg.successful_payment;
    await sb.from('donations').upsert(
      { user_id: msg.from.id, stars: p.total_amount, tg_payment_charge_id: p.telegram_payment_charge_id },
      { onConflict: 'tg_payment_charge_id', ignoreDuplicates: true },
    );
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: t.thanks(p.total_amount) });
    return;
  }

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
