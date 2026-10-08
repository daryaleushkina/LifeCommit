// Дела на «Сегодня»: добавить, отметить, «Все · Осталось», перенести, удалить свайпом с «Вернуть».
import { closeSheet, expect, swipeLeft, test } from './fixtures';

const row = (page: import('@playwright/test').Page, title: string) => page.locator('.todo-list li', { hasText: title });

test('добавить строкой, отметить и снять отметку', async ({ app: page }) => {
  await page.getByRole('button', { name: 'Дело на сегодня' }).click();
  await page.getByPlaceholder('Что сделать?').fill('Купить хлеб');
  await page.getByPlaceholder('Что сделать?').press('Enter');
  const r = row(page, 'Купить хлеб');
  await expect(r).toHaveCount(1);
  await expect(r).not.toHaveClass(/pending/);
  await r.locator('.todo-check').click();
  await expect(r).toHaveClass(/done/);
  await r.locator('.todo-check').click();
  await expect(r).not.toHaveClass(/done/);
});

test('«Все · Осталось» прячет сделанное и помнит выбор', async ({ app: page, me }) => {
  await me.api('POST', '/todos', { title: 'Позвонить маме' });
  const done = await me.api<{ id: number }>('POST', '/todos', { title: 'Оплатить свет' });
  await me.api('PATCH', `/todos/${done.id}`, { done: true });
  await page.reload();
  await expect(row(page, 'Оплатить свет')).toHaveClass(/done/);
  await page.getByRole('button', { name: 'Осталось' }).click();
  await expect(row(page, 'Оплатить свет')).toHaveCount(0);
  await expect(row(page, 'Позвонить маме')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Осталось' })).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'Оплатить свет')).toHaveCount(0);
  await page.getByRole('button', { name: 'Все', exact: true }).click();
  await expect(row(page, 'Оплатить свет')).toHaveCount(1);
});

// 05.10.2026: прошедший созвон из календаря висел в «Осталось» весь день — у событий нет галочки, отметить его нельзя.
// События приходят из Google и Apple — здесь они дописаны в настоящий ответ /api/today; часы телефона — полдень.
test('«Осталось»: прошедшее событие из календаря уходит, будущее и своё несделанное остаются', async ({ app: page, me }) => {
  await me.api('POST', '/todos', { title: 'Позвонить маме' });
  const { day } = await me.api<{ day: string }>('GET', '/today');
  const event = (id: number, title: string, time: string, duration_min: number) => ({ id, title, day, done: false, time, duration_min, recurring: false, source: 'google', details: null });
  await page.route('**/api/today', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { todos: object[] };
    body.todos.push(event(900_001, 'Дейлик', '10:00', 45), event(900_002, 'Психолог', '16:00', 90));
    await route.fulfill({ response: res, json: body });
  });
  // Полдень по часам телефона: браузер в e2e живёт по Москве (playwright.config, timezoneId), а не по поясу машины.
  await page.clock.install({ time: new Date(`${day}T12:00:00+03:00`) });
  await page.reload();
  await expect(row(page, 'Дейлик')).toHaveCount(1);
  await page.getByRole('button', { name: 'Осталось' }).click();
  await expect(row(page, 'Дейлик')).toHaveCount(0);
  await expect(row(page, 'Психолог')).toHaveCount(1);
  await expect(row(page, 'Позвонить маме')).toHaveCount(1);
  await page.getByRole('button', { name: 'Все', exact: true }).click();
  await expect(row(page, 'Дейлик')).toHaveCount(1);
});

test('шторка: на завтра и обратно на сегодня', async ({ app: page, me }) => {
  await me.api('POST', '/todos', { title: 'Записаться к врачу' });
  await page.reload();
  await row(page, 'Записаться к врачу').locator('.todo-main').click();
  const sheet = page.locator('.sheet');
  await sheet.getByText('Завтра', { exact: true }).click();
  await sheet.getByRole('button', { name: 'Готово' }).click();
  await expect(row(page, 'Записаться к врачу')).toHaveCount(0);
  await page.getByRole('button', { name: /Потом · 1/ }).click();
  await page.locator('.sheet').getByText('Записаться к врачу').click();
  const edit = page.locator('.sheet').last();
  await edit.getByText('Сегодня', { exact: true }).click();
  await edit.getByRole('button', { name: 'Готово' }).click();
  await closeSheet(page);
  await expect(row(page, 'Записаться к врачу')).toHaveCount(1);
});

test('свайп: «Вернуть» возвращает, без него — удалено', async ({ app: page, me }) => {
  await me.api('POST', '/todos', { title: 'Купить корм' });
  await page.reload();
  await swipeLeft(page, row(page, 'Купить корм').locator('.swipe-body'));
  await expect(row(page, 'Купить корм')).toHaveCount(0);
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await expect(row(page, 'Купить корм')).toHaveCount(1);
  await swipeLeft(page, row(page, 'Купить корм').locator('.swipe-body'));
  await expect(page.locator('.undo-toast')).toHaveCount(0, { timeout: 8_000 });
  await expect.poll(async () => (await me.api<{ todos: { title: string }[] }>('GET', '/today')).todos.some((t) => t.title === 'Купить корм')).toBe(false);
});

// Находки /lc-explore 04.10.2026 (решение владелицы: ошибки отметок и дел — плашкой внизу, видна на любой вкладке).
const ERR = 'Что-то пошло не так. Попробуй ещё раз.';

test('свайп по делу и сразу в «Календарь»: сервер не удалил — сказано и там, дело вернулось', async ({ app: page, me }) => {
  await me.api('POST', '/todos', { title: 'Купить батарейки' });
  await page.reload();
  await page.route('**/api/todos/*', (r) => (r.request().method() === 'DELETE' ? r.abort('failed') : r.fallback()));
  await swipeLeft(page, row(page, 'Купить батарейки').locator('.swipe-body'));
  await expect(row(page, 'Купить батарейки')).toHaveCount(0);
  await page.locator('.tabbar button', { hasText: 'Календарь' }).click();
  await expect(page.getByRole('status').filter({ hasText: ERR })).toBeVisible({ timeout: 8_000 });
  await page.locator('.tabbar button', { hasText: 'Сегодня' }).click();
  await expect(row(page, 'Купить батарейки')).toHaveCount(1);
});

test('«Потом · N»: список не загрузился — сказано и можно повторить', async ({ app: page, me }) => {
  const later = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  await me.api('POST', '/todos', { title: 'Сдать анализы', day: later });
  let fail = true;
  await page.route('**/api/todos/later', (r) => (fail ? r.abort('failed') : r.fallback()));
  await page.reload();
  await page.getByRole('button', { name: /Потом · 1/ }).click();
  const sheet = page.locator('.sheet');
  await expect(sheet.getByText(ERR)).toBeVisible();
  fail = false;
  await sheet.getByText(ERR).click();
  await expect(sheet.getByText('Сдать анализы')).toBeVisible();
});

test('новое дело не сохранилось — набранный текст остался в поле', async ({ app: page }) => {
  let fail = true;
  await page.route('**/api/todos', (r) => (fail && r.request().method() === 'POST' ? r.abort('failed') : r.fallback()));
  await page.getByRole('button', { name: 'Дело на сегодня' }).click();
  const input = page.getByPlaceholder('Что сделать?');
  await input.fill('Записаться к стоматологу');
  await input.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: ERR })).toBeVisible();
  await expect(page.getByPlaceholder('Что сделать?')).toHaveValue('Записаться к стоматологу');
  fail = false;
  await input.press('Enter');
  await expect(row(page, 'Записаться к стоматологу')).toBeVisible();
  await expect(input).toHaveValue('');
});
