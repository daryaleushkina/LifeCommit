// Общее для всех сквозных тестов: свой пользователь на каждый тест, приложение, открытое под ним, помощники
// и проверка экрана (вёрстка + эталонный снимок).
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test as base, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { TgOptions } from '../playwright.config';

/** Подпись initData, которую Worker в локальной разработке принимает без проверки (DEV_AUTH_BYPASS). */
const MOCK_HASH = 'mock-hash-not-valid-for-backend';

export interface Me {
  id: number;
  /** Запрос к API от имени этого пользователя. */
  api: <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;
}

/** Человек со своей initData (id из «тестового» диапазона): запросы к API от его имени и удаление со всеми данными. */
async function makeUser(request: APIRequestContext, name: string, username?: string): Promise<Me & { drop: () => Promise<void> }> {
  const id = 8_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const initData = new URLSearchParams([
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['hash', MOCK_HASH],
    ['signature', 'mock-signature'],
    ['user', JSON.stringify({ id, first_name: name, language_code: 'ru', ...(username && { username }) })],
  ]).toString();
  const api = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await request.fetch(`/api${path}`, { method, headers: { Authorization: `tma ${initData}` }, ...(body !== undefined && { data: body }) });
    if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
    return (await res.json()) as T;
  };
  await api('POST', '/session', { timezone: 'Europe/Moscow' });
  const drop = async () => {
    // Группы при удалении аккаунта остаются без владельца — удаляем их сами.
    const groups = await api<{ id: number; role: string }[]>('GET', '/groups').catch(() => []);
    for (const g of groups) if (g.role === 'owner') await api('DELETE', `/groups/${g.id}`).catch(() => {});
    await api('DELETE', '/account').catch(() => {});
  };
  return { id, api, drop };
}

export const test = base.extend<TgOptions & { tgViewportExtra: number; me: Me; people: (name: string, username?: string) => Promise<Me>; app: Page }>({
  tgTheme: ['light', { option: true }],
  // Telegram сообщает высоту больше видимой (бывает на iPhone) — проверка, что низ всё равно доступен.
  tgViewportExtra: [0, { option: true }],
  tgPlatform: ['ios', { option: true }],
  tgInsets: ['0,0,0,0', { option: true }],

  // Свежий пользователь на тест: id из «тестового» диапазона, после теста — удаляется со всеми данными.
  me: async ({ request }, use) => {
    const user = await makeUser(request, 'Тест');
    await use({ id: user.id, api: user.api });
    await user.drop();
  },

  // Другие люди (друзья, кто зовёт): тоже свои на тест и тоже удаляются после него.
  people: async ({ request }, use) => {
    const made: Awaited<ReturnType<typeof makeUser>>[] = [];
    await use(async (name, username) => {
      const user = await makeUser(request, name, username);
      made.push(user);
      return { id: user.id, api: user.api };
    });
    for (const user of made) await user.drop();
  },

  // Приложение под этим пользователем. Ошибки страницы и ответы сервера 5xx роняют тест.
  app: async ({ page, me, tgTheme, tgPlatform, tgInsets, tgViewportExtra, browserName }, use, testInfo) => {
    // E2E_COVERAGE=1: какие строки фронта выполнились (только Chromium умеет), сводка — pnpm e2e:coverage.
    const coverage = !!process.env.E2E_COVERAGE && browserName === 'chromium';
    if (coverage) await page.coverage.startJSCoverage({ resetOnNavigation: false });
    const problems: string[] = [];
    // Обрыв запроса, когда тест перезагружает страницу, — не ошибка приложения (WebKit: «Load failed»,
    // «… due to access control checks»).
    page.on('pageerror', (e) => !/Load failed|Failed to fetch|NetworkError|aborted|access control checks/i.test(e.message) && problems.push(`ошибка страницы: ${e.message}`));
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 500) problems.push(`сервер ${r.status()}: ${r.request().method()} ${new URL(r.url()).pathname}`);
    });
    // WebKit для Linux (GitHub Actions) собран без записи звука, а WebKit на Маке и Telegram на iPhone её умеют. Только
    // там, где записывать совсем нечем, подставляем микрофон, который «пишет» тишину: экран голоса проверяется так же,
    // а распознавание в тестах всё равно подменено (page.route на /api/voice). Где запись есть — ничего не трогаем.
    await page.addInitScript(() => {
      const media = navigator.mediaDevices as MediaDevices | undefined;
      if (typeof media?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined') return;
      class SilentRecorder {
        state: 'inactive' | 'recording' = 'inactive';
        mimeType = 'audio/mp4';
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        static isTypeSupported(t: string) {
          return t === 'audio/mp4';
        }
        start() {
          this.state = 'recording';
        }
        stop() {
          if (this.state === 'inactive') return;
          this.state = 'inactive';
          setTimeout(() => {
            this.ondataavailable?.({ data: new Blob(['e2e'], { type: 'audio/mp4' }) });
            this.onstop?.();
          }, 0);
        }
      }
      const stream = { getTracks: () => [] };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { ...media, getUserMedia: async () => stream } });
      (window as unknown as { MediaRecorder: unknown }).MediaRecorder = SilentRecorder;
    });
    // Внешнее подменяем: картинка «Поделиться» уходит в Telegram от имени человека, а у тестового чата с ботом нет.
    await page.route('**/api/share', (r) => r.fulfill({ json: { url: 'https://example.com/e2e.jpg', file_id: 'e2e'.repeat(10) } }));
    await page.goto(`/app/?tgTheme=${tgTheme}&tgPlatform=${tgPlatform}&tgInsets=${tgInsets}&tgUserId=${me.id}&tgViewportExtra=${tgViewportExtra}`);
    await expect(page.locator('main.app-shell').first()).toBeVisible({ timeout: 30_000 });
    // Отступы выреза приходят от Telegram после первой отрисовки — ждём их, иначе снимок «до» и «после» разный.
    const [safeTop, , contentTop] = tgInsets.split(',');
    const inset = (name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    await expect.poll(() => inset('--tg-viewport-safe-area-inset-top')).toBe(`${safeTop}px`);
    await expect.poll(() => inset('--tg-viewport-content-safe-area-inset-top')).toBe(`${contentTop}px`);
    const skip = page.getByRole('button', { name: 'Пропустить' });
    await page.locator('.page-head h1').or(skip).first().waitFor({ timeout: 30_000 });
    if (await skip.isVisible()) await skip.click();
    await expect(page.locator('.page-head h1')).toHaveText('Сегодня');
    await use(page);
    if (coverage) {
      const entries = (await page.coverage.stopJSCoverage()).filter((e) => e.url.includes('/src/'));
      mkdirSync('coverage-e2e-raw', { recursive: true });
      writeFileSync(`coverage-e2e-raw/${testInfo.testId}-${testInfo.retry}.json`, JSON.stringify(entries));
    }
    expect(problems, 'ошибки страницы и сервера').toEqual([]);
  },
});
export { expect };

// ── помощники ──

export const tab = (page: Page, name: string) => page.locator('.tabbar button', { hasText: new RegExp(`^\\s*${name}\\s*$`) });

export async function goTab(page: Page, name: string) {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveClass(/active/);
}

/** Прокрутить к элементу так, чтобы он был посередине, а не под нижней панелью. */
export const center = (l: Locator) => l.evaluate((el) => el.scrollIntoView({ block: 'center' }));

/** Закрыть шторку тапом мимо неё (справа сверху: слева сверху — «Назад»). */
export async function closeSheet(page: Page) {
  const backdrop = page.locator('.sheet-backdrop').last();
  if (await backdrop.count()) await backdrop.click({ position: { x: 300, y: 40 } });
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
}

/** Смахнуть строку влево на dx пикселей. */
export async function swipeLeft(page: Page, row: Locator, dx = 320) {
  // Строку могут перерисовать (список перечитался после добавления) — ждём, пока она стоит на месте.
  await expect(row).toBeVisible();
  await center(row);
  let b: Awaited<ReturnType<Locator['boundingBox']>> = null;
  await expect.poll(async () => (b = await row.boundingBox()) !== null).toBe(true);
  b = b!;
  const y = b.y + b.height / 2;
  const x0 = b.x + b.width - 24;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x0 - (dx * i) / 12, y + i * 0.2);
  await page.mouse.up();
}

/**
 * Проверка экрана: вёрстка (ничего шире экрана, поверх нижней панели — только она при любой прокрутке,
 * последнее видно над панелью, список листается) и эталонный снимок. Даты и карты зависят от сегодняшнего
 * дня — на снимке они закрыты.
 */
export async function checkScreen(page: Page, name: string, opts: { mask?: Locator[] } = {}) {
  const issues = await page.evaluate(() => {
    const out: string[] = [];
    const m = document.querySelector<HTMLElement>('main.app-shell');
    if (!m) return out;
    const label = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`страница шире экрана: ${document.documentElement.scrollWidth} > ${innerWidth}`);
    if (m.scrollWidth > m.clientWidth + 1) out.push(`содержимое шире экрана: ${m.scrollWidth} > ${m.clientWidth}`);
    for (const el of m.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > innerWidth + 2 && !el.closest('.year-map, .share-strip, .swipe, .swipe-card')) {
        out.push(`вылезает вправо: ${label(el)} (${Math.round(r.right)} > ${innerWidth})`);
        break;
      }
    }
    const scrollable = m.scrollHeight > m.clientHeight + 4;
    if (scrollable) {
      m.scrollTop = m.scrollHeight;
      if (m.scrollTop === 0) out.push('содержимое выше экрана, но не листается');
    }
    const bar = document.querySelector('.tabbar');
    if (bar) {
      const b = bar.getBoundingClientRect();
      const over = new Set<string>();
      for (let y = 0; y <= m.scrollHeight; y += 60) {
        m.scrollTop = y;
        for (let x = b.left + 6; x < b.right; x += 24) {
          for (let yy = b.top + 4; yy < b.bottom; yy += 12) {
            const el = document.elementFromPoint(x, yy);
            if (el && !el.closest('.tabbar')) over.add(label(el));
          }
        }
      }
      if (over.size) out.push(`поверх нижней панели: ${[...over].slice(0, 3).join(', ')}`);
      if (scrollable) {
        m.scrollTop = m.scrollHeight;
        const last = [...m.children].filter((c) => c.getBoundingClientRect().height > 0 && getComputedStyle(c).position !== 'fixed').at(-1);
        if (last && last.getBoundingClientRect().bottom > b.top + 2) out.push(`последнее (${label(last)}) прячется под нижней панелью`);
      }
    }
    m.scrollTop = 0;
    return out;
  });
  expect(issues, `вёрстка «${name}»`).toEqual([]);
  await settleAtTop(page);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    mask: [page.locator('.page-head p, .cal-grid, .cal-title, .heat-card, .hcal, .month-nav, .detail-head p, .stat-row, time.todo-date'), ...(opts.mask ?? [])],
  });
}

/** Провести пальцем вверх и проверить, что список сдвинулся. Касания есть только в Chromium — в WebKit колесо. */
export async function scrollsByFinger(page: Page, browserName: string) {
  const room = await page.evaluate(() => {
    const m = document.querySelector<HTMLElement>('main.app-shell')!;
    m.scrollTop = 0;
    return m.scrollHeight - m.clientHeight;
  });
  if (room < 20) return;
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, y?: number) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: y === undefined ? [] : [{ x: 200, y }] });
    await touch('touchStart', 560);
    for (let i = 1; i <= 12; i++) await touch('touchMove', 560 - i * 25);
    await touch('touchEnd');
  } else {
    // В мобильном WebKit Playwright не умеет ни касания-свайпы, ни колесо: проверяем, что контейнер листается.
    await page.evaluate(() => document.querySelector('main.app-shell')!.scrollBy(0, 300));
  }
  await expect.poll(() => page.evaluate(() => document.querySelector('main.app-shell')!.scrollTop)).toBeGreaterThan(20);
  await settleAtTop(page);
}

/** Дождаться, пока прокрутка по инерции остановится, и вернуть список наверх. */
async function settleAtTop(page: Page) {
  await expect
    .poll(async () => {
      const a = await page.evaluate(() => document.querySelector('main.app-shell')!.scrollTop);
      await page.waitForTimeout(120);
      const b = await page.evaluate(() => document.querySelector('main.app-shell')!.scrollTop);
      return a === b;
    })
    .toBe(true);
  await page.evaluate(() => document.querySelector('main.app-shell')!.scrollTo({ top: 0, behavior: 'instant' }));
}
