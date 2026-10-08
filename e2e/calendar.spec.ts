// Календарь: дни из кэша, общие дела, синхронизация и возврат из входа Google.
import type { Page } from '@playwright/test';
import { expect, goTab, scrollsByFinger, swipeLeft, test, type Me } from './fixtures';

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

// 03.10.2026, iPhone: WebKit не считал нижний padding контейнера прокрутки — короткий список упирался под панель и не
// листался. Место под панель — отдельным элементом (::after), а не padding: проверяем, что так и осталось.
test('место под нижней панелью — элементом, а не отступом контейнера', async ({ app: page }) => {
  await goTab(page, 'Календарь');
  const [padding, spacer, bar] = await page.evaluate(() => {
    const m = document.querySelector('main.app-shell')!;
    return [getComputedStyle(m).paddingBottom, parseFloat(getComputedStyle(m, '::after').height), document.querySelector('.tabbar')!.getBoundingClientRect().height];
  });
  expect(padding).toBe('0px');
  expect(spacer).toBeGreaterThanOrEqual(bar);
});

// Возврат из входа Google по кнопке «Вернуться в LifeCommit» (t.me/…?startapp=gcal_<код>): мини-апп заканчивает
// подключение своим initData. Чужой (по ссылке другого человека), использованный или подобранный код настоящий сервер не
// принимает — «Ссылка устарела», ничего не подключено. Удачная ветка — в worker/google.int.test.ts и
// CalendarsSheet.test.tsx: обмен кода с Google на стенде не подменить.
test('вернулись из входа Google с чужим кодом — «Календари» открыты, «Ссылка устарела»', async ({ app: page, me }) => {
  const url = new URL(page.url());
  url.searchParams.set('tgStart', `gcal_${'A'.repeat(43)}`);
  await page.goto(url.toString());
  const sheet = page.getByRole('dialog', { name: 'Календари' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Ссылка устарела — нажмите «Подключить» ещё раз.')).toBeVisible();
  expect(await me.api('GET', '/calendars')).toEqual([]);
});

// ── Находки /lc-explore 04.10.2026 ──

/** Ответы /api/calendar — с задержкой (мобильная сеть до Франкфурта): показанное сразу берётся из кэша. */
const slowCalendar = (page: Page, ms: number) =>
  page.route('**/api/calendar?*', async (r) => {
    await new Promise((res) => setTimeout(res, ms));
    await r.fallback().catch(() => {}); // страницу могли закрыть, пока ждали
  });
/** Дождаться, пока подтянется месяц (при открытии «Календаря» он грузится заранее). */
const monthLoaded = (page: Page) =>
  page.waitForResponse((r) => {
    const m = /\/api\/calendar\?from=([\d-]+)&to=([\d-]+)/.exec(r.url());
    return !!m && m[1] !== m[2];
  });
const todayOf = async (me: Me) => (await me.api<{ day: string }>('GET', '/today')).day;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test('отметили дело на «Сегодня» — «Календарь» сразу показывает его сделанным, даже без связи', async ({ app: page, me }) => {
  await me.api('POST', '/todos', { title: 'Купить хлеб' });
  await page.reload();
  await goTab(page, 'Календарь');
  await expect(page.locator('.todo-list li', { hasText: 'Купить хлеб' })).toBeVisible();
  await goTab(page, 'Сегодня');
  const saved = page.waitForResponse((r) => r.url().includes('/api/todos/') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Сделано: Купить хлеб' }).click();
  await saved;
  await page.route('**/api/calendar?*', (r) => r.abort('failed'));
  await goTab(page, 'Календарь');
  await expect(page.getByRole('button', { name: 'Не сделано: Купить хлеб' })).toBeVisible();
});

test('добавили дело в «Дне» — в «Месяце» оно сразу есть', async ({ app: page }) => {
  const month = monthLoaded(page);
  await goTab(page, 'Календарь');
  await month;
  await page.getByRole('button', { name: /Дело на этот день/ }).click();
  await page.getByPlaceholder('Что сделать?').fill('Забрать посылку');
  await page.getByPlaceholder('Что сделать?').press('Enter');
  await expect(page.locator('.todo-list li', { hasText: 'Забрать посылку' })).not.toHaveClass(/pending/);
  await slowCalendar(page, 3000);
  await page.locator('.cal-mode').getByText('Месяц', { exact: true }).click();
  await expect(page.locator('.cal-grid.month')).toBeVisible();
  await expect(page.locator('.todo-list li', { hasText: 'Забрать посылку' })).toBeVisible({ timeout: 1000 });
});

test('день, выбранный в «Месяце», открывается в «Дне» сразу — дела дня уже были в месяце', async ({ app: page, me }) => {
  const today = await todayOf(me);
  // День того же месяца, но не сегодня и не соседний (соседние грузятся заранее отдельно).
  const other = Number(today.slice(8)) <= 15 ? addDays(today, 5) : addDays(today, -5);
  await me.api('POST', '/todos', { title: 'Позвонить маме', day: other });
  const month = monthLoaded(page);
  await goTab(page, 'Календарь');
  await month;
  await page.locator('.cal-mode').getByText('Месяц', { exact: true }).click();
  await page.locator('.cal-day:not(.out)', { has: page.locator('b', { hasText: new RegExp(`^${Number(other.slice(8))}$`) }) }).click();
  await slowCalendar(page, 3000);
  await page.locator('.cal-mode').getByText('День', { exact: true }).click();
  await expect(page.locator('.todo-list li', { hasText: 'Позвонить маме' })).toBeVisible({ timeout: 1000 });
});

test('листать дни подряд — у каждого дня сразу его дела, без пустого экрана', async ({ app: page, me }) => {
  const today = await todayOf(me);
  // Листаем внутрь месяца: его дни уже есть в загруженном заранее месяце.
  const dir = Number(today.slice(8)) <= 15 ? 1 : -1;
  for (const n of [1, 2, 3]) await me.api('POST', '/todos', { title: `Дело дня ${n}`, day: addDays(today, dir * n) });
  const month = monthLoaded(page);
  await goTab(page, 'Календарь');
  await month;
  await slowCalendar(page, 3000);
  for (const n of [1, 2, 3]) {
    await page.getByRole('button', { name: dir > 0 ? 'Следующий день' : 'Предыдущий день' }).click();
    await expect(page.locator('.todo-list li', { hasText: `Дело дня ${n}` })).toBeVisible({ timeout: 1000 });
  }
});

test('день не загрузился — сказано, а по тапу загружается снова', async ({ app: page }) => {
  // Ни один день ещё не в кэше: «Сегодня» тоже подтягивает его заранее — обрываем и это.
  await page.route('**/api/calendar?*', (r) => r.abort('failed'));
  await page.reload();
  await goTab(page, 'Календарь');
  const failed = page.locator('main p.error', { hasText: 'Не получилось загрузить' });
  await expect(failed).toBeVisible();
  await page.unroute('**/api/calendar?*');
  await failed.click();
  await expect(page.getByRole('button', { name: /Дело на этот день/ })).toBeVisible();
  await expect(failed).toHaveCount(0);
});

test('общее дело на медленной сети: галочка сразу, двойной тап — один запрос', async ({ app: page, me }) => {
  const g = await me.api<{ id: number }>('POST', '/groups', { title: 'Дом' });
  await me.api('POST', `/groups/${g.id}/items`, { title: 'Пропылесосить', mode: 'one' });
  await page.reload();
  await goTab(page, 'Календарь');
  const puts: string[] = [];
  page.on('request', (r) => r.method() === 'PUT' && r.url().includes('/mark') && puts.push(r.url()));
  await page.route('**/api/groups/*/items/*/mark', async (r) => {
    await new Promise((res) => setTimeout(res, 2500));
    await r.fallback().catch(() => {});
  });
  const check = page.locator('.group-block li', { hasText: 'Пропылесосить' }).locator('.todo-check');
  const done = page.waitForResponse((r) => r.url().includes('/mark'));
  await check.click();
  await expect(check).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
  await check.click();
  await done;
  await expect(check).toHaveAttribute('aria-pressed', 'true');
  expect(puts).toHaveLength(1);
});

test('общее дело: сервер отказал — галочка вернулась, ошибка; на другом дне её уже нет', async ({ app: page, me }) => {
  const g = await me.api<{ id: number }>('POST', '/groups', { title: 'Дом' });
  await me.api('POST', `/groups/${g.id}/items`, { title: 'Пропылесосить', mode: 'one' });
  await page.reload();
  await goTab(page, 'Календарь');
  await page.route('**/api/groups/*/items/*/mark', (r) => r.fulfill({ status: 409, json: { error: 'conflict' } }));
  const check = page.locator('.group-block li', { hasText: 'Пропылесосить' }).locator('.todo-check');
  await check.click();
  await expect(page.locator('main p.error')).toBeVisible();
  await expect(check).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Следующий день' }).click();
  await expect(page.locator('main p.error')).toHaveCount(0);
});

test('«Обновить» не прошло — сказано', async ({ app: page }) => {
  const acc = { id: 1, provider: 'apple', login: 'me@icloud.com', status: 'ok', last_sync_at: new Date().toISOString(), default_url: null, collections: [] };
  await page.route('**/api/calendars', (r) => r.fulfill({ json: [acc] }));
  await page.route('**/api/calendars/sync', (r) => r.abort('failed'));
  await page.reload();
  await goTab(page, 'Календарь');
  await page.getByRole('button', { name: 'Обновить' }).click();
  await expect(page.locator('main p.error', { hasText: 'Не получилось обновить' })).toBeVisible();
});

test('шторка «Календари»: отказ на календаре внизу длинного списка — ошибку видно рядом, а не за краем', async ({ app: page }) => {
  const col = (n: number) => ({ url: `/cal/${n}/`, name: `Календарь ${n}`, color: '#3478f6', enabled: true, writable: true });
  const acc = { id: 901, provider: 'apple', login: 'me@icloud.com', status: 'ok', last_sync_at: new Date().toISOString(), default_url: '/cal/1/', collections: Array.from({ length: 12 }, (_, i) => col(i + 1)) };
  await page.route('**/api/calendars**', (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() === 'PATCH') return r.fulfill({ status: 409, json: { error: 'conflict' } });
    if (u.pathname === '/api/calendars') return r.fulfill({ json: [acc] });
    if (u.pathname === '/api/calendars/google/url') return r.fulfill({ json: { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' } });
    return r.fulfill({ json: { ok: true } });
  });
  await page.reload();
  await goTab(page, 'Календарь');
  await page.getByRole('button', { name: 'Календари', exact: true }).click();
  const last = page.locator('.sheet .toggle-row', { hasText: 'Календарь 12' });
  await last.scrollIntoViewIfNeeded();
  await last.locator('input.switch').click();
  await expect(last.locator('input.switch')).toBeChecked();
  await expect(page.locator('.sheet p.error')).toBeInViewport();
});
