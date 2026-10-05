import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { api } from './api';
import { desktopLogin } from './desktop';
import { telegramLogin } from './telegramLogin';
import { bot } from './bot';
import { syncDue } from './calsync';
import { groupChatsTick } from './groupBot';
import { sendReminders } from './cron';
import { db } from './env';
import { feedbackCleanup } from './feedback';
import { feedbackTick } from './feedbackBot';
import { google } from './google';
import { shareFiles } from './share';
import { site } from './site';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

// Начать вход на компьютере и забрать ключ — без подписи Telegram, поэтому раньше /api (там проверка на всё).
app.route('/api/desktop', desktopLogin);
// Вход в нативные приложения через официальный вход Telegram — тоже без подписи initData.
app.route('/api/auth', telegramLogin);
app.route('/api', api);
app.route('/bot', bot);
app.route('/google', google);
// Картинки «Поделиться» по ссылке — для сторис Telegram и «Сохранить».
app.route('/share', shareFiles);
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
// Лендинг и документы без языка в адресе; мини-апп — статика /app/.
app.route('/', site);

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  // Тело запроса — не JSON (c.req.json() бросает SyntaxError): это ошибка запроса, а не сервера.
  if (err instanceof SyntaxError) return c.json({ error: 'bad_json' }, 400);
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    // Раз в 5 минут — только черновики жалоб /bug (10 минут тишины — жалоба уходит сама). Остальное рассчитано на 15.
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(feedbackTick(env).catch((e) => console.error('feedback drafts failed', e)));
      return;
    }
    ctx.waitUntil(sendReminders(env, env.APP_URL));
    // Жалобы: закрытые 14 дней назад и старше 60 дней — прочь вместе со скриншотами.
    ctx.waitUntil(feedbackCleanup(env).catch((e) => console.error('feedback cleanup failed', e)));
    // Чаты групп: утром — «Сегодня в группе», вечером — итог.
    ctx.waitUntil(groupChatsTick(env).catch((e) => console.error('group chats failed', e)));
    // Календари Apple и Google: забираем изменения у тех, кого дольше всех не обновляли.
    ctx.waitUntil(syncDue(env, db(env)).catch((e) => console.error('calendar cron failed', e)));
  },
} satisfies ExportedHandler<Env>;
