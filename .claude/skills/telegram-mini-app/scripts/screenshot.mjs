#!/usr/bin/env node
/**
 * Скриншоты мини-аппа вне Telegram: обе темы × нужные отступы, экран телефона.
 *
 * Работает только с dev-сервером (vite), в котором подключён assets/mockEnv.ts:
 * параметры ?tgTheme / ?tgInsets / ?tgPlatform читает именно он.
 *
 *   node .claude/skills/telegram-mini-app/scripts/screenshot.mjs \
 *     --url http://localhost:5173/ --out screenshots/tma \
 *     [--insets 59,34,46,0] [--platform ios] [--version 10.1] [--no-chrome]
 *
 * Playwright берётся из node_modules проекта (devDependency `playwright`).
 * Браузер — Chromium с мобильной эмуляцией: это проверка вёрстки и темы,
 * а не WebView Telegram. Итог всё равно смотрится на устройстве.
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173/' },
    out: { type: 'string', default: 'screenshots/tma' },
    insets: { type: 'string', default: '' },
    platform: { type: 'string', default: 'ios' },
    version: { type: 'string', default: '10.1' },
    'no-chrome': { type: 'boolean', default: false },
    width: { type: 'string', default: '390' },
    height: { type: 'string', default: '844' },
  },
});

// Playwright — из проекта, а не глобальный: версия браузера привязана к пакету
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

await mkdir(args.out, { recursive: true });
const browser = await chromium.launch();
const failures = [];

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: Number(args.width), height: Number(args.height) },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => failures.push(`${theme}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') failures.push(`${theme}: ${m.text()}`);
  });

  const url = new URL(args.url);
  url.searchParams.set('tgTheme', theme);
  url.searchParams.set('tgPlatform', args.platform);
  url.searchParams.set('tgVersion', args.version);
  if (args.insets) url.searchParams.set('tgInsets', args.insets);
  if (args['no-chrome']) url.searchParams.set('tgChrome', '0');

  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  // Ждём, пока SDK привяжет переменные темы: без них снимок покажет запасные цвета
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-bg-color') !== '',
    null,
    { timeout: 5000 },
  ).catch(() => failures.push(`${theme}: --tg-theme-bg-color не появилась — подмена не сработала?`));

  const file = join(args.out, `${theme}${args.insets ? '-insets' : ''}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log('снято:', file);
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error('Ошибки на странице:\n' + failures.join('\n'));
  process.exit(1);
}
