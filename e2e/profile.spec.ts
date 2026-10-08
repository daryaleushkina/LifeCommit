// Профиль: месяц и год, листать месяцы, «Поделиться» (месяц и год), тема, шторки настроек; голос; «Сообщить о проблеме».
import { readFileSync } from 'node:fs';
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

test('итог по всем целям: месяц и год в «Поделиться», 8 целей рисуются без ошибок', async ({ app: page, me }) => {
  const day = (await me.api<{ day: string }>('GET', '/today')).day;
  const kinds = ['count', 'check', 'abstain', 'count', 'check', 'count', 'check', 'abstain'] as const;
  for (const [i, kind] of kinds.entries()) {
    const { id } = await me.api<{ id: number }>('POST', '/tasks', { title: `Цель с длинным названием номер ${i + 1}`, kind, target: kind === 'count' ? 10 : 1, unit: kind === 'count' ? 'страниц' : null, schedule: 'daily' });
    await me.api('PUT', '/logs', kind === 'abstain' ? { task_id: id, value: null, status: 'clean', day } : { task_id: id, value: kind === 'count' ? 1024 : 1, day });
  }
  await page.reload();
  await goTab(page, 'Я');
  // Месяц: 2 картинки месяца + 4 итога (23A–D); год: 2 + итог (23F).
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const cards = page.locator('canvas.share-card');
  await expect(cards).toHaveCount(9);
  const blank = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>('canvas.share-card')].filter((c) => {
      const d = c.getContext('2d')!.getImageData(c.width / 2, c.height * 0.4, 1, 1).data;
      return d[3] === 0;
    }).length,
  );
  expect(blank).toBe(0);
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

test('разблокировать не вышло — человек в списке, в шторке сказано', async ({ app: page, me, people }) => {
  const timur = await people('Тимур');
  await me.api('POST', `/friends/${timur.id}/block`);
  await page.reload();
  await goTab(page, 'Я');
  await page.getByRole('button', { name: /Заблокированные/ }).click();
  const blocked = page.getByRole('dialog', { name: 'Заблокированные' });
  await page.route('**/api/blocks/*', (r) => (r.request().method() === 'DELETE' ? r.abort('failed') : r.fallback()));
  await blocked.getByRole('button', { name: 'Разблокировать' }).click();
  await expect(blocked.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
  await expect(blocked.getByText('Тимур')).toBeVisible();
});

// Приём жалобы на сервере пишет владелице в Telegram настоящим ботом — здесь его подменяем, как «Поделиться»
// (fixtures.ts). Сам приём: лимиты, файлы в хранилище, сообщение владелице — worker/feedback.int.test.ts.
test('«Сообщить о проблеме»: текст и скриншот уходят одной формой, в ответ «Получили, спасибо!»', async ({ app: page }) => {
  const sent: string[] = [];
  await page.route('**/api/feedback', (r) => {
    sent.push(r.request().postDataBuffer()?.toString('latin1') ?? '');
    return r.fulfill({ json: { ok: true } });
  });
  await goTab(page, 'Я');
  await page.getByRole('button', { name: 'Сообщить о проблеме' }).click();
  const sheet = page.getByRole('dialog', { name: 'Что случилось?' });
  await expect(sheet.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  // Текст не уходит под кнопку микрофона (05.10.2026: на iPhone подсказка заезжала под неё).
  const field = sheet.getByRole('textbox', { name: 'Что случилось?' });
  const textRight = await field.evaluate((el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight));
  const micLeft = (await sheet.locator('.feedback-mic').boundingBox())!.x;
  expect(textRight).toBeLessThanOrEqual(micLeft);
  await field.fill('Не листается месяц');
  await sheet.getByLabel('+ Скриншот').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: readFileSync('design/avatar/lifecommit-avatar-640.png') });
  await expect(sheet.getByRole('button', { name: 'Убрать скриншот' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByRole('dialog', { name: 'Получили, спасибо!' })).toBeVisible();
  expect(sent).toHaveLength(1);
  const body = Buffer.from(sent[0]!, 'latin1').toString('utf8');
  expect(body).toContain('Не листается месяц');
  expect(body).toContain('"screen":"me"');
  expect(body).toMatch(/filename="shot-1\.jpg"\r\nContent-Type: image\/jpeg/);
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
});

test('«Сообщить о проблеме»: лимит — «Уже много за сегодня», написанное остаётся', async ({ app: page }) => {
  await page.route('**/api/feedback', (r) => r.fulfill({ status: 429, json: { error: 'feedback_limit' } }));
  await goTab(page, 'Я');
  await page.getByRole('button', { name: 'Сообщить о проблеме' }).click();
  const sheet = page.getByRole('dialog', { name: 'Что случилось?' });
  await sheet.getByRole('textbox', { name: 'Что случилось?' }).fill('Белый экран');
  await sheet.getByRole('button', { name: 'Отправить' }).click();
  await expect(sheet.getByText('Уже много за сегодня — завтра примем ещё.')).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Что случилось?' })).toHaveValue('Белый экран');
  await closeSheet(page);
});

// 04.10.2026 (/lc-explore): отказ сервера уходил в необработанную ошибку, на экране — ничего.
for (const [code, message] of [
  ['linked_account', 'Удалить аккаунт можно только из того Telegram, в котором он создан.'],
  ['telegram_only', 'Удалить аккаунт можно в Telegram или в приложении LifeCommit на телефоне.'],
] as const) {
  test(`удалить аккаунт не вышло — сказано почему (${code})`, async ({ app: page }) => {
    await goTab(page, 'Я');
    await page.route('**/api/account', (r) => (r.request().method() === 'DELETE' ? r.fulfill({ status: 403, json: { error: code } }) : r.fallback()));
    await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  });
}

// 04.10.2026 (/lc-explore): сменили «День заканчивается» так, что «сегодня» стало другим днём, — «Сегодня» до минуты
// показывал прошлый день и его отметки, а отметки уже уходили в новый. Пояс выбираем так, чтобы там сейчас было 02:xx:
// при конце дня 04:00 «сегодня» — вчерашний день, при 00:00 — сегодняшний. Так тест не зависит от времени суток.
const zoneAt2am = (() => {
  const h = new Date().getUTCHours();
  const off = [2 - h, 2 - h + 24, 2 - h - 24].find((o) => o >= -12 && o <= 14)!;
  return off === 0 ? 'Etc/GMT' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
})();

test.describe('конец дня сменили — «сегодня» стало другим днём', () => {
  test.use({ timezoneId: zoneAt2am });
  test('«Сегодня» сразу показывает новый день и его отметки', async ({ app: page, me }) => {
    const { id } = await me.api<{ id: number }>('POST', '/tasks', { title: 'Спортзал', kind: 'check', target: 1, schedule: 'daily' });
    await me.api('PUT', '/logs', { task_id: id, value: 1 });
    await page.reload();
    const card = page.locator('article.task', { hasText: 'Спортзал' });
    await expect(card).toHaveClass(/done/);
    await goTab(page, 'Я');
    await page.getByRole('button', { name: /День заканчивается/ }).click();
    const hours = page.getByRole('listbox', { name: 'Часы' });
    await hours.getByRole('option', { name: '00', exact: true }).click();
    await expect(hours.getByRole('option', { name: '00', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Готово' }).click();
    await expect(page.getByRole('button', { name: /День заканчивается/ })).toContainText('00:00');
    await goTab(page, 'Сегодня');
    const now = new Intl.DateTimeFormat('ru-RU', { timeZone: zoneAt2am, day: 'numeric', month: 'long' }).format(new Date());
    await expect(page.locator('.page-head p').first()).toContainText(now);
    await expect(card).not.toHaveClass(/done/);
  });
});
