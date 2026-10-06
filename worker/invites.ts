// Ссылки-приглашения для приложений (решение владелицы 05.10.2026): lifecommit.app/j/<код> — в группу, /f/<код> — в
// друзья. Android с приложением открывает их сам (App Link: assetlinks.json ниже); иначе — эта страница: «Открыть в
// приложении» (lifecommit://join/<код>, lifecommit://friend/<код>) и «Открыть в Telegram» (мини-апп,
// startapp=g_<код> / f_<код>). В базу страница не ходит: по ссылке без входа не узнать ни группу, ни кто зовёт —
// это покажет приложение, где человек вошёл. Код — только буквы, цифры, «-» и «_»: в адрес приложения и Telegram
// ничего другого не попадёт.
import { Hono } from 'hono';
import type { Env } from './env';
import { pickLang, type Lang } from './site';

export const invites = new Hono<{ Bindings: Env }>();

const CODE = /^[A-Za-z0-9_-]{4,64}$/;

/** Приложение для Android, которому сайт доверяет ссылки /j/ и /f/ (отпечаток ключа подписи — от Android-сборки). */
export const ANDROID_APP = {
  package: 'app.lifecommit',
  fingerprints: ['65:DA:AF:71:58:E8:3C:6C:99:43:EB:85:8C:00:AD:B8:C8:88:09:DC:95:55:76:78:68:37:43:14:CE:A2:FB:5B'],
};

type Kind = 'join' | 'friend';

const TEXT: Record<Lang, Record<Kind | 'missing', [string, string]> & { app: string; telegram: string; hint: string }> = {
  ru: {
    join: ['Приглашение в группу', 'Вас зовут в группу LifeCommit — общие дела, отметки и цели вместе.'],
    friend: ['Приглашение в друзья', 'Вас зовут в друзья в LifeCommit — будете видеть карты друг друга.'],
    missing: ['Ссылка не работает', 'Попросите прислать её ещё раз.'],
    app: 'Открыть в приложении',
    telegram: 'Открыть в Telegram',
    hint: 'Приложения нет — откройте в Telegram: там всё то же самое.',
  },
  en: {
    join: ['Group invitation', 'You’re invited to a LifeCommit group — shared to-dos, check-ins and goals together.'],
    friend: ['Friend invitation', 'You’re invited to be friends on LifeCommit — you’ll see each other’s maps.'],
    missing: ['This link doesn’t work', 'Ask for it to be sent again.'],
    app: 'Open in the app',
    telegram: 'Open in Telegram',
    hint: 'No app? Open it in Telegram — it’s all the same there.',
  },
};

function page(env: Env, lang: Lang, kind: Kind | 'missing', code?: string): Response {
  const t = TEXT[lang];
  const [title, body] = t[kind];
  const links =
    kind === 'missing' || !code
      ? ''
      : `<a class="primary" href="lifecommit://${kind}/${code}">${t.app}</a>` +
        `<a href="https://t.me/${env.BOT_USERNAME}?startapp=${kind === 'join' ? 'g' : 'f'}_${code}">${t.telegram}</a>` +
        `<small>${t.hint}</small>`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · LifeCommit</title>
<style>
:root{color-scheme:light dark;--bg:#F6F4EE;--card:#fff;--text:#1F2A1F;--muted:#5E665B;--accent:#237A46;--accent-text:#fff;--soft:#E6F2E9;--soft-text:#1B6139}
@media (prefers-color-scheme:dark){:root{--bg:#0F1511;--card:#1B211C;--text:#E8EEE6;--muted:#A3AD9F;--accent:#3FA968;--accent-text:#0E1A12;--soft:#1E3325;--soft-text:#8FD6A6}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;box-sizing:border-box}
main{max-width:380px;width:100%;background:var(--card);border-radius:24px;padding:32px 24px;text-align:center;display:flex;flex-direction:column;gap:12px}
h1{margin:0;font-size:22px;line-height:1.3}
p{margin:0 0 12px;color:var(--muted)}
a{display:block;padding:15px;border-radius:14px;background:var(--soft);color:var(--soft-text);text-decoration:none;font-weight:600}
a.primary{background:var(--accent);color:var(--accent-text)}
small{color:var(--muted);font-size:14px}
</style></head><body><main><h1>${title}</h1><p>${body}</p>${links}</main></body></html>`;
  return new Response(html, {
    status: kind === 'missing' ? 404 : 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-language': lang },
  });
}

for (const [prefix, kind] of [['j', 'join'], ['f', 'friend']] as const) {
  invites.get(`/${prefix}/:code{.+}`, (c) => {
    const lang = pickLang(c.req.header('cookie') ?? null, c.req.header('accept-language') ?? null);
    const code = c.req.param('code').replace(/\/$/, '');
    return CODE.test(code) ? page(c.env, lang, kind, code) : page(c.env, lang, 'missing');
  });
}

// Android проверяет это сам при установке приложения (autoVerify): JSON, без переадресаций.
invites.get('/.well-known/assetlinks.json', () =>
  Response.json(
    [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: ANDROID_APP.package, sha256_cert_fingerprints: ANDROID_APP.fingerprints } }],
    { headers: { 'cache-control': 'public, max-age=3600' } },
  ),
);
