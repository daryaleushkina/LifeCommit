// Аватарка бота: SVG → PNG 1024 и 640 (Telegram показывает её кругом). Запуск: node design/avatar/render.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const dir = new URL('.', import.meta.url).pathname;
const svg = readFileSync(`${dir}lifecommit-avatar.svg`, 'utf8');
const sized = (s) => svg.replace('width="1024" height="1024"', `width="${s}" height="${s}"`);
const browser = await chromium.launch();
for (const size of [1024, 640]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${sized(size)}</body>`);
  await page.locator('svg').screenshot({ path: `${dir}lifecommit-avatar-${size}.png` });
  await page.close();
}
// Проверка глазами: кругом, как в списке чатов и в шапке, на светлом и тёмном.
if (process.argv[2]) {
  const page = await browser.newPage({ viewport: { width: 460, height: 170 } });
  const round = (s) => `<div style="width:${s}px;height:${s}px;border-radius:50%;overflow:hidden">${sized(s)}</div>`;
  await page.setContent(`<body style="margin:0;padding:20px;display:flex;gap:20px;align-items:center;background:#fff">${round(128)}${round(54)}${round(36)}
    <div style="padding:18px;background:#17212B;border-radius:12px;display:flex;gap:14px;align-items:center">${round(54)}${round(36)}</div></body>`);
  await page.screenshot({ path: process.argv[2] });
}
await browser.close();
