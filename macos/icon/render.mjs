// Значок приложения для Mac из аватарки бота (design/avatar, вариант 26F): мятная плитка со знаком 3×3 по сетке значков
// macOS — скруглённый квадрат 824 из 1024 с мягкой тенью. Запуск: node macos/icon/render.mjs → macos/icon/AppIcon.png
// (из него build.sh собирает AppIcon.icns).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const dir = new URL('.', import.meta.url).pathname;
const svg = readFileSync(new URL('../../design/avatar/lifecommit-avatar.svg', import.meta.url), 'utf8').replace('width="1024" height="1024"', 'width="824" height="824"');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<body style="margin:0;background:transparent">
  <div style="position:absolute;left:100px;top:92px;width:824px;height:824px;border-radius:185px;overflow:hidden;
    box-shadow:0 10px 24px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.12)">${svg}</div></body>`);
await page.screenshot({ path: `${dir}AppIcon.png`, omitBackground: true });
await browser.close();
