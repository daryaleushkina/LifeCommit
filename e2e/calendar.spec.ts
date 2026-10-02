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

// 03.10.2026, iPhone: Telegram сообщил высоту больше видимой — низ списка уехал под нижнюю панель, а листать
// было нечего (содержимое помещалось в «высоту» Telegram). Последнее дело должно доезжать до места над панелью.
test.describe('Telegram сообщает высоту больше видимой', () => {
  test.use({ tgViewportExtra: 140 });
  test('последнее дело дня видно над нижней панелью', async ({ app: page, me }) => {
    for (let i = 1; i <= 9; i++) await me.api('POST', '/todos', { title: `Встреча ${i}` });
    await page.reload();
    await goTab(page, 'Календарь');
    const last = page.locator('.todo-list li', { hasText: 'Встреча 9' });
    await expect(last).toHaveCount(1);
    await page.evaluate(() => {
      const m = document.querySelector('main.app-shell')!;
      m.scrollTop = m.scrollHeight;
    });
    const [lastBottom, barTop, screen] = await page.evaluate(() => [
      document.querySelector('.todo-list li:last-child')!.getBoundingClientRect().bottom,
      document.querySelector('.tabbar')!.getBoundingClientRect().top,
      innerHeight,
    ]);
    expect(barTop, 'нижняя панель у нижнего края экрана').toBeLessThanOrEqual(screen);
    expect(lastBottom, 'последнее в списке — над нижней панелью').toBeLessThanOrEqual(barTop);
  });
});

// Временная панель замеров высоты (убрать вместе с ViewportDebug): пять тапов по заголовку.
test('пять тапов по заголовку показывают замеры высоты', async ({ app: page }) => {
  await goTab(page, 'Календарь');
  const title = page.locator('.page-head h1');
  for (let i = 0; i < 5; i++) await title.click();
  await expect(page.locator('.viewport-debug')).toContainText('tg height');
  await page.locator('.viewport-debug').click();
  await expect(page.locator('.viewport-debug')).toHaveCount(0);
});
