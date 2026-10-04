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
  const hero = page.locator('.hero');
  await expect(hero.getByRole('link', { name: /Открыть в\s*Telegram/ })).toHaveAttribute('href', 'https://t.me/LifeCommit_bot');
  // на iPhone — App Store, на Android — Google Play; второй стор спрятан
  const mine = hero.getByRole('link', { name: tgPlatform === 'ios' ? /App Store/ : /Google Play/ });
  const other = hero.locator(tgPlatform === 'ios' ? '.store.play' : '.store.apple');
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
  await noSideScroll(page);
});

test('кнопка стора пока никуда не ведёт, «Скачать» ведёт к кнопкам внизу', async ({ page, tgPlatform }) => {
  await page.goto('/ru/');
  const store = page.locator('.hero').getByRole('link', { name: tgPlatform === 'ios' ? /App Store/ : /Google Play/ });
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
