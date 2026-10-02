// Профиль: месяц и год, листать месяцы, «Поделиться» (месяц и год), тема, шторки настроек; голос.
import { closeSheet, expect, goTab, test } from './fixtures';

test('месяц и год, «Поделиться» — 4 картинки', async ({ app: page }) => {
  await goTab(page, 'Я');
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
  await page.getByRole('button', { name: 'Следующий месяц' }).click();
  await page.getByRole('button', { name: 'Год', exact: true }).click();
  await page.getByRole('button', { name: 'Месяц', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  await expect(page.locator('canvas.share-card')).toHaveCount(4);
  await closeSheet(page);
});

test('тема переключается, шторки настроек открываются', async ({ app: page }) => {
  await goTab(page, 'Я');
  const dark = page.getByRole('radio', { name: 'Тёмная' });
  const light = page.getByRole('radio', { name: 'Светлая' });
  await dark.click();
  await expect(dark).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
  await light.click();
  await expect(light).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  for (const label of ['Напоминание', 'День заканчивается']) {
    await page.getByRole('button', { name: new RegExp(label) }).first().click();
    await expect(page.locator('.sheet')).toBeVisible();
    await closeSheet(page);
  }
});

test('голос: микрофон открывает шторку, без доступа — понятное «Микрофон недоступен»', async ({ app: page }) => {
  await page.locator('.tab-mic').click();
  await expect(page.locator('.sheet')).toBeVisible();
  const recording = page.getByText('Говори — я слушаю');
  await expect(page.getByText('Микрофон недоступен').or(recording)).toBeVisible();
  // Во время записи тап мимо шторку не закрывает (чтобы запись не терялась) — только «Отмена».
  if (await recording.isVisible()) await page.getByRole('button', { name: 'Отмена' }).click();
  else await closeSheet(page);
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
});
