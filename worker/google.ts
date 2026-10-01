// Возврат из входа Google. Человек ушёл из Telegram в браузер (внутри Telegram вход Google не работает),
// дал доступ к календарю и попал сюда: меняем код на токены, сохраняем подключение и отправляем обратно
// в мини-апп — там шторка «Календари» покажет его календари с галочками.
import { Hono } from 'hono';
import { connectGoogle } from './calsync';
import { db, type Env } from './env';
import { GoogleError } from './gcal';
import { readState } from './secret';

export const google = new Hono<{ Bindings: Env }>();

const TEXT = {
  ru: {
    ok: ['Google Календарь подключён', 'Вернитесь в Telegram и выберите, какие календари забирать.'],
    again: ['Google Календарь снова подключён', 'Можно возвращаться в Telegram.'],
    denied: ['Доступ не дали', 'Без доступа к событиям календарь не подключить. Попробуйте ещё раз из LifeCommit и оставьте галочки на экране Google.'],
    expired: ['Ссылка устарела', 'Откройте LifeCommit и нажмите «Подключить» ещё раз.'],
    failed: ['Не получилось подключить', 'Google не ответил как надо. Попробуйте ещё раз чуть позже.'],
    back: 'Вернуться в LifeCommit',
  },
  en: {
    ok: ['Google Calendar connected', 'Go back to Telegram and choose which calendars to bring in.'],
    again: ['Google Calendar reconnected', 'You can go back to Telegram.'],
    denied: ['Access not granted', 'The calendar can’t be connected without access to events. Try again from LifeCommit and keep the boxes ticked on the Google screen.'],
    expired: ['This link has expired', 'Open LifeCommit and tap “Connect” again.'],
    failed: ['Couldn’t connect', 'Google didn’t respond as expected. Please try again a bit later.'],
    back: 'Back to LifeCommit',
  },
};

function page(env: Env, lang: 'ru' | 'en', kind: 'ok' | 'again' | 'denied' | 'expired' | 'failed', status = 200): Response {
  const t = TEXT[lang];
  const [title, body] = t[kind];
  const good = kind === 'ok' || kind === 'again';
  const back = `https://t.me/${env.BOT_USERNAME}?startapp=calendars`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
:root{color-scheme:light dark;--bg:#F4F2EE;--card:#fff;--text:#1C1B19;--muted:#6F6B64;--accent:#2E7D4F}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1F1E1C;--text:#F2F0EC;--muted:#A19C93;--accent:#5CC488}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;box-sizing:border-box}
main{max-width:360px;width:100%;background:var(--card);border-radius:24px;padding:32px 24px;text-align:center}
.mark{width:56px;height:56px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;font-size:28px;background:${good ? 'color-mix(in srgb,var(--accent) 16%,transparent)' : 'color-mix(in srgb,var(--muted) 16%,transparent)'};color:${good ? 'var(--accent)' : 'var(--muted)'}}
h1{margin:0 0 8px;font-size:21px;line-height:1.3}
p{margin:0 0 24px;color:var(--muted)}
a{display:block;padding:15px;border-radius:14px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
</style></head><body><main><div class="mark">${good ? '✓' : '!'}</div><h1>${title}</h1><p>${body}</p><a href="${back}">${t.back}</a></main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

google.get('/callback', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const userId = c.env.CALENDAR_KEY ? await readState(c.env.CALENDAR_KEY, q.get('state') ?? '') : null;
  const sb = db(c.env);
  const user = userId ? ((await sb.from('users').select('id, timezone, day_start_hour, language_code').eq('id', userId).maybeSingle()).data as { id: number; timezone: string; day_start_hour: number; language_code: string } | null) : null;
  const lang = user?.language_code === 'en' ? 'en' : 'ru';
  if (!user) return page(c.env, lang, 'expired', 400);
  const code = q.get('code');
  if (!code) return page(c.env, lang, 'denied');
  try {
    const { fresh } = await connectGoogle(c.env, sb, user, code, `${new URL(c.req.url).origin}/google/callback`);
    return page(c.env, lang, fresh ? 'ok' : 'again');
  } catch (e) {
    console.error('google connect failed', e);
    if (e instanceof GoogleError && e.message === 'scope_denied') return page(c.env, lang, 'denied');
    return page(c.env, lang, 'failed', 502);
  }
});
