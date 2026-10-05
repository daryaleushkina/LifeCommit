// Календарь: «День / Месяц», дни вперёд-назад, дело на другой день, список листается; возврат из входа Google.
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
