// Друзья через интерфейс: позвать по @username и по ссылке, заявки, экран друга, «Что показать друзьям?», блок.
import { closeSheet, expect, goTab, test } from './fixtures';
import type { Page } from '@playwright/test';

/** Уникальный @username: тесты идут параллельно в одной базе. */
const nick = (base: string) => `${base}${Date.now() % 1_000_000}${Math.floor(Math.random() * 1000)}`;

async function openFriends(page: Page) {
  await goTab(page, 'Вместе');
  await page.getByRole('radio', { name: 'Друзья' }).click();
}

/** Первый друг — один раз «Что показать друзьям?»: оставляем как есть. */
async function passShowSheet(page: Page) {
  const show = page.getByRole('dialog', { name: 'Что показать друзьям?' });
  await expect(show).toBeVisible();
  await show.getByRole('button', { name: 'Готово' }).click();
  await expect(show).toBeHidden();
}

test('позвать по @username → друг принял → его экран → заблокировать и разблокировать', async ({ app: page, me, people }) => {
  const name = nick('masha');
  const masha = await people('Маша', name);
  await openFriends(page);
  await expect(page.getByText('Позови друга — будете видеть карты друг друга.')).toBeVisible();

  await page.getByRole('button', { name: 'Позвать друга' }).click();
  const sheet = page.locator('.sheet');
  await sheet.getByRole('textbox', { name: 'Найти по @username' }).fill(`@${name}`);
  await expect(sheet.getByText('Маша')).toBeVisible();
  await sheet.getByRole('button', { name: 'Позвать' }).click();
  await expect(sheet.getByText('Заявка отправлена')).toBeVisible();
  await closeSheet(page);
  await expect(page.getByText('ждём ответа')).toBeVisible();

  // Маша приняла у себя.
  await masha.api('POST', `/friends/requests/${me.id}/accept`);
  await page.reload();
  await goTab(page, 'Вместе');
  // «Друзья» запомнились; первый друг — один раз спрашиваем, что ему показать.
  await passShowSheet(page);
  await page.getByRole('button', { name: /Маша/ }).click();
  await expect(page.getByRole('heading', { name: 'Маша' })).toBeVisible();
  await expect(page.getByText(`@${name}`)).toBeVisible();
  await expect(page.getByText('Пока ничего не открыто')).toBeVisible();

  // Окно подтверждения в подменённом Telegram отвечает первой кнопкой — «Заблокировать».
  await page.getByRole('button', { name: 'Заблокировать' }).click();
  await expect(page.getByText('Позови друга — будете видеть карты друг друга.')).toBeVisible();
  expect(await masha.api<{ friends: unknown[] }>('GET', '/friends')).toMatchObject({ friends: [] });

  await goTab(page, 'Я');
  await page.getByRole('button', { name: /Заблокированные/ }).click();
  const blocked = page.getByRole('dialog', { name: 'Заблокированные' });
  await expect(blocked.getByText(`@${name}`)).toBeVisible();
  await blocked.getByRole('button', { name: 'Разблокировать' }).click();
  await expect(blocked.getByText('Маша')).toBeHidden();
});

test('заявка по моей ссылке: «Заявки · 1», «по вашей ссылке», принять — друг в списке', async ({ app: page, me, people }) => {
  const { link } = await me.api<{ link: string }>('GET', '/friends');
  const anya = await people('Аня');
  await anya.api('POST', '/friends/requests', { code: link.split('startapp=f_')[1] });

  await openFriends(page);
  await page.getByRole('button', { name: /Заявки · 1/ }).click();
  await expect(page.getByRole('heading', { name: 'Заявки' })).toBeVisible();
  await expect(page.getByText('по вашей ссылке')).toBeVisible();
  await page.getByRole('button', { name: 'Принять' }).click();
  await expect(page.getByText('Аня')).toBeHidden();
  // Назад в Telegram (в подмене — Escape).
  await page.keyboard.press('Escape');
  await passShowSheet(page);
  await expect(page.getByRole('button', { name: /Аня/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Заявки/ })).toBeHidden();
});

test('открыл чужую ссылку — «зовёт в друзья», «Хочу дружить» отправляет заявку', async ({ app: page, people }) => {
  const dasha = await people('Даша', nick('dasha'));
  const { link } = await dasha.api<{ link: string }>('GET', '/friends');
  const url = new URL(page.url());
  url.searchParams.set('tgStart', `f_${link.split('startapp=f_')[1]}`);
  await page.goto(url.toString());
  await expect(page.getByRole('heading', { name: 'Даша зовёт в друзья' })).toBeVisible();
  await page.getByRole('button', { name: 'Хочу дружить' }).click();
  await expect(page.getByText('Заявка отправлена — Даша подтвердит')).toBeVisible();
  expect((await dasha.api<{ incoming: { first_name: string; via: string }[] }>('GET', '/friends')).incoming).toEqual([expect.objectContaining({ first_name: 'Тест', via: 'link' })]);
  await page.getByRole('button', { name: 'Открыть' }).click();
  await expect(page.getByText('ждём ответа')).toBeVisible();
});

test('«Что показать друзьям?»: плитки, «Выбрать все» — друг видит открытые привычки', async ({ app: page, me, people }) => {
  await me.api('POST', '/tasks', { title: 'Чтение', kind: 'check', target: 1 });
  await me.api('POST', '/tasks', { title: 'Спортзал', kind: 'check', target: 1 });
  const masha = await people('Маша', nick('masha'));
  const { link } = await me.api<{ link: string }>('GET', '/friends');
  await masha.api('POST', '/friends/requests', { code: link.split('startapp=f_')[1] });
  await me.api('POST', `/friends/requests/${masha.id}/accept`);
  await page.reload();

  await openFriends(page);
  const show = page.getByRole('dialog', { name: 'Что показать друзьям?' });
  await expect(show.getByRole('button', { name: /Чтение/ })).toHaveAttribute('aria-pressed', 'false');
  await show.getByRole('button', { name: 'Выбрать все' }).click();
  await expect(show.getByRole('button', { name: /Спортзал/ })).toHaveAttribute('aria-pressed', 'true');
  await show.getByRole('button', { name: /Спортзал/ }).click();
  await show.getByRole('button', { name: 'Готово' }).click();
  await expect(show).toBeHidden();

  // Шторка закрывается сразу, выбор уходит на сервер следом.
  await expect.poll(async () => (await masha.api<{ habits: { title: string }[] }>('GET', `/friends/${me.id}`)).habits.map((h) => h.title)).toEqual(['Чтение']);
});

test('«Позвать друга» — плюс в одной строке с поиском, под переключателем, ничего не задевает (27F)', async ({ app: page }) => {
  await openFriends(page);
  const tabs = (await page.locator('.together-switch').boundingBox())!;
  const head = (await page.locator('.page-head').boundingBox())!;
  const plus = (await page.getByRole('button', { name: 'Позвать друга' }).boundingBox())!;
  const search = (await page.getByRole('searchbox', { name: 'Найти среди друзей' }).boundingBox())!;
  // Шапка — только заголовок; переключатель отступает от неё (03.10.2026: «+» в шапке касался вкладок).
  expect(tabs.y - (head.y + head.height)).toBeGreaterThanOrEqual(12);
  expect(plus.y).toBeGreaterThanOrEqual(tabs.y + tabs.height + 8);
  // Плюс — справа от поиска, на той же строке.
  expect(Math.abs(plus.y + plus.height / 2 - (search.y + search.height / 2))).toBeLessThan(4);
  expect(plus.x).toBeGreaterThan(search.x + search.width);
  await page.getByRole('button', { name: 'Позвать друга' }).click();
  await expect(page.getByRole('dialog', { name: 'Позвать друга' })).toBeVisible();
});

test('сеть подвела: принять заявку и сохранить «Что показать» не вышло — всё на месте и сказано', async ({ app: page, me, people }) => {
  const { link } = await me.api<{ link: string }>('GET', '/friends');
  const anya = await people('Аня');
  await anya.api('POST', '/friends/requests', { code: link.split('startapp=f_')[1] });

  await openFriends(page);
  await page.getByRole('button', { name: /Заявки · 1/ }).click();
  await page.route('**/api/friends/requests/*/accept', (r) => r.abort('failed'));
  await page.getByRole('button', { name: 'Принять' }).click();
  await expect(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
  await expect(page.getByText('Аня')).toBeVisible();
  await page.unroute('**/api/friends/requests/*/accept');
  await page.getByRole('button', { name: 'Принять' }).click();
  await expect(page.getByText('Аня')).toBeHidden();

  // Первый друг — «Что показать друзьям?»: сохранить не вышло — шторка снова открыта с ошибкой.
  await me.api('POST', '/tasks', { title: 'Чтение', kind: 'check', target: 1 });
  await page.keyboard.press('Escape');
  const show = page.getByRole('dialog', { name: 'Что показать друзьям?' });
  await expect(show).toBeVisible();
  await page.route('**/api/friends/shown', (r) => r.abort('failed'));
  await show.getByRole('button', { name: 'Готово' }).click();
  await expect(show.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
  await page.unroute('**/api/friends/shown');
  await show.getByRole('button', { name: 'Готово' }).click();
  await expect(show).toBeHidden();
});
