// Каждый экран с одинаковыми данными: вёрстка (ничего не наезжает на нижнюю панель, не шире экрана, последнее
// видно, листается) и эталонный снимок. Новый экран или шторка — новая строка здесь.
import { checkScreen, expect, goTab, scrollsByFinger, test } from './fixtures';
import { seed } from './seed';

test.beforeEach(async ({ me }) => {
  await seed(me, { manyTodos: true });
});

test('«Сегодня»', async ({ app: page, browserName }) => {
  await page.reload();
  await expect(page.locator('.task')).toHaveCount(3);
  await checkScreen(page, 'today');
  // Палец — в конце: после броска список ещё катится и пружинит, снимок до него.
  await scrollsByFinger(page, browserName);
});

test('«Календарь»: день и месяц', async ({ app: page, browserName }) => {
  await goTab(page, 'Календарь');
  await expect(page.locator('.todo-list li', { hasText: 'Дело номер 12' })).toHaveCount(1);
  await checkScreen(page, 'calendar-day');
  await page.locator('.cal-mode').getByText('Месяц', { exact: true }).click();
  await checkScreen(page, 'calendar-month');
  await page.locator('.cal-mode').getByText('День', { exact: true }).click();
  await scrollsByFinger(page, browserName);
});

test('«Вместе» и экран группы', async ({ app: page }) => {
  await goTab(page, 'Вместе');
  await expect(page.getByText('Семья').first()).toBeVisible();
  await checkScreen(page, 'groups');
  await page.getByText('Семья').first().click();
  await expect(page.getByText('Вынести мусор')).toBeVisible();
  await checkScreen(page, 'group');
});

test('«Я»: месяц и год', async ({ app: page }) => {
  await goTab(page, 'Я');
  await checkScreen(page, 'profile-month');
  await page.getByRole('button', { name: 'Год', exact: true }).click();
  await checkScreen(page, 'profile-year');
});

test('экран привычки и шторка «Поделиться»', async ({ app: page }) => {
  await page.locator('.task', { hasText: 'Пить воду' }).locator('.task-main h2').click();
  await expect(page.locator('.detail-head')).toBeVisible();
  await checkScreen(page, 'habit-count');
  await page.getByRole('button', { name: 'Поделиться' }).click();
  await expect(page.locator('canvas.share-card')).toHaveCount(2);
  await expect(page).toHaveScreenshot('share-sheet.png', { mask: [page.locator('canvas.share-card')] });
});
