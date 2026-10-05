// Вход на компьютере — сторона Telegram: компьютер открыл ссылку t.me/LifeCommit_bot?startapp=mac_<код>, мини-апп
// спрашивает «Войти на Mac?»; в профиле — «Компьютеры» и «Выйти везде». Компьютер здесь — запросы к API, как их шлёт
// приложение для Mac (src/desktop/Login.tsx); сам компьютер — в desktop.spec.ts.
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, goTab, test } from './fixtures';

/** Компьютер начинает вход: секрет у него, код — в ссылке на мини-апп. */
async function startOnComputer(request: APIRequestContext, device: 'mac' | 'web' = 'mac') {
  const res = await request.post('/api/desktop/login', { data: { device } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { secret: string; code: string; ticket: string; link: string };
}

/** Компьютер спрашивает, подтвердили ли вход. */
async function poll(request: APIRequestContext, secret: string) {
  return (await (await request.post('/api/desktop/login/poll', { data: { secret } })).json()) as { status: string; token?: string };
}

/** Открыть мини-апп по ссылке входа, как Telegram открывает t.me/…?startapp=… */
async function openLink(page: Page, link: string) {
  const url = new URL(page.url());
  url.searchParams.set('tgStart', new URL(link).searchParams.get('startapp')!);
  await page.goto(url.toString());
}

test('«Войти на Mac?» — «Войти»: компьютер получает ключ и входит этим человеком', async ({ app: page, me, request }) => {
  const login = await startOnComputer(request);
  expect(login.link).toBe(`https://t.me/LifeCommit_bot?startapp=mac_${login.ticket}`);
  await openLink(page, login.link);
  await expect(page.getByRole('heading', { name: 'Войти на Mac?' })).toBeVisible();
  expect(await poll(request, login.secret)).toEqual({ status: 'pending' });

  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Готово' })).toBeVisible();
  const got = await poll(request, login.secret);
  expect(got.status).toBe('ok');
  const session = await request.post('/api/session', { headers: { Authorization: `Bearer ${got.token}` }, data: {} });
  expect(((await session.json()) as { user: { id: number } }).user.id).toBe(me.id);

  await page.getByRole('button', { name: 'На главную' }).click();
  await expect(page.locator('.page-head h1')).toHaveText('Сегодня');
});

test('«Не входить» — ничего не подтверждено; та же ссылка второй раз — «уже подтверждён»', async ({ app: page, request, people }) => {
  const login = await startOnComputer(request, 'web');
  await openLink(page, login.link);
  await expect(page.getByRole('heading', { name: 'Войти в браузере?' })).toBeVisible();
  await page.getByRole('button', { name: 'Не входить' }).click();
  await expect(page.locator('.page-head h1')).toHaveText('Сегодня');
  expect(await poll(request, login.secret)).toEqual({ status: 'pending' });

  // кто-то другой успел подтвердить этот код — второй раз нельзя
  const other = await people('Другой');
  await other.api('POST', '/desktop/approve', { ticket: login.ticket, device: 'web' });
  await openLink(page, login.link);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText('Этот вход уже подтверждён.')).toBeVisible();
});

test('«Я» → «Компьютеры»: видно, где вошли; «Выйти везде» — ключи перестают работать', async ({ app: page, me, request }) => {
  await goTab(page, 'Я');
  await expect(page.getByRole('button', { name: /Компьютеры/ })).toHaveCount(0);

  const login = await startOnComputer(request);
  await me.api('POST', '/desktop/approve', { ticket: login.ticket, device: 'mac' });
  const { token } = await poll(request, login.secret);
  await page.reload();
  await goTab(page, 'Я');
  const row = page.getByRole('button', { name: /Компьютеры/ });
  await expect(row).toContainText('1');
  await row.click();
  // Подтверждение Telegram (в подмене — сразу первая кнопка «Выйти везде»).
  await expect(row).toHaveCount(0);
  expect((await request.get('/api/today', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
});
