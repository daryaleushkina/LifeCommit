#!/usr/bin/env node
// Сквозная проверка мини-аппа на локальном стенде: проходит экраны и действия так, как их делает человек,
// и после каждого экрана проверяет вёрстку — нижняя панель поверх содержимого, ничего не уезжает вбок,
// последнее не прячется под панелью, список листается. В конце — сводка: что прошло, что упало, снимки упавшего.
//
// Нужны `pnpm db:start` и `pnpm dev`. Только localhost — в прод не ходит. Всё, что создаёт, помечает «e2e …»
// и удаляет за собой.
//   pnpm e2e                         — светлая тема
//   E2E_THEME=dark pnpm e2e          — тёмная
//   HEADED=1 pnpm e2e                — с окном браузера
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const BASE = process.env.E2E_URL ?? 'http://localhost:5173/';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(BASE)) {
  console.error(`e2e: только локальный стенд, а не ${BASE}`);
  process.exit(2);
}
const THEME = process.env.E2E_THEME ?? 'light';
const OUT = process.env.E2E_OUT ?? 'screenshots/e2e';
const TAG = `e2e ${Date.now().toString(36).slice(-4)}`;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: !process.env.HEADED });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);

const problems = []; // ошибки страницы и сервера, общие на прогон
page.on('pageerror', (e) => problems.push(`ошибка страницы: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
page.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && problems.push(`сервер ${r.status()}: ${r.request().method()} ${new URL(r.url()).pathname}`));

// Внешний сервис подменяем: картинка «Поделиться» уходит в Telegram от имени человека, а у подменённого
// пользователя чата с ботом нет.
await page.route('**/api/share', (r) => r.fulfill({ json: { url: 'https://example.com/e2e.jpg', file_id: 'e2e'.repeat(10) } }));

const results = [];
let current = '';
async function step(name, fn) {
  current = name;
  await reset();
  const before = problems.length;
  try {
    await fn();
    const fresh = problems.slice(before);
    results.push({ name, ok: fresh.length === 0, note: fresh.join('; ') });
  } catch (e) {
    const file = `${OUT}/fail-${results.length + 1}.png`;
    await page.screenshot({ path: file }).catch(() => {});
    results.push({ name, ok: false, note: `${String(e.message ?? e).split('\n')[0].slice(0, 220)} (${file})` });
  }
  process.stdout.write(`${results.at(-1).ok ? '✓' : '✗'} ${name}${results.at(-1).ok ? '' : ` — ${results.at(-1).note}`}\n`);
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ── помощники ──

const main = () => page.locator('main.app-shell');
const tab = (name) => page.locator('.tabbar button', { hasText: new RegExp(`^\\s*${name}\\s*$`) });
const wait = (ms) => page.waitForTimeout(ms);
const sheet = () => page.locator('.sheet');
// Шторку закрываем тапом мимо неё: Escape в подменённом Telegram — ещё и кнопка «Назад».
const closeSheet = async () => {
  for (let i = 0; i < 3 && (await page.locator('.sheet-backdrop').count()); i++) {
    // Справа сверху: слева сверху лежит «‹ Назад» подменённого Telegram.
    await page.locator('.sheet-backdrop').last().click({ position: { x: 330, y: 60 } });
    await wait(300);
  }
};
/** Перед каждым шагом — ни одной открытой шторки; не закрылась — заново открыть приложение. */
async function reset() {
  await closeSheet().catch(() => {});
  if (await page.locator('.sheet-backdrop').count()) await open().catch(() => {});
}
const back = async () => {
  // Кнопка «Назад» Telegram в подменённом окружении рисуется поверх страницы.
  const b = page.getByRole('button', { name: /Назад/ }).first();
  if (await b.count()) await b.click();
  await wait(400);
};
async function open() {
  await page.goto(`${BASE}?tgTheme=${THEME}&tgPlatform=ios&tgVersion=10.1`);
  await page.waitForSelector('.page-head h1, .pick, h1', { timeout: 30000 });
  await wait(600);
}
async function goTab(name) {
  if (!(await page.locator('.tabbar').count())) await open();
  await tab(name).click();
  await wait(700);
}
/** Кнопка в той же строке, что и текст (например, «Вернуть» у отложенной привычки). */
const rowButton = (text, button) =>
  page.locator(`xpath=//*[normalize-space(text())="${text}"]/ancestor::*[.//button[normalize-space()="${button}"]][1]//button[normalize-space()="${button}"]`).first();

/** Прокрутить к элементу так, чтобы он был посередине экрана, а не под нижней панелью. */
const center = (locator) => locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));

/** Смахнуть строку влево: dx < 0. */
async function swipe(locator, dx) {
  await center(locator);
  const b = await locator.boundingBox();
  const y = b.y + b.height / 2;
  const x0 = b.x + b.width - 30;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + (dx * i) / 12, y + i * 0.2);
  await page.mouse.up();
  await wait(350);
}

/** Вёрстка экрана: ничего не уезжает вбок, панель поверх содержимого, последнее видно над панелью, список листается. */
async function layout(name) {
  const r = await page.evaluate(() => {
    const m = document.querySelector('main.app-shell');
    const bar = document.querySelector('.tabbar');
    const out = { issues: [] };
    if (!m) return out;
    if (document.documentElement.scrollWidth > innerWidth + 1) out.issues.push(`страница шире экрана: ${document.documentElement.scrollWidth} > ${innerWidth}`);
    if (m.scrollWidth > m.clientWidth + 1) out.issues.push(`содержимое шире экрана: ${m.scrollWidth} > ${m.clientWidth}`);
    // Элементы, вылезающие за правый край экрана (кроме лент, которые листаются вбок).
    for (const el of m.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || el.closest('.year-map, .share-strip, .swipe, .swipe-card')) continue;
      if (rect.right > innerWidth + 2) {
        out.issues.push(`вылезает вправо: ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} (${Math.round(rect.right)} > ${innerWidth})`);
        break;
      }
    }
    // Прокрутка: если содержимое выше экрана — оно должно листаться.
    out.scrollable = m.scrollHeight > m.clientHeight + 4;
    if (out.scrollable) {
      const before = m.scrollTop;
      m.scrollTop = m.scrollHeight;
      out.scrolled = m.scrollTop !== before || before > 0;
      if (!out.scrolled) out.issues.push('содержимое выше экрана, но не листается');
    }
    if (bar) {
      const b = bar.getBoundingClientRect();
      // Поверх панели — только сама панель, при любой прокрутке: листаем экран и сеткой проверяем всю панель.
      const over = new Set();
      for (let y = 0; y <= m.scrollHeight; y += 60) {
        m.scrollTop = y;
        for (let x = b.left + 6; x < b.right; x += 24) {
          for (let yy = b.top + 4; yy < b.bottom; yy += 12) {
            const el = document.elementFromPoint(x, yy);
            if (el && !el.closest('.tabbar')) over.add(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
          }
        }
      }
      if (over.size) out.issues.push(`поверх панели: ${[...over].slice(0, 3).join(', ')}`);
      m.scrollTop = m.scrollHeight;
      // Последнее содержимое при прокрутке до конца видно над панелью.
      const kids = [...m.children].filter((c) => c.getBoundingClientRect().height > 0 && getComputedStyle(c).position !== 'fixed');
      const last = kids.at(-1);
      if (last && out.scrollable) {
        const lr = last.getBoundingClientRect();
        if (lr.bottom > b.top + 2) out.issues.push(`последнее (${last.tagName.toLowerCase()}.${String(last.className).split(' ')[0]}) прячется под панелью: ${Math.round(lr.bottom)} > ${Math.round(b.top)}`);
      }
    }
    m.scrollTop = 0;
    return out;
  });
  await page.screenshot({ path: `${OUT}/${name}.png` });
  expect(r.issues.length === 0, r.issues.join('; '));
}

// ── прогон ──

await step('Запуск: заставка и «Сегодня»', async () => {
  await open();
  const pick = page.getByRole('button', { name: 'Пропустить' });
  if (await pick.count()) await pick.click();
  await page.waitForSelector('.page-head h1');
  expect((await page.locator('.page-head h1').textContent()) === 'Сегодня', 'нет заголовка «Сегодня»');
  await layout('01-today');
});

// Дела
const todoTitle = `${TAG} купить хлеб`;
const todoRow = () => page.locator('.todo-list li', { hasText: todoTitle });
await step('Дела: добавить строкой «Дело на сегодня»', async () => {
  await page.getByRole('button', { name: 'Дело на сегодня' }).first().click();
  await page.getByPlaceholder('Что сделать?').fill(todoTitle);
  await page.keyboard.press('Enter');
  await wait(900);
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  expect(await todoRow().count(), 'дело не появилось');
});
await step('Дела: отметить и снять отметку', async () => {
  await todoRow().locator('.todo-check').click();
  await wait(600);
  expect(await todoRow().evaluate((li) => li.classList.contains('done')), 'не отметилось');
  await todoRow().locator('.todo-check').click();
  await wait(600);
  expect(!(await todoRow().evaluate((li) => li.classList.contains('done'))), 'отметка не снялась');
});
await step('Дела: «Все · Осталось» прячет и показывает сделанное', async () => {
  await todoRow().locator('.todo-check').click();
  await wait(500);
  await page.getByRole('button', { name: 'Осталось' }).click();
  await wait(300);
  expect((await todoRow().count()) === 0, 'сделанное не спряталось');
  await page.getByRole('button', { name: 'Все', exact: true }).first().click();
  await wait(300);
  expect(await todoRow().count(), 'сделанное не вернулось');
  await todoRow().locator('.todo-check').click();
  await wait(500);
});
await step('Дела: шторка — перенести на завтра и вернуть на сегодня', async () => {
  await todoRow().locator('.todo-main').click();
  await sheet().waitFor();
  await sheet().getByText('Завтра', { exact: true }).click();
  await sheet().getByRole('button', { name: 'Готово' }).click();
  await wait(900);
  await closeSheet();
  expect((await todoRow().count()) === 0, 'дело осталось на сегодня');
  await page.getByRole('button', { name: /Потом · / }).click();
  await sheet().waitFor();
  await sheet().getByText(todoTitle).click();
  await wait(400);
  await page.locator('.sheet').last().getByText('Сегодня', { exact: true }).click();
  await page.locator('.sheet').last().getByRole('button', { name: 'Готово' }).click();
  await wait(900);
  await closeSheet();
  await closeSheet();
  expect(await todoRow().count(), 'дело не вернулось на сегодня');
});
await step('Дела: свайп «Удалить» → «Вернуть»', async () => {
  await swipe(todoRow().locator('.swipe-body'), -320);
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await wait(400);
  expect(await todoRow().count(), 'после «Вернуть» дела нет');
});
await step('Дела: удалить свайпом насовсем', async () => {
  await swipe(todoRow().locator('.swipe-body'), -320);
  await wait(5600);
  await open();
  expect((await todoRow().count()) === 0, 'дело не удалилось');
});

/** Провести пальцем вверх по экрану и проверить, что список сдвинулся (если ему есть куда). */
async function fingerScroll(name) {
  const cdp = await ctx.newCDPSession(page);
  const [top0, room] = await page.evaluate(() => {
    const m = document.querySelector('main.app-shell');
    m.scrollTop = 0;
    return [0, m.scrollHeight - m.clientHeight];
  });
  if (room < 20) return;
  const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] });
  await touch('touchStart', 600);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', 600 - i * 25);
    await wait(16);
  }
  await touch('touchEnd');
  await wait(700);
  const after = await page.evaluate(() => document.querySelector('main.app-shell').scrollTop);
  expect(after > top0 + 20, `${name}: палец провёл, а список не сдвинулся (${top0} → ${after})`);
}
await step('«Сегодня» листается пальцем', async () => {
  await goTab('Сегодня');
  await fingerScroll('Сегодня');
});

// Привычки: три вида
const habits = { check: `${TAG} спортзал`, count: `${TAG} вода`, abstain: `${TAG} без сладкого` };
const intent = { check: 'Делать регулярно', count: 'Считать что-то', abstain: 'Бросить' };
const card = (title) => page.locator('.task', { hasText: title });
for (const kind of ['check', 'count', 'abstain']) {
  await step(`Привычки: создать «${intent[kind]}»`, async () => {
    await page.getByRole('button', { name: 'Добавить привычку' }).click();
    await page.getByRole('button', { name: new RegExp(intent[kind]) }).first().click();
    await wait(400);
    const name = page.locator('input').first();
    await name.fill(habits[kind]);
    if (kind === 'count') {
      const goal = page.locator('input[inputmode="numeric"]').first();
      if (await goal.count()) await goal.fill('5');
    }
    await page.getByRole('button', { name: /^(Добавить|Сохранить|Готово)$/ }).first().click();
    await page.waitForSelector('.page-head h1');
    await wait(600);
    expect(await card(habits[kind]).count(), 'привычка не появилась на «Сегодня»');
  });
}
await step('Привычки: «Делать регулярно» — отметить и снять', async () => {
  const b = card(habits.check).locator('button.rb.ok');
  await b.click();
  await wait(500);
  expect((await b.getAttribute('aria-pressed')) === 'true', 'не отметилось');
  await b.click();
  await wait(500);
  expect((await b.getAttribute('aria-pressed')) === 'false', 'не снялось');
});
await step('Привычки: «Считать» — ввести число карандашом и «сделано целиком»', async () => {
  const c = card(habits.count);
  await c.locator('button.rb.edit').click();
  await c.locator('input').fill('3');
  await c.locator('input').press('Enter');
  await wait(700);
  expect(/3\s*из\s*5/.test(await c.textContent()), `число не записалось: ${await c.textContent()}`);
  await c.locator('button.rb.ok').click();
  await wait(600);
  expect(/5\s*из\s*5/.test(await c.textContent()), 'не засчиталось целиком');
});
await step('Привычки: «Бросить» — ответить «получилось» и снять ответ', async () => {
  const c = card(habits.abstain);
  await c.getByRole('button', { name: 'Да, получилось' }).click();
  await wait(600);
  expect(/без этого/.test(await c.textContent()), `нет счёта дней: ${await c.textContent()}`);
  await c.getByRole('button', { name: 'Да, получилось' }).click();
  await wait(500);
});
await step('Привычки: экран привычки — статистика и отметка прошлого дня', async () => {
  await center(card(habits.check));
  await card(habits.check).locator('.task-main h2').click();
  await page.waitForSelector('.detail-head');
  await wait(500);
  const days = page.locator('.hcal-day:not([disabled])');
  if (await days.count()) {
    await days.first().click();
    await wait(300);
    if (await sheet().count()) {
      await sheet().getByRole('button', { name: 'Сделано', exact: true }).click();
      await wait(500);
      await closeSheet();
    }
  }
  await layout('02-habit-detail');
});
const openHabit = async (title) => {
  if (!(await page.locator('.detail-head').count())) {
    await goTab('Сегодня');
    await center(card(title));
    await card(title).locator('.task-main h2').click();
    await page.waitForSelector('.detail-head');
    await wait(400);
  }
};
await step('Привычки: «Поделиться» — картинки рисуются, тап выбирает соседнюю', async () => {
  await openHabit(habits.check);
  await page.getByRole('button', { name: 'Поделиться' }).click();
  await page.waitForSelector('canvas.share-card');
  await wait(900);
  const n = await page.locator('canvas.share-card').count();
  expect(n >= 2, `картинок ${n}`);
  const blank = await page.evaluate(() => [...document.querySelectorAll('canvas.share-card')].some((c) => c.width < 100));
  expect(!blank, 'пустая картинка');
  await page.locator('canvas.share-card').nth(1).click({ position: { x: 20, y: 100 }, force: true });
  await wait(700);
  expect(await page.locator('canvas.share-card').nth(1).evaluate((c) => c.classList.contains('on')), 'тап по соседней не выбрал её');
  await closeSheet();
});
await step('Привычки: редактор — переименовать', async () => {
  await openHabit(habits.check);
  await page.locator('.detail-head').getByRole('button').last().click();
  await wait(500);
  const name = page.locator('input').first();
  await name.fill(`${habits.check} 2`);
  await page.getByRole('button', { name: /^(Сохранить|Готово)$/ }).first().click();
  await wait(800);
  habits.check = `${habits.check} 2`;
  await back();
  await page.waitForSelector('.page-head h1').catch(() => {});
  if (!(await card(habits.check).count())) await goTab('Сегодня');
  expect(await card(habits.check).count(), 'новое название не видно на «Сегодня»');
});
await step('Привычки: «Отложить» и вернуть из «Отложенных»', async () => {
  await goTab('Сегодня');
  await center(card(habits.check));
  await card(habits.check).locator('.task-main h2').click();
  await page.locator('.detail-head').getByRole('button').last().click();
  await wait(400);
  await page.getByRole('button', { name: 'Отложить' }).click();
  await wait(900);
  await page.waitForSelector('.page-head h1').catch(() => {});
  if (!(await page.locator('.page-head h1', { hasText: 'Сегодня' }).count())) await goTab('Сегодня');
  expect((await card(habits.check).count()) === 0, 'отложенная осталась на «Сегодня»');
  await page.getByRole('button', { name: /Отложенные/ }).click();
  await wait(500);
  await rowButton(habits.check, 'Вернуть').click();
  await wait(800);
  await back();
  if (!(await page.locator('.page-head h1', { hasText: 'Сегодня' }).count())) await goTab('Сегодня');
  await wait(500);
  expect(await card(habits.check).count(), 'не вернулась на «Сегодня»');
});
await step('Привычки: свайп «Удалить» → «Вернуть»', async () => {
  await goTab('Сегодня');
  await swipe(page.locator('.swipe-card', { hasText: habits.count }).locator('.swipe-body'), -320);
  expect((await card(habits.count).count()) === 0, 'не пропала после свайпа');
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await wait(400);
  expect(await card(habits.count).count(), 'не вернулась');
});

// Календарь
await step('Календарь: открывается, листается пальцем, вёрстка', async () => {
  await goTab('Календарь');
  await wait(800);
  await fingerScroll('Календарь');
  await layout('03-calendar');
});
await step('Календарь: «День / Месяц», дни вперёд-назад', async () => {
  const seg = page.locator('.cal-mode');
  if (await seg.count()) {
    await seg.getByRole('radio', { name: 'Месяц' }).or(seg.getByRole('button', { name: 'Месяц' })).first().click();
    await wait(500);
    await layout('04-calendar-month');
    await seg.getByRole('radio', { name: 'День' }).or(seg.getByRole('button', { name: 'День' })).first().click();
    await wait(500);
  }
  const next = page.getByRole('button', { name: 'Следующий день' });
  if (await next.count()) {
    await next.click();
    await wait(400);
    await page.getByRole('button', { name: 'Предыдущий день' }).click();
    await wait(400);
  }
});
const futureTitle = `${TAG} записаться к врачу`;
await step('Календарь: дело на завтра — добавить и удалить свайпом', async () => {
  await page.getByRole('button', { name: 'Следующий день' }).click();
  await wait(500);
  await page.getByRole('button', { name: /Дело на этот день/ }).first().click();
  await page.getByPlaceholder('Что сделать?').fill(futureTitle);
  await page.keyboard.press('Enter');
  await wait(900);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const row = page.locator('.todo-list li', { hasText: futureTitle });
  expect(await row.count(), 'дело на завтра не появилось');
  await swipe(row.locator('.swipe-body'), -320);
  await wait(5600);
  expect((await row.count()) === 0, 'не удалилось');
  await page.getByRole('button', { name: 'К сегодня' }).click().catch(() => {});
});

// Группы
const groupTitle = `${TAG} группа`;
await step('Вместе: список групп, вёрстка', async () => {
  await goTab('Вместе');
  await wait(600);
  await layout('05-groups');
});
await step('Вместе: новая группа', async () => {
  await page.getByRole('button', { name: 'Новая группа' }).click();
  await page.getByPlaceholder(/Как назовём/).fill(groupTitle);
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await wait(1200);
  expect(await page.getByText(groupTitle).count(), 'экран группы не открылся');
  await layout('06-group');
});
const gItem = `${TAG} вынести мусор`;
await step('Группа: добавить дело «кто-то один» и отметить', async () => {
  await page.getByRole('button', { name: /^\+?\s*Дело$/ }).first().click();
  await sheet().waitFor();
  await sheet().getByPlaceholder('Что сделать?').fill(gItem);
  await sheet().getByRole('button', { name: /^(Добавить|Сохранить)$/ }).click();
  await wait(1000);
  const row = page.locator('li', { hasText: gItem });
  expect(await row.count(), 'дело группы не появилось');
  await row.locator('.todo-check').first().click();
  await wait(700);
  expect(await row.evaluate((li) => li.classList.contains('done')), 'не отметилось');
});
await step('Группа: общая цель — завести и положить', async () => {
  await page.getByRole('button', { name: /^\+?\s*Дело$/ }).first().click();
  await sheet().waitFor();
  await sheet().getByText('Общая цель', { exact: true }).click();
  await sheet().getByPlaceholder(/отпуск/i).fill(`${TAG} на велосипед`);
  await sheet().getByPlaceholder('150 000').fill('1000');
  await sheet().getByRole('button', { name: /^(Добавить|Сохранить)$/ }).click();
  await wait(1000);
  const goal = page.locator('li, div', { hasText: `${TAG} на велосипед` }).last();
  expect(await goal.count(), 'цель не появилась');
  await page.locator('li.group-goal', { hasText: `${TAG} на велосипед` }).getByRole('button', { name: /Положить/ }).click();
  await wait(400);
  await page.locator('.sheet input').first().fill('250');
  await page.locator('.sheet').getByRole('button', { name: /Положить|Сохранить|Готово/ }).last().click();
  await wait(900);
  expect(/250/.test(await page.locator('li.group-goal', { hasText: `${TAG} на велосипед` }).textContent()), 'вклад не записался');
});
await step('Группа: удалить дело свайпом', async () => {
  const row = page.locator('li', { hasText: gItem });
  await swipe(row.locator('.swipe-body'), -320);
  await wait(5600);
  expect((await page.locator('li', { hasText: gItem }).count()) === 0, 'дело группы не удалилось');
});
await step('Группа: «Люди», настройки — переименовать и «только админы»', async () => {
  await page.getByRole('button', { name: 'Люди' }).click().catch(() => {});
  await wait(400);
  await page.getByRole('button', { name: 'Дела', exact: true }).click().catch(() => {});
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  await sheet().waitFor();
  await sheet().locator('input.sheet-input').fill(`${groupTitle} 2`);
  await sheet().locator('input.sheet-input').press('Enter');
  await wait(500);
  const toggle = sheet().locator('input.switch');
  if (await toggle.count()) {
    await toggle.click();
    await wait(300);
    await toggle.click();
  }
  expect(await sheet().getByRole('button', { name: 'Подключить чат Telegram' }).count(), 'у создателя нет «Подключить чат»');
  await closeSheet();
  await wait(500);
  expect(await page.getByText(`${groupTitle} 2`).count(), 'новое название не видно');
});
await step('Группа: удалить группу', async () => {
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  await sheet().getByRole('button', { name: 'Удалить группу' }).click();
  await wait(1200);
  if (!(await page.locator('.page-head h1', { hasText: 'Вместе' }).count())) await goTab('Вместе');
  expect((await page.getByText(`${groupTitle} 2`).count()) === 0, 'группа не удалилась');
});

// Профиль
await step('Я: месяц / год, листать месяцы, вёрстка', async () => {
  await goTab('Я');
  await wait(600);
  await layout('07-profile');
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
  await wait(200);
  await page.getByRole('button', { name: 'Следующий месяц' }).click();
  await page.getByRole('button', { name: 'Год', exact: true }).click();
  await wait(300);
  await layout('08-profile-year');
  await page.getByRole('button', { name: 'Месяц', exact: true }).click();
});
await step('Я: «Поделиться» — 4 картинки (месяц и год)', async () => {
  await page.getByRole('button', { name: 'Поделиться' }).click();
  await page.waitForSelector('canvas.share-card');
  await wait(800);
  expect((await page.locator('canvas.share-card').count()) === 4, `картинок ${await page.locator('canvas.share-card').count()}`);
  await closeSheet();
});
await step('Я: тема — тёмная и обратно', async () => {
  const dark = page.getByRole('button', { name: /Тёмная|тёмн/i }).first();
  const light = page.getByRole('button', { name: /Светлая|светл/i }).first();
  if (await dark.count()) {
    await dark.click();
    await wait(300);
    await layout('09-profile-dark');
    if (THEME === 'light' && (await light.count())) await light.click();
  }
});
await step('Я: напоминание и конец дня — шторки открываются', async () => {
  for (const label of ['Напоминание', 'День заканчивается']) {
    const row = page.getByRole('button', { name: new RegExp(label) }).first();
    if (!(await row.count())) continue;
    await row.click();
    await wait(300);
    expect(await sheet().count(), `«${label}»: шторка не открылась`);
    await closeSheet();
  }
});

// Голос
await step('Голос: кнопка микрофона открывает шторку', async () => {
  await page.locator('.tab-mic').click();
  await wait(800);
  expect(await sheet().count(), 'шторка голоса не открылась');
  await page.screenshot({ path: `${OUT}/10-voice.png` });
  await closeSheet();
  const cancel = page.getByRole('button', { name: 'Отмена' });
  if (await cancel.count()) await cancel.click();
});

// Уборка: всё с пометкой «e2e» (и от прошлых прогонов) — привычки на «Сегодня» и в «Отложенных», дела, группы.
await step('Уборка: удалить всё тестовое', async () => {
  await open();
  for (let guard = 0; guard < 20; guard++) {
    const c = page.locator('.task', { hasText: /e2e \w{4} / }).first();
    if (!(await c.count())) break;
    await center(c);
    // По названию: у «Считать» середина строки — это число, тап по нему открывает ввод, а не экран привычки.
    await c.locator('.task-main h2').click();
    await page.locator('.detail-head').getByRole('button').last().click();
    await wait(400);
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await wait(1000);
    await goTab('Сегодня');
  }
  const archived = page.getByRole('button', { name: /Отложенные/ });
  if (await archived.count()) {
    await archived.click();
    await wait(500);
    for (let guard = 0; guard < 20; guard++) {
      const t = page.getByText(/^e2e \w{4} /).first();
      if (!(await t.count())) break;
      await rowButton((await t.textContent()).trim(), 'Удалить').click();
      await wait(900);
    }
    await back();
  }
  await goTab('Вместе');
  for (let guard = 0; guard < 10; guard++) {
    const g = page.getByText(/^e2e \w{4} группа/).first();
    if (!(await g.count())) break;
    await g.click();
    await wait(800);
    await page.getByRole('button', { name: 'Настройки группы' }).click();
    await sheet().getByRole('button', { name: 'Удалить группу' }).click();
    await wait(1200);
    await goTab('Вместе');
  }
  await open();
  const left = await page.locator('.task, .todo-list li', { hasText: /e2e \w{4} / }).count();
  expect(left === 0, `осталось тестового на «Сегодня»: ${left}`);
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} из ${results.length} прошло (${THEME}). Снимки: ${OUT}/`);
if (failed.length) {
  console.log('\nУпало:');
  for (const f of failed) console.log(`✗ ${f.name}\n    ${f.note}`);
}
process.exit(failed.length ? 1 : 0);
