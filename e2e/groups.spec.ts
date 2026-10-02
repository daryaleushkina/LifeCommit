// Группы: новая группа, дело «кто-то один», общая цель и вклад, удалить свайпом, настройки, удалить группу.
import { closeSheet, expect, goTab, swipeLeft, test } from './fixtures';

test('группа от создания до удаления', async ({ app: page }) => {
  await goTab(page, 'Вместе');
  await page.getByRole('button', { name: 'Новая группа' }).click();
  await page.getByPlaceholder(/Как назовём/).fill('Соседи');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByText('Соседи').first()).toBeVisible();

  // Дело «кто-то один» — отметить.
  await page.getByRole('button', { name: /^\+?\s*Дело$/ }).first().click();
  const sheet = page.locator('.sheet');
  await sheet.getByPlaceholder('Что сделать?').fill('Полить цветы');
  await sheet.getByRole('button', { name: /^(Добавить|Сохранить)$/ }).click();
  const item = page.locator('li', { hasText: 'Полить цветы' });
  await expect(item).toHaveCount(1);
  await item.locator('.todo-check').first().click();
  await expect(item).toHaveClass(/done/);

  // Общая цель — завести и положить.
  await page.getByRole('button', { name: /^\+?\s*Дело$/ }).first().click();
  await sheet.getByText('Общая цель', { exact: true }).click();
  await sheet.getByPlaceholder(/отпуск/i).fill('На велосипед');
  await sheet.getByPlaceholder('150 000').fill('1000');
  await sheet.getByRole('button', { name: /^(Добавить|Сохранить)$/ }).click();
  const goal = page.locator('li.group-goal', { hasText: 'На велосипед' });
  await goal.getByRole('button', { name: /Положить/ }).click();
  await page.locator('.sheet input').first().fill('250');
  await page.locator('.sheet').getByRole('button', { name: 'Положить' }).click();
  await expect(goal).toContainText('250');

  // Удалить дело свайпом.
  await swipeLeft(page, item.locator('.swipe-body'));
  await expect(page.locator('.undo-toast')).toHaveCount(0, { timeout: 8_000 });
  await expect(item).toHaveCount(0);

  // Настройки: переименовать, «только админы», чат подключает создатель.
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  await sheet.locator('input.sheet-input').fill('Соседи по дому');
  await sheet.locator('input.sheet-input').press('Enter');
  const toggle = sheet.locator('input.switch');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(sheet.getByRole('button', { name: 'Подключить чат Telegram' })).toBeVisible();
  await closeSheet(page);
  await expect(page.getByText('Соседи по дому').first()).toBeVisible();

  // Удалить группу.
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Удалить группу' }).click();
  await goTab(page, 'Вместе').catch(() => {});
  await expect(page.getByText('Соседи по дому')).toHaveCount(0);
});
