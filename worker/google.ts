// Возврат из входа Google. Человек ушёл из Telegram в браузер (внутри Telegram вход Google не работает), дал доступ к
// календарю и попал сюда: меняем код на токены, но календарь не подключаем — итог ждёт в google_pending под одноразовым
// кодом, а код уходит только туда, где дали согласие: кнопкой «Вернуться в LifeCommit» в мини-апп
// (t.me/…?startapp=gcal_<код>) или, если вход начали в приложении для iPhone, Android или Mac (state с меткой app),
// ссылкой lifecommit://calendars?status=ok&pending=<код> (docs/mobile.md). Подключает POST /api/calendars/google/finish
// тот же человек, что начал вход: state не привязан к браузеру (cookie из Telegram в браузер не переходят), и без этого
// шага чужая ссылка входа, подтверждённая жертвой, подключила бы её календарь к аккаунту автора ссылки
// (security-review 06.10.2026).
import { Hono } from 'hono';
import { exchangeGoogle } from './calsync';
import { randomToken, tokenHash } from './desktop';
import { db, type Env } from './env';
import { GoogleError } from './gcal';
import { verifyState } from './secret';

/** Сколько живёт ожидающее подключение: дольше — «ссылка устарела» (как state входа). */
export const GOOGLE_PENDING_TTL_MS = 15 * 60_000;

export const google = new Hono<{ Bindings: Env }>();

const TEXT = {
  ru: {
    ok: ['Почти готово', 'Нажмите «Вернуться в LifeCommit» — там подключение закончится и вы выберете, какие календари забирать.'],
    denied: ['Доступ не дали', 'Без доступа к событиям календарь не подключить. Попробуйте ещё раз из LifeCommit и оставьте галочки на экране Google.'],
    expired: ['Ссылка устарела', 'Откройте LifeCommit и нажмите «Подключить» ещё раз.'],
    failed: ['Не получилось подключить', 'Google не ответил как надо. Попробуйте ещё раз чуть позже.'],
    back: 'Вернуться в LifeCommit',
  },
  en: {
    ok: ['Almost done', 'Tap “Back to LifeCommit” to finish connecting and choose which calendars to bring in.'],
    denied: ['Access not granted', 'The calendar can’t be connected without access to events. Try again from LifeCommit and keep the boxes ticked on the Google screen.'],
    expired: ['This link has expired', 'Open LifeCommit and tap “Connect” again.'],
    failed: ['Couldn’t connect', 'Google didn’t respond as expected. Please try again a bit later.'],
    back: 'Back to LifeCommit',
  },
};

type Outcome = 'ok' | 'denied' | 'expired' | 'failed';

/** pending — код подключения: кнопка унесёт его в мини-апп (startapp=gcal_<код>), там подключение закончится. */
function page(env: Env, lang: 'ru' | 'en', kind: Outcome, status = 200, pending?: string): Response {
  const t = TEXT[lang];
  const [title, body] = t[kind];
  const good = kind === 'ok';
  const back = `https://t.me/${env.BOT_USERNAME}?startapp=${pending ? `gcal_${pending}` : 'calendars'}`;
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

/** Вход начали в приложении — возвращаем туда. Адрес постоянный: из запроса в него попадает только итог из списка и
 * наш же код подключения. */
const toApp = (outcome: Outcome, pending?: string): Response =>
  new Response(null, {
    status: 302,
    headers: { location: `lifecommit://calendars?status=${outcome}${pending ? `&pending=${pending}` : ''}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });

google.get('/callback', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const state = c.env.CALENDAR_KEY ? await verifyState(c.env.CALENDAR_KEY, q.get('state') ?? '') : null;
  if (!state) return page(c.env, 'ru', 'expired', 400);
  const sb = db(c.env);
  const found = await sb.from('users').select('id, language_code').eq('id', state.userId).maybeSingle();
  const user = found.data as { id: number; language_code: string } | null;
  const lang = user?.language_code === 'en' ? 'en' : 'ru';
  const reply = (outcome: Outcome, status = 200, pending?: string) => (state.app ? toApp(outcome, pending) : page(c.env, lang, outcome, status, pending));
  if (found.error) {
    console.error('google callback: user lookup failed', state.userId, found.error.message);
    return reply('failed', 502);
  }
  if (state.expired || !user) return reply('expired', 400);
  const code = q.get('code');
  if (!code) return reply('denied');
  try {
    const grant = await exchangeGoogle(c.env, code, `${new URL(c.req.url).origin}/google/callback`);
    // Отжившие ожидания — прочь; не вышло — не беда для этого входа, но в лог.
    const old = await sb.from('google_pending').delete().lt('created_at', new Date(Date.now() - GOOGLE_PENDING_TTL_MS).toISOString());
    if (old.error) console.error('google_pending cleanup failed', old.error.message);
    const pending = randomToken();
    const saved = await sb.from('google_pending').insert({ code_hash: await tokenHash(pending), user_id: user.id, secret: grant.secret, login: grant.login, calendars: grant.calendars });
    if (saved.error) {
      console.error('google callback: pending not saved', user.id, saved.error.message);
      return reply('failed', 502);
    }
    return reply('ok', 200, pending);
  } catch (e) {
    console.error('google connect failed', e);
    if (e instanceof GoogleError && e.message === 'scope_denied') return reply('denied');
    return reply('failed', 502);
  }
});
