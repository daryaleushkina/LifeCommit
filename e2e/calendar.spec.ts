// Календарь: «День / Месяц», дни вперёд-назад, дело на другой день, список листается.
import { expect, goTab, scrollsByFinger, swipeLeft, test } from './fixtures';

test('день и месяц, дело на завтра — добавить и удалить свайпом', async ({ app: page }) => {
  await goTab(page, 'Календарь');
  const mode = page.locator('.cal-mode');
  await mode.getByText('Месяц', { exact: true }).click();
  await expect(page.locator('.cal-grid')).toHaveClass(/month/);
  await mode.getByText('День', { exact: true }).click();
  await page.getByRole('button', { name: 'Следующий день' }).click();
  await page.getByRole('button', { name: /Дело на этот день/ }).click();
  await page.getByPlaceholder('Что сделать?').fill('Забрать посылку');
  await page.getByPlaceholder('Что сделать?').press('Enter');
  const r = page.locator('.todo-list li', { hasText: 'Забрать посылку' });
  await expect(r).toHaveCount(1);
  await expect(r).not.toHaveClass(/pending/);
  await swipeLeft(page, r.locator('.swipe-body'));
  await expect(r).toHaveCount(0);
  await expect(page.locator('.undo-toast')).toHaveCount(0, { timeout: 8_000 });
  await page.getByRole('button', { name: 'Предыдущий день' }).click();
});

test('длинный список дня листается', async ({ app: page, me, browserName }) => {
  for (let i = 1; i <= 14; i++) await me.api('POST', '/todos', { title: `Дело ${i}` });
  await page.reload();
  await goTab(page, 'Календарь');
  await expect(page.locator('.todo-list li', { hasText: 'Дело 14' })).toHaveCount(1);
  await scrollsByFinger(page, browserName);
});
