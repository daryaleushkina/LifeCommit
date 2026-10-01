import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { api } from './api';
import { bot } from './bot';
import { syncDue } from './calsync';
import { sendReminders } from './cron';
import { db } from './env';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.route('/api', api);
app.route('/bot', bot);
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendReminders(env, env.APP_URL));
    // Календари Apple: забираем изменения у тех, кого дольше всех не обновляли.
    ctx.waitUntil(syncDue(env, db(env)).catch((e) => console.error('calendar cron failed', e)));
  },
} satisfies ExportedHandler<Env>;
