// Сайт lifecommit.app: лендинг и документы. Корень — мини-апп; человека из браузера (не из Telegram) встроенный
// скрипт отправляет на лендинг (src/site/route.ts). Здесь — как это видит человек: переадресация и её отсутствие
// в Telegram, тема по системе и переключатель, примеры групп, голос «себе и в группу», кнопки, документы, ширина
// экрана, доступность и эталон первого экрана. Тест идёт без Telegram-подмены: сайт — обычная страница.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page, tgTheme }) => {
  await page.emulateMedia({ colorScheme: tgTheme });
});

/** Ничего не шире экрана: страница не листается вбок. */
async function noSideScroll(page: Page) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(extra, 'страница шире экрана').toBeLessThanOrEqual(0);
}

test('браузер на корне без Telegram — лендинг на русском, кнопки под устройство', async ({ page, tgPlatform }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ru\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Привычки, дела, цели и календарь в одном месте');
  // на первом экране кнопок скачивания нет (решение владелицы 04.10): есть «Скачать» в шапке, кнопки — внизу
  await expect(page.locator('.hero').getByRole('link')).toHaveCount(0);
  const final = page.locator('#download');
  await expect(final.getByRole('link', { name: /Открыть в\s*Telegram/ })).toHaveAttribute('href', 'https://t.me/LifeCommit_bot');
  // на iPhone — App Store, на Android — Google Play; второй стор спрятан
  const mine = final.getByRole('link', { name: tgPlatform === 'ios' ? /App Store/ : /Google Play/ });
  const other = final.locator(tgPlatform === 'ios' ? '.store.play' : '.store.apple');
  await expect(mine).toBeVisible();
  await expect(other).toBeHidden();
  await noSideScroll(page);
});

test('метки рекламы переезжают с корня на лендинг', async ({ page }) => {
  await page.goto('/?utm_source=threads');
  await expect(page).toHaveURL(/\/ru\/\?utm_source=threads$/);
});

test.describe('английский браузер', () => {
  test.use({ locale: 'en-US' });
  test('корень ведёт на английский лендинг', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Habits, to-dos, goals and calendar in one place');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await noSideScroll(page);
  });
});

test.describe('в Telegram корень остаётся мини-аппом', () => {
  test('параметры запуска в «#»', async ({ page }) => {
    await page.goto('/#tgWebAppPlatform=ios&tgWebAppVersion=8.0');
    await page.waitForLoadState('load');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('мост Telegram (мобильные и десктоп)', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { TelegramWebviewProxy: unknown }).TelegramWebviewProxy = { postEvent: () => {} };
    });
    await page.goto('/');
    await page.waitForLoadState('load');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('после перезагрузки: параметры, сохранённые SDK', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('tapps/launchParams', '"tgWebAppPlatform=ios"'));
    await page.goto('/');
    await page.waitForLoadState('load');
    expect(new URL(page.url()).pathname).toBe('/');
  });
});

test('тема — по системе, переключатель её меняет и запоминает', async ({ page, tgTheme }) => {
  await page.goto('/ru/');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = 'rgb(10, 15, 12)';
  const light = 'rgb(246, 244, 238)';
  await expect.poll(bg).toBe(tgTheme === 'dark' ? dark : light);
  await page.locator('.site-top [data-theme-toggle]').click();
  await expect.poll(bg).toBe(tgTheme === 'dark' ? light : dark);
  await page.reload();
  await expect.poll(bg).toBe(tgTheme === 'dark' ? light : dark);
  // экраны в телефонах — в той же теме
  await expect(page.locator('#heroPh .app')).toHaveClass(tgTheme === 'dark' ? /^(?!.*\bdark\b)/ : /\bdark\b/);
});

test('голос: одна фраза — и себе, и в группу', async ({ page }) => {
  await page.goto('/ru/');
  const voice = page.locator('#voiceApp');
  await voice.scrollIntoViewIfNeeded();
  await expect(voice.locator('.v-title')).toHaveText('Нашлось 3');
  await expect(voice.locator('.vsec')).toHaveText(['В группу «Работа»', 'Себе']);
  await expect(voice.locator('.vrow b')).toHaveText(['Подготовить отчёт', 'Позвонить в банк', 'Пить воду']);
  await expect(page.locator('#voiceText')).toContainText('ответом в чате группы');
});

test.describe('с анимацией', () => {
  // по умолчанию тесты идут с «уменьшить движение», а там телефон не прилипает и всё сразу в конечном виде
  test.use({ reducedMotion: 'no-preference' });

test('голос на телефоне: экран прилипает под шапкой, шаги над ним идут вместе с ним', async ({ page }) => {
  await page.goto('/ru/');
  const ph = page.locator('#voicePh');
  const steps = ph.locator('.steps-m span');
  await expect(steps).toHaveText(['Слушаю', 'Разбираю', 'Нашлось 3']);
  // доводим телефон до места прилипания и листаем дальше — он остаётся на том же месте под шапкой
  const stuckAt = await ph.evaluate((el) => parseFloat(getComputedStyle(el).top));
  const box = await ph.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), box - stuckAt + 200);
  await expect.poll(() => ph.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(Math.round(stuckAt));
  await expect(page.locator('#voiceApp .v-title')).toHaveText('Слушаю');
  await expect(steps.nth(0)).toHaveClass(/\bon\b/);
  // целиком в экране: шаги над телефоном и низ телефона видны
  await expect(steps.nth(0)).toBeInViewport({ ratio: 1 });
  await expect(ph.locator('.phone')).toBeInViewport({ ratio: 1 });
  // долистали — разобрано, горит последний шаг, а телефон всё ещё на месте
  await page.evaluate((y) => window.scrollTo(0, y + window.innerHeight * 0.85), box - stuckAt);
  await expect(page.locator('#voiceApp .v-title')).toHaveText('Нашлось 3');
  await expect(steps.nth(2)).toHaveClass(/\bon\b/);
  await expect(steps.nth(0)).toHaveClass(/\bdone\b/);
  expect(Math.round(await ph.evaluate((el) => el.getBoundingClientRect().top))).toBe(Math.round(stuckAt));
  await noSideScroll(page);
});

test.describe('узкий телефон, английский', () => {
  test.use({ viewport: { width: 320, height: 820 } });
  test('прилипший телефон «Голоса» и шаги над ним не шире экрана', async ({ page }) => {
    await page.goto('/en/');
    const ph = page.locator('#voicePh');
    const stuckAt = await ph.evaluate((el) => parseFloat(getComputedStyle(el).top));
    const box = await ph.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y), box - stuckAt + 200);
    await expect.poll(() => ph.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(Math.round(stuckAt));
    // каждая пилюля шагов и телефон целиком по ширине внутри экрана с полями 16px
    const sides = await page.evaluate(() => [...document.querySelectorAll('#voicePh .steps-m span, #voicePh .phone')].map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
    for (const [l, r] of sides) {
      expect(l, 'левый край в поле экрана').toBeGreaterThanOrEqual(16);
      expect(r, 'правый край в поле экрана').toBeLessThanOrEqual(320 - 16);
    }
    await noSideScroll(page);
  });
});

test('«уменьшить движение» выключено — заголовки сцен выезжают и остаются целыми', async ({ page }) => {
  await page.goto('/ru/');
  const h2 = page.getByRole('heading', { name: 'Дела и календарь в одном списке' });
  await h2.scrollIntoViewIfNeeded();
  // после появления строки собраны обратно: заголовок — обычный текст, без обёрток анимации
  await expect(h2.locator('.ln')).toHaveCount(0);
  await expect(h2).toBeInViewport();
  await expect(page.locator('#calendar .copy p').first()).toHaveCSS('opacity', '1');
});
});

test('«Вместе»: примеры групп — работа, семья, друзья — и чат Telegram рядом', async ({ page }) => {
  await page.goto('/ru/');
  const tabs = page.getByRole('group', { name: 'Примеры групп' });
  await tabs.scrollIntoViewIfNeeded();
  const phone = page.locator('#groupApp');
  const chat = page.locator('#chat');
  await expect(tabs.getByRole('button', { name: 'Работа' })).toHaveAttribute('aria-pressed', 'true');
  await expect(phone.locator('h1')).toHaveText('Работа');
  await expect(chat).toContainText('Сегодня в «Работе»');
  await tabs.getByRole('button', { name: 'Семья' }).click();
  await expect(phone.locator('h1')).toHaveText('Семья');
  await expect(chat).toContainText('Сегодня в «Семье»');
  await expect(tabs.getByRole('button', { name: 'Семья' })).toHaveAttribute('aria-pressed', 'true');
  await tabs.getByRole('button', { name: 'Друзья' }).click();
  await expect(phone.locator('h1')).toHaveText('Поход');
  await expect(chat).toContainText('Сегодня в «Походе»');
  await expect(page.locator('.tg-note')).toContainText('в чате группы в Telegram');
  // на телефоне переключатель групп сразу над телефоном, а заметка про чат — под ним, после карточки чата;
  // меряем в конце страницы, где сдвиги появления (телефон и чат выезжают при прокрутке) уже доиграли
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const below = async (a: string, b: string) => page.evaluate(([a, b]) => document.querySelector(a)!.getBoundingClientRect().top >= document.querySelector(b)!.getBoundingClientRect().bottom, [a, b]);
  expect(await below('#togetherPh', '.gtabs'), 'телефон под переключателем групп').toBe(true);
  expect(await below('.tg-note', '#chat'), 'заметка про чат под карточкой чата').toBe(true);
  await noSideScroll(page);
});

test.describe('компьютер', () => {
  // правило владелицы 04.10: лендинг проверяется и на телефоне, и на компьютере
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('первый экран без кнопок, «Вместе»: телефон слева, текст и заметка про чат справа', async ({ page }) => {
    await page.goto('/ru/');
    await expect(page.locator('.hero').getByRole('link')).toHaveCount(0);
    await expect(page.locator('#heroPh .phone')).toBeInViewport();
    await page.locator('#together .gtabs').scrollIntoViewIfNeeded();
    const r = (sel: string) => page.locator(sel).evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
    const [phone, tabs, note] = [await r('#togetherPh .phone'), await r('#together .gtabs'), await r('.tg-note')];
    expect(note.left, 'заметка правее телефона').toBeGreaterThanOrEqual(phone.right);
    expect(note.top, 'заметка под переключателем групп').toBeGreaterThanOrEqual(tabs.bottom);
    await noSideScroll(page);
  });
});

test('кнопка стора пока никуда не ведёт, «Скачать» ведёт к кнопкам внизу', async ({ page, tgPlatform }) => {
  await page.goto('/ru/');
  const store = page.locator('#download').getByRole('link', { name: tgPlatform === 'ios' ? /App Store/ : /Google Play/ });
  await store.click();
  await expect(page).toHaveURL(/\/ru\/$/);
  await page.locator('.site-top').getByRole('link', { name: 'Скачать' }).click();
  await expect(page.getByRole('heading', { name: 'Скачайте LifeCommit' })).toBeInViewport();
});

test('документы из подвала на двух языках', async ({ page }) => {
  await page.goto('/ru/');
  const foot = page.locator('.site-foot');
  await foot.getByRole('link', { name: 'Политика конфиденциальности' }).click();
  await expect(page).toHaveURL(/\/ru\/privacy\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Политика конфиденциальности');
  await noSideScroll(page);
  await page.locator('.site-foot').getByRole('link', { name: 'Условия использования' }).click();
  await expect(page).toHaveURL(/\/ru\/terms\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Условия использования');
  await noSideScroll(page);
  await page.locator('.site-top .brand').click();
  await expect(page).toHaveURL(/\/ru\/$/);
  await page.locator('.site-foot').getByRole('link', { name: 'EN' }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  await page.locator('.site-foot').getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  await page.locator('.site-foot').getByRole('link', { name: 'Terms of use' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of use');
  await noSideScroll(page);
});

for (const path of ['/ru/', '/en/', '/ru/privacy/', '/ru/terms/', '/en/privacy/', '/en/terms/']) {
  test(`доступность: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // контраст считаем по ровному фону: поле клеток, зерно, виньетка и подложки под текстом на время проверки убраны
    await page.addStyleTag({ content: '#field, .grain, .vignette { display: none !important } .copy::before, .hero-text::before { display: none !important }' });
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const found = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} — ${n.any.map((a) => a.message).join('; ')}`).join(' | ')}`);
    expect(found, `нарушения доступности на ${path}`).toEqual([]);
  });
}

test('эталон первого экрана лендинга', async ({ page }) => {
  await page.goto('/ru/');
  await expect(page.locator('#heroPh .app .habit').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // поле клеток рисуется со случайными фазами — на снимке его нет, остальное сравнивается целиком
  await page.addStyleTag({ content: '#field { visibility: hidden !important }' });
  await expect(page).toHaveScreenshot('site-hero.png');
});
