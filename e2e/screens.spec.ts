// Каждый экран с одинаковыми данными: вёрстка (ничего не наезжает на нижнюю панель, не шире экрана, последнее
// видно, листается) и эталонный снимок. Новый экран или шторка — новая строка здесь.
import { checkScreen, closeSheet, expect, goTab, scrollsByFinger, test } from './fixtures';
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

test('«Чего я хочу?» и редактор привычки трёх видов', async ({ app: page }) => {
  await page.getByRole('button', { name: 'Добавить привычку' }).click();
  await expect(page.getByText('Чего я хочу?')).toBeVisible();
  await checkScreen(page, 'pick');
  for (const [intent, name] of [['Делать регулярно', 'editor-check'], ['Считать что-то', 'editor-count'], ['Бросить', 'editor-abstain']] as const) {
    await page.getByRole('button', { name: new RegExp(intent) }).first().click();
    await expect(page.locator('input').first()).toBeVisible();
    await checkScreen(page, name);
    await page.getByRole('button', { name: /Назад/ }).click();
    await expect(page.getByText('Чего я хочу?')).toBeVisible();
  }
});

test('шторка «Сообщить о проблеме»', async ({ app: page }) => {
  await goTab(page, 'Я');
  await page.getByRole('button', { name: 'Сообщить о проблеме' }).click();
  const sheet = page.getByRole('dialog', { name: 'Что случилось?' });
  await expect(sheet).toBeVisible();
  // Шторка закрывает нижнюю панель по замыслу (как все шторки) — правило «ничего поверх панели» checkScreen к ней
  // не относится. Проверяем своё: не шире экрана и «Отправить» достаётся.
  const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, sheet: document.querySelector('.sheet')!.scrollWidth, clientSheet: document.querySelector('.sheet')!.clientWidth, screen: innerWidth }));
  expect(width.page).toBeLessThanOrEqual(width.screen + 1);
  expect(width.sheet).toBeLessThanOrEqual(width.clientSheet + 1);
  await sheet.getByRole('button', { name: 'Отправить' }).scrollIntoViewIfNeeded();
  await expect(sheet.getByRole('button', { name: 'Отправить' })).toBeInViewport();
  await sheet.evaluate((el) => el.scrollTo(0, 0));
  await expect(page).toHaveScreenshot('sheet-feedback.png');
});

test('«Отложенные»', async ({ app: page, me }) => {
  const { tasks } = await me.api<{ tasks: { id: number; title: string }[] }>('GET', '/today');
  await me.api('POST', `/tasks/${tasks.find((t) => t.title === 'Спортзал')!.id}/archive`);
  await page.reload();
  await page.getByRole('button', { name: /Отложенные/ }).click();
  await expect(page.getByText('Спортзал')).toBeVisible();
  await checkScreen(page, 'archive');
});

test('шторки: дело, дело группы, настройки группы, календари, голос', async ({ app: page }) => {
  // Дело
  await page.locator('.todo-list li', { hasText: 'Купить корм Тесле' }).locator('.todo-main').click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page).toHaveScreenshot('sheet-todo.png', { mask: [page.locator('.page-head p')] });
  await closeSheet(page);
  // Дело группы и настройки группы
  await goTab(page, 'Вместе');
  await page.getByText('Семья').first().click();
  await page.getByRole('button', { name: /^\+?\s*Дело$/ }).first().click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page).toHaveScreenshot('sheet-group-item.png', { mask: [page.locator('.sheet .row .value, .page-head p')] });
  await closeSheet(page);
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page).toHaveScreenshot('sheet-group-settings.png');
  await closeSheet(page);
  // Календари
  await goTab(page, 'Календарь');
  await page.getByRole('button', { name: 'Календари' }).click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page).toHaveScreenshot('sheet-calendars.png', { mask: [page.locator('.cal-grid, .month-nav, .page-head p')] });
  await closeSheet(page);
});

test('друзья: «Что показать», список, заявки, экран друга, «Позвать друга», чужая ссылка', async ({ app: page, me, people }) => {
  // Цвет буквы-аватара — по id, а id у тестовых людей случайные; @username — тоже.
  const avatars = page.locator('.avatar');
  const masha = await people('Маша', `masha${Date.now() % 1_000_000}`);
  const timur = await people('Тимур');
  const code = (await me.api<{ link: string }>('GET', '/friends')).link.split('startapp=f_')[1];
  await masha.api('POST', '/friends/requests', { code });
  await me.api('POST', `/friends/requests/${masha.id}/accept`);
  const { id } = await masha.api<{ id: number }>('POST', '/tasks', { title: 'Испанский', kind: 'count', target: 20, unit: 'слов', visibility: 'friends' });
  await masha.api('PUT', '/logs', { task_id: id, value: 12 });
  await timur.api('POST', '/friends/requests', { code });
  await page.reload();

  await goTab(page, 'Вместе');
  await page.getByRole('radio', { name: 'Друзья' }).click();
  const show = page.getByRole('dialog', { name: 'Что показать друзьям?' });
  await expect(show.getByRole('button', { name: /Пить воду/ })).toBeVisible();
  await expect(page).toHaveScreenshot('friends-show.png');
  await show.getByRole('button', { name: 'Готово' }).click();
  await expect(show).toBeHidden();

  await expect(page.getByRole('button', { name: /Маша/ })).toBeVisible();
  await checkScreen(page, 'friends', { mask: [avatars] });
  await page.getByRole('button', { name: /Заявки · 1/ }).click();
  await expect(page.getByText('по вашей ссылке')).toBeVisible();
  await checkScreen(page, 'friend-requests', { mask: [avatars] });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Маша/ }).click();
  await expect(page.getByText('12 из 20 слов')).toBeVisible();
  await checkScreen(page, 'friend', { mask: [avatars, page.locator('.friend-header small')] });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Позвать друга' }).click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page).toHaveScreenshot('sheet-add-friend.png', { mask: [avatars] });
  await closeSheet(page);

  const timurCode = (await timur.api<{ link: string }>('GET', '/friends')).link.split('startapp=f_')[1];
  const url = new URL(page.url());
  url.searchParams.set('tgStart', `f_${timurCode}`);
  await page.goto(url.toString());
  await expect(page.getByRole('heading', { name: 'Тимур зовёт в друзья' })).toBeVisible();
  await checkScreen(page, 'friend-link', { mask: [avatars] });
});
