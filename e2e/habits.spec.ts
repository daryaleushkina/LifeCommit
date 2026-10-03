// Привычки: три вида — создать, отметить; экран привычки; «Поделиться»; редактор; «Отложить»; удалить.
import { center, closeSheet, expect, goTab, swipeLeft, test } from './fixtures';
import type { Page } from '@playwright/test';

const card = (page: Page, title: string) => page.locator('.task', { hasText: title });

async function create(page: Page, intent: string, title: string, goal?: string) {
  await page.getByRole('button', { name: 'Добавить привычку' }).click();
  await page.getByRole('button', { name: new RegExp(intent) }).first().click();
  await page.locator('input').first().fill(title);
  if (goal) await page.locator('input[inputmode="numeric"]').first().fill(goal);
  await page.getByRole('button', { name: /^(Добавить|Сохранить|Готово)$/ }).first().click();
  await expect(card(page, title)).toHaveCount(1);
}

async function openHabit(page: Page, title: string) {
  await center(card(page, title));
  await card(page, title).locator('.task-main h2').click();
  await expect(page.locator('.detail-head')).toBeVisible();
}

test('«Делать регулярно»: создать, отметить, снять', async ({ app: page }) => {
  await create(page, 'Делать регулярно', 'Спортзал');
  const b = card(page, 'Спортзал').locator('button.rb.ok');
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});

test('«Считать что-то»: число карандашом и «сделано целиком»', async ({ app: page }) => {
  await create(page, 'Считать что-то', 'Вода', '5');
  const c = card(page, 'Вода');
  await c.locator('button.rb.edit').click();
  await c.locator('input').fill('3');
  await c.locator('input').press('Enter');
  await expect(c).toContainText(/3\s*из\s*5/);
  await c.locator('button.rb.ok').click();
  await expect(c).toContainText(/5\s*из\s*5/);
});

test('«Бросить»: ответ «получилось» даёт счёт дней', async ({ app: page }) => {
  await create(page, 'Бросить', 'Без сладкого');
  const c = card(page, 'Без сладкого');
  await c.getByRole('button', { name: 'Да, получилось' }).click();
  await expect(c).toContainText('без этого');
  await c.getByRole('button', { name: 'Да, получилось' }).click();
  await expect(c).toContainText('Получилось?');
});

test('экран привычки: отметить прошлый день, «Поделиться» выбирает картинку тапом', async ({ app: page, me }) => {
  await me.api('POST', '/tasks', { title: 'Читать', kind: 'check', target: 1, schedule: 'daily' });
  await page.reload();
  await openHabit(page, 'Читать');
  const past = page.locator('.hcal-day:not([disabled])');
  if (await past.count()) {
    await past.first().click();
    await page.locator('.sheet').getByRole('button', { name: 'Сделано', exact: true }).click();
    await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const cards = page.locator('canvas.share-card');
  await expect(cards).toHaveCount(2);
  await cards.nth(1).click({ position: { x: 16, y: 80 }, force: true });
  await expect(cards.nth(1)).toHaveClass(/on/);
  await closeSheet(page);
});

test('редактор: переименовать, «Отложить» и вернуть, удалить', async ({ app: page, me }) => {
  await me.api('POST', '/tasks', { title: 'Медитация', kind: 'check', target: 1, schedule: 'daily' });
  await page.reload();
  await openHabit(page, 'Медитация');
  await page.locator('.detail-head').getByRole('button').last().click();
  await page.locator('input').first().fill('Медитация утром');
  await page.getByRole('button', { name: /^(Сохранить|Готово)$/ }).first().click();
  await goTab(page, 'Сегодня').catch(async () => page.getByRole('button', { name: /Назад/ }).click());
  await page.reload();
  await expect(card(page, 'Медитация утром')).toHaveCount(1);
  await openHabit(page, 'Медитация утром');
  await page.locator('.detail-head').getByRole('button').last().click();
  await page.getByRole('button', { name: 'Отложить' }).click();
  await page.reload();
  await expect(card(page, 'Медитация утром')).toHaveCount(0);
  await page.getByRole('button', { name: /Отложенные/ }).click();
  await page.getByRole('button', { name: 'Вернуть' }).first().click();
  await page.reload();
  await expect(card(page, 'Медитация утром')).toHaveCount(1);
  await openHabit(page, 'Медитация утром');
  await page.locator('.detail-head').getByRole('button').last().click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.reload();
  await expect(card(page, 'Медитация утром')).toHaveCount(0);
});

test('свайп по привычке: сервер не удалил — привычка на месте и сказано, что не вышло', async ({ app: page, me }) => {
  await me.api('POST', '/tasks', { title: 'Йога', kind: 'check', target: 1, schedule: 'daily' });
  await page.reload();
  // Обрыв связи на удалении (5xx роняет тест сам по себе — фикстура app): привычка не должна пропасть молча.
  await page.route('**/api/tasks/*', (r) => (r.request().method() === 'DELETE' ? r.abort('failed') : r.fallback()));
  await swipeLeft(page, page.locator('.swipe-card', { hasText: 'Йога' }).locator('.swipe-body'));
  await expect(card(page, 'Йога')).toHaveCount(0);
  // Через 5 секунд «Вернуть» удаление уходит на сервер, не проходит — плашка «что-то пошло не так», привычка снова на месте.
  await expect(page.getByRole('status').filter({ hasText: 'Что-то пошло не так. Попробуй ещё раз.' })).toBeVisible({ timeout: 8_000 });
  await expect(card(page, 'Йога')).toHaveCount(1);
});

test('свайп по привычке и сразу в «Календарь»: сервер не удалил — сказано и там, привычка вернулась', async ({ app: page, me }) => {
  await me.api('POST', '/tasks', { title: 'Растяжка', kind: 'check', target: 1, schedule: 'daily' });
  await page.reload();
  await page.route('**/api/tasks/*', (r) => (r.request().method() === 'DELETE' ? r.abort('failed') : r.fallback()));
  await swipeLeft(page, page.locator('.swipe-card', { hasText: 'Растяжка' }).locator('.swipe-body'));
  await expect(card(page, 'Растяжка')).toHaveCount(0);
  await goTab(page, 'Календарь');
  await expect(page.getByRole('status').filter({ hasText: 'Что-то пошло не так. Попробуй ещё раз.' })).toBeVisible({ timeout: 8_000 });
  await goTab(page, 'Сегодня');
  await expect(card(page, 'Растяжка')).toHaveCount(1);
});

test('свайп по карточке привычки: «Вернуть» возвращает', async ({ app: page, me }) => {
  await me.api('POST', '/tasks', { title: 'Йога', kind: 'check', target: 1, schedule: 'daily' });
  await page.reload();
  await swipeLeft(page, page.locator('.swipe-card', { hasText: 'Йога' }).locator('.swipe-body'));
  await expect(card(page, 'Йога')).toHaveCount(0);
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await expect(card(page, 'Йога')).toHaveCount(1);
});
