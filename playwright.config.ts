// Сквозные тесты мини-аппа (решение владелицы 02.10.2026: каждая фича — под тестом, всё проверяется перед
// каждым пушем). Идут против `pnpm dev` с локальной Supabase: мини-апп с подменённым Telegram и настоящий Worker.
// iPhone — WebKit (Telegram на iOS живёт в WKWebView), Android — Chromium; обе темы. У каждого теста свой
// пользователь (?tgUserId=), поэтому тесты идут параллельно и не видят данных друг друга.
//   pnpm e2e                     — все проекты
//   pnpm e2e --project=ios-light — один
//   pnpm e2e -u                  — переснять эталоны снимков (только при намеренной правке вида; сказать в коммите)
import { defineConfig, devices } from '@playwright/test';

export interface TgOptions {
  /** Тема Telegram в подменённом окружении. */
  tgTheme: 'light' | 'dark';
  /** Платформа и отступы выреза (safe top, safe bottom, content top, content bottom). */
  tgPlatform: 'ios' | 'android';
  tgInsets: string;
}

// Порт стенда: по умолчанию 5173. Другой (E2E_PORT=5180) — когда параллельно работают несколько копий репозитория
// (git worktree): иначе тесты переиспользуют чужой dev-сервер на 5173 и проверяют не тот код.
const PORT = Number(process.env.E2E_PORT) || 5173;
const BASE = `http://localhost:${PORT}`;
/** Android — Chromium с поддельным микрофоном: без него запрос доступа висит, и голос не проверить. */
const ANDROID = {
  tgPlatform: 'android' as const,
  tgInsets: '24,0,48,0',
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
};

// e2e/_explore — черновые проверки агента lc-explorer (в git не попадают, нарочно падают на найденном).
// Обычный прогон и хук перед пушем их не видят; агент запускает их с E2E_EXPLORE=1.
const EXPLORE = process.env.E2E_EXPLORE ? [] : ['**/_explore/**'];
/** Приложение для Mac — свои проекты; в телефонах его сценарии не идут. */
const DESKTOP = '**/e2e/desktop.spec.ts';
/** Окно приложения для Mac (macos/): WKWebView — это WebKit; ширина телефона, как мини-апп в Telegram Desktop. */
const MAC = { ...devices['Desktop Safari'], viewport: { width: 420, height: 860 }, tgPlatform: 'ios' as const, tgInsets: '0,0,0,0' };

export default defineConfig<TgOptions>({
  testDir: 'e2e',
  testIgnore: [...EXPLORE, DESKTOP],
  fullyParallel: true,
  workers: process.env.CI ? 2 : 6,
  retries: 1,
  // Упал и прошёл со второго раза — это не «прошёл»: нестабильный тест надо чинить.
  failOnFlakyTests: !process.env.E2E_ALLOW_FLAKY,
  // Эталоны сняты на macOS (хук на Маке); на Linux (GitHub Actions) шрифты рисуются иначе — там снимки не
  // сравниваются, а правила вёрстки в checkScreen, поведение и доступность проверяются как везде.
  ignoreSnapshots: process.platform !== 'darwin',
  timeout: 60_000,
  expect: {
    // В GitHub Actions WebKit рисует программно и заметно медленнее Мака — там ждём дольше; проверки те же.
    timeout: process.env.CI ? 15_000 : 8_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.004, scale: 'css' },
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  snapshotPathTemplate: '{testDir}/__screens__/{projectName}/{arg}{ext}',
  use: {
    baseURL: BASE,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: process.env.CI ? 15_000 : 8_000,
  },
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'ios-light', use: { ...devices['iPhone 15'], tgTheme: 'light', tgPlatform: 'ios', tgInsets: '59,34,46,0' } },
    { name: 'ios-dark', use: { ...devices['iPhone 15'], tgTheme: 'dark', tgPlatform: 'ios', tgInsets: '59,34,46,0' } },
    { name: 'android-light', use: { ...devices['Pixel 7'], ...ANDROID, tgTheme: 'light' } },
    { name: 'android-dark', use: { ...devices['Pixel 7'], ...ANDROID, tgTheme: 'dark' } },
    // Приложение для Mac и вход на компьютере (src/desktop, e2e/desktop.spec.ts): без подмены Telegram.
    { name: 'mac-light', testMatch: DESKTOP, testIgnore: EXPLORE, use: { ...MAC, tgTheme: 'light' } },
    { name: 'mac-dark', testMatch: DESKTOP, testIgnore: EXPLORE, use: { ...MAC, tgTheme: 'dark' } },
  ],
});
