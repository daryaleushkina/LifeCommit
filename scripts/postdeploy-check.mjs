#!/usr/bin/env node
// Проверка прода сразу после `wrangler deploy` (хук scripts/hooks/pre-push и GitHub Actions). Не прошла — вызывающий
// откатывает Worker на предыдущую версию. Только чтение и ни одного секрета: главная, один её скрипт, API без подписи
// Telegram, вебхук бота без секрета и страницы лендинга. В базу ничего не пишется.
//   node scripts/postdeploy-check.mjs          — адрес прода из APP_URL в wrangler.jsonc
//   POSTDEPLOY_URL=https://… node …            — другой адрес
// Если рядом есть свежая сборка (dist/client/index.html), прод должен отдавать именно её скрипт: новый Worker
// расходится по сети Cloudflare за секунды, поэтому проверка повторяется, пока не увидит новую версию.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Адрес прода: POSTDEPLOY_URL или APP_URL из wrangler.jsonc, без хвостового «/». */
export function prodUrl(env, wranglerText) {
  const raw = env.POSTDEPLOY_URL || /"APP_URL"\s*:\s*"([^"]+)"/.exec(wranglerText ?? '')?.[1];
  if (!raw) throw new Error('не знаю адрес прода: нет APP_URL в wrangler.jsonc и не задан POSTDEPLOY_URL');
  return raw.replace(/\/+$/, '');
}

/** Главный скрипт страницы (`/assets/…js`) — по нему видно, какая сборка отдаётся. */
export function mainScript(html) {
  return /<script[^>]*\ssrc="(\/assets\/[^"]+\.js)"/.exec(html)?.[1] ?? null;
}

/** Страницы сайта, которые должны отдаваться сами по себе (браузер с корня переадресуется на /ru/ или /en/). */
export const LANDING = ['/ru/', '/en/', '/ru/privacy/'];

/** Один проход проверок. Возвращает список того, что не так (пустой — всё хорошо). */
export async function checkOnce(base, fetchFn, expectedScript) {
  const problems = [];
  const get = async (what, path, init) => {
    try {
      return await fetchFn(base + path, { redirect: 'manual', ...init });
    } catch (e) {
      problems.push(`${what}: сеть — ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  // Главная: 200 и HTML со скриптом сборки (и той самой сборки, если её знаем).
  const home = await get('главная', '/');
  let script = null;
  if (home) {
    const type = home.headers.get('content-type') ?? '';
    const html = await home.text();
    script = mainScript(html);
    if (home.status !== 200) problems.push(`главная: ${home.status}, ждали 200`);
    else if (!type.includes('text/html')) problems.push(`главная: content-type «${type}», ждали text/html`);
    else if (!script) problems.push('главная: в HTML нет скрипта /assets/*.js');
    else if (expectedScript && script !== expectedScript) problems.push(`главная: отдаётся ${script}, а собрана ${expectedScript} — новая версия ещё не на проде`);
  }

  // Скрипт сборки: 200 и JavaScript (иначе SPA-заглушка отдала бы index.html вместо ассета).
  if (script) {
    const asset = await get('скрипт', script);
    if (asset) {
      const type = asset.headers.get('content-type') ?? '';
      if (asset.status !== 200) problems.push(`скрипт ${script}: ${asset.status}, ждали 200`);
      else if (!type.includes('javascript')) problems.push(`скрипт ${script}: content-type «${type}», ждали javascript`);
    }
  }

  // Лендинг и документы (site/): 200 и своя страница, а не мини-апп из SPA-заглушки (тогда в HTML нет шапки сайта).
  for (const path of LANDING) {
    const page = await get(`лендинг ${path}`, path);
    if (!page) continue;
    const html = await page.text();
    if (page.status !== 200) problems.push(`лендинг ${path}: ${page.status}, ждали 200`);
    else if (!html.includes('class="site-top"')) problems.push(`лендинг ${path}: отдаётся не страница сайта (нет шапки site-top)`);
  }

  // API без подписи Telegram — 401 (worker/auth.ts). 500 значит, что Worker падает раньше проверки.
  const me = await get('API', '/api/me');
  if (me && me.status !== 401) problems.push(`API без подписи: ${me.status}, ждали 401`);

  // Вебхук бота без секрета — 403 (worker/bot.ts). Тело пустое: до разбора апдейта дело не доходит.
  const hook = await get('вебхук', '/bot/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (hook && hook.status !== 403) problems.push(`вебхук без секрета: ${hook.status}, ждали 403`);

  return problems;
}

/** Повторять проход, пока не пройдёт или не кончатся попытки. */
export async function check({ base, fetchFn, expectedScript = null, tries = 6, pauseMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let problems = [];
  for (let attempt = 1; attempt <= tries; attempt++) {
    problems = await checkOnce(base, fetchFn, expectedScript);
    if (problems.length === 0) return { ok: true, attempts: attempt, problems };
    if (attempt < tries) await sleep(pauseMs);
  }
  return { ok: false, attempts: tries, problems };
}

// Запуск из командной строки (сеть и файлы) — проверяется прогоном против прода, а не unit-тестами.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = prodUrl(process.env, readFileSync('wrangler.jsonc', 'utf8'));
  const built = 'dist/client/index.html';
  const expectedScript = existsSync(built) ? mainScript(readFileSync(built, 'utf8')) : null;
  const res = await check({ base, fetchFn: fetch, expectedScript });
  if (res.ok) {
    console.error(`postdeploy: прод ${base} отвечает как надо (попыток: ${res.attempts}${expectedScript ? `, сборка ${expectedScript}` : ''})`);
  } else {
    console.error(`postdeploy: прод ${base} не прошёл проверку после ${res.attempts} попыток:`);
    for (const p of res.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}
