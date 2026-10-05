// Приложение для Mac (macos/) и вход на компьютере: тот же мини-апп без Telegram. Вход — через Telegram (мини-апп
// подтверждает «Войти на Mac?»), а главную кнопку, «назад», подтверждения и ссылки рисует и делает мост
// src/desktop/host.ts. Проекты mac-light / mac-dark: WebKit (в приложении — WKWebView), окно 420×860, без подмены Telegram.
// Подтверждение в Telegram здесь — запросом от имени человека (me.api); сам экран «Войти на Mac?» — в computers.spec.ts.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { checkScreen, expect, goTab, test as base, type Me } from './fixtures';
import { seed } from './seed';

const signInButton = (page: Page) => page.getByRole('button', { name: 'Войти через Telegram' });
const heading = (page: Page) => page.locator('.page-head h1');

/** Страница «приложения для Mac»: ссылки наружу не открываются, а запоминаются; ошибки страницы и 5xx роняют тест. */
const test = base.extend<{ desk: Page }>({
  desk: async ({ page, tgTheme }, use) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => !/Load failed|Failed to fetch|NetworkError|aborted|access control checks/i.test(e.message) && problems.push(`ошибка страницы: ${e.message}`));
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 500) problems.push(`сервер ${r.status()}: ${r.request().method()} ${new URL(r.url()).pathname}`);
    });
    await page.emulateMedia({ colorScheme: tgTheme });
    // Картинка «Поделиться» уходит в Telegram через бота — в тестах подменяем, сама картинка — со «своего» адреса.
    await page.route('**/api/share', (r) => r.fulfill({ json: { url: '/share/e2e-desktop.jpg', file_id: 'e2e'.repeat(10) } }));
    await page.route('**/share/e2e-desktop.jpg', (r) => r.fulfill({ body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: 'image/jpeg' }));
    await page.addInitScript(() => {
      const w = window as unknown as { opened: string[] };
      w.opened = [];
      window.open = (url) => {
        w.opened.push(String(url));
        return null;
      };
    });
    await page.goto('/app/?desktop');
    await use(page);
    expect(problems, 'ошибки страницы и сервера').toEqual([]);
  },
});

const opened = (page: Page) => page.evaluate(() => (window as unknown as { opened: string[] }).opened);

/** Войти: «Войти через Telegram» → ссылка на мини-апп → человек подтвердил в Telegram → «Сегодня». */
async function signIn(page: Page, me: Me, onWaiting?: () => Promise<void>) {
  const started = page.waitForResponse((r) => r.url().endsWith('/api/desktop/login'));
  await signInButton(page).click();
  const { ticket } = (await (await started).json()) as { ticket: string };
  await expect(page.getByRole('heading', { name: 'Подтверди вход в Telegram' })).toBeVisible();
  await onWaiting?.();
  expect(await opened(page)).toEqual([`https://t.me/LifeCommit_bot?startapp=web_${ticket}`]);
  await me.api('POST', '/desktop/approve', { ticket, device: 'web' });
  // Новичок без привычек видит «Чего я хочу?» — пропускаем, как в Telegram.
  const skip = page.getByRole('button', { name: 'Пропустить' });
  await heading(page).or(skip).first().waitFor({ timeout: 15_000 });
  if (await skip.isVisible()) await skip.click();
  await expect(heading(page)).toHaveText('Сегодня');
}

test('вход через Telegram: экран входа, подтверждение — сразу «Сегодня»; после перезапуска вход помнится', async ({ desk: page, me }) => {
  await seed(me);
  await expect(signInButton(page)).toBeVisible();
  await checkScreen(page, 'desktop-login');
  await signIn(page, me, () => checkScreen(page, 'desktop-waiting'));
  await expect(page.locator('.task')).toHaveCount(3);
  await checkScreen(page, 'desktop-today');
  await page.reload();
  await expect(heading(page)).toHaveText('Сегодня');
  await expect(signInButton(page)).toHaveCount(0);
});

test('главная кнопка, «назад» и подтверждение — как в Telegram, только на странице', async ({ desk: page, me }) => {
  await me.api('POST', '/tasks', { title: 'Читать', kind: 'check', target: 1 });
  await signIn(page, me);
  const back = page.getByRole('button', { name: 'Назад' });
  await expect(back).toBeHidden();

  // экран привычки → «Назад» сверху; редактор → «Сохранить» полосой снизу
  await page.locator('.task', { hasText: 'Читать' }).locator('.task-main h2').click();
  await expect(back).toBeVisible();
  await page.getByRole('button', { name: 'Привычка' }).click();
  const save = page.locator('.host-bar').getByRole('button', { name: 'Сохранить' });
  await expect(save).toBeVisible();
  await checkScreen(page, 'desktop-editor');
  await page.locator('input').first().fill('Читать книгу');
  await save.click();
  await expect(page.locator('.host-bar')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Читать книгу' })).toBeVisible();

  // Escape — «назад»
  await page.keyboard.press('Escape');
  await expect(heading(page)).toHaveText('Сегодня');
  await expect(back).toBeHidden();

  // удалить: подтверждение шторкой; «Отмена» — ничего, «Удалить» — удаляет
  await page.locator('.task', { hasText: 'Читать книгу' }).locator('.task-main h2').click();
  await page.getByRole('button', { name: 'Привычка' }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Удалить привычку вместе с историей?');
  await checkScreen(page, 'desktop-confirm');
  await confirm.getByRole('button', { name: 'Отмена' }).click();
  await expect(confirm).toBeHidden();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await confirm.getByRole('button', { name: 'Удалить' }).click();
  await expect(heading(page)).toHaveText(/Сегодня|Чего я хочу\?/);
  expect((await me.api<{ tasks: unknown[] }>('GET', '/today')).tasks).toEqual([]);
});

test('после перезагрузки страницы «Назад» и «Сохранить» на месте (SDK помнит кнопки, мост — нет)', async ({ desk: page, me }) => {
  await me.api('POST', '/tasks', { title: 'Читать', kind: 'check', target: 1 });
  await signIn(page, me);
  const back = page.getByRole('button', { name: 'Назад' });
  const save = page.locator('.host-bar').getByRole('button', { name: 'Сохранить' });
  await page.locator('.task', { hasText: 'Читать' }).locator('.task-main h2').click();
  await page.getByRole('button', { name: 'Привычка' }).click();
  await expect(save).toBeVisible();
  await page.reload();
  await expect(heading(page)).toHaveText('Сегодня');
  await expect(back).toBeHidden();
  await expect(page.locator('.host-bar')).toBeHidden();
  await page.locator('.task', { hasText: 'Читать' }).locator('.task-main h2').click();
  await expect(back).toBeVisible();
  await page.getByRole('button', { name: 'Привычка' }).click();
  await expect(save).toBeVisible();
});

test('«Что показать друзьям?» на весь экран — «Назад» сверху видна и закрывает его', async ({ desk: page, me, people }) => {
  const masha = await people('Маша');
  const { link } = await me.api<{ link: string }>('GET', '/friends');
  await masha.api('POST', '/friends/requests', { code: link.split('startapp=f_')[1] });
  await me.api('POST', `/friends/requests/${masha.id}/accept`);
  await signIn(page, me);
  await goTab(page, 'Вместе');
  await page.getByRole('radio', { name: 'Друзья' }).click();
  const show = page.getByRole('dialog', { name: 'Что показать друзьям?' });
  await expect(show).toBeVisible();
  const back = page.getByRole('button', { name: 'Назад' });
  await expect(back).toBeVisible();
  // «Назад» — самый верхний слой там, где нарисована: её не закрывает полноэкранный экран.
  const box = (await back.boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.host-back') !== null, [box.x + box.width / 2, box.y + box.height / 2])).toBe(true);
  await back.click();
  await expect(show).toBeHidden();
});

test('тема системы сменилась (macOS «Авто» вечером) — приложение и экран входа меняют тему сразу', async ({ desk: page, me, tgTheme }) => {
  const other = tgTheme === 'light' ? 'dark' : 'light';
  const scheme = () => page.evaluate(() => document.documentElement.dataset.colorScheme);
  await expect.poll(scheme).toBe(tgTheme);
  await page.emulateMedia({ colorScheme: other });
  await expect.poll(scheme).toBe(other);
  await page.emulateMedia({ colorScheme: tgTheme });
  await signIn(page, me);
  await expect.poll(scheme).toBe(tgTheme);
  await page.emulateMedia({ colorScheme: other });
  await expect.poll(scheme).toBe(other);
});

test('«Поделиться» на компьютере: сторис и чата нет, «Сохранить» скачивает картинку', async ({ desk: page, me }) => {
  await me.api('POST', '/tasks', { title: 'Читать', kind: 'check', target: 1 });
  await signIn(page, me);
  await goTab(page, 'Я');
  await page.getByRole('button', { name: 'Поделиться' }).click();
  await expect(page.locator('canvas.share-card').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'В сторис Telegram' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Отправить в чат' })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  expect((await download).suggestedFilename()).toBe('lifecommit.jpg');
});

test('ссылки Telegram — наружу: «Поддержать проект» открывает t.me', async ({ desk: page, me }) => {
  await signIn(page, me);
  await goTab(page, 'Я');
  await page.getByRole('button', { name: 'Поддержать проект' }).click();
  await expect.poll(() => opened(page)).toContain('https://t.me/tribute/app?startapp=dRk2');
});

test('«Выйти на этом компьютере» — снова экран входа, старый ключ больше не пускает', async ({ desk: page, me, request }) => {
  await signIn(page, me);
  const token = await page.evaluate(() => localStorage.getItem('lc-desktop-token'));
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((await me.api<{ device: string }[]>('GET', '/desktop/sessions')).map((s) => s.device)).toEqual(['web']);
  await goTab(page, 'Я');
  await page.getByRole('button', { name: 'Выйти на этом компьютере' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Выйти' }).click();
  await expect(signInButton(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lc-desktop-token'))).toBeNull();
  expect((await request.get('/api/today', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
  expect(await me.api('GET', '/desktop/sessions')).toEqual([]);
});

test('вышли на всех компьютерах из Telegram — при следующем открытии экран входа', async ({ desk: page, me }) => {
  await signIn(page, me);
  await me.api('DELETE', '/desktop/sessions');
  await page.reload();
  await expect(signInButton(page)).toBeVisible();
});

test('доступность экранов входа (WCAG 2.1 AA)', async ({ desk: page }) => {
  await page.addStyleTag({ content: 'body { background: var(--bg) !important; }' });
  const axe = async (name: string) => {
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), name).toEqual([]);
  };
  await expect(signInButton(page)).toBeVisible();
  await axe('вход');
  await signInButton(page).click();
  await expect(page.getByRole('heading', { name: 'Подтверди вход в Telegram' })).toBeVisible();
  await axe('ждём подтверждения');
  await page.getByRole('button', { name: 'Отмена' }).click();
  await expect(signInButton(page)).toBeVisible();
});
