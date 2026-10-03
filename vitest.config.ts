import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Отдельно от vite.config.ts: тестам не нужен плагин Cloudflare.
//   unit — чистые функции (быстро, без базы);
//   dom  — компоненты и логика фронта в настоящем Chromium со стилями приложения (src/**/*.test.tsx);
//   api  — сервер целиком (worker/index.ts) против локальной Supabase, внешнее подменено (worker/test/harness.ts).
// Покрытие: pnpm coverage — его же запускают хук перед пушем и GitHub Actions.
export default defineConfig({
  test: {
    projects: [
      // + хуки Claude Code и git-хуки (.claude/hooks, scripts/hooks) — в покрытие не входят, но тестами проверены.
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['{src,worker,shared}/**/*.test.ts', '.claude/hooks/**/*.test.ts', 'scripts/hooks/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup.ts'],
          browser: { enabled: true, headless: true, provider: playwright(), viewport: { width: 390, height: 844 }, instances: [{ browser: 'chromium' }] },
        },
      },
      { test: { name: 'api', environment: 'node', include: ['worker/**/*.int.test.ts'], testTimeout: 20_000, hookTimeout: 20_000 } },
    ],
    coverage: {
      provider: 'v8',
      include: ['worker/**/*.ts', 'shared/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'worker/test/**', 'src/test/**', 'src/main.tsx', 'src/telegram/mockEnv.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      // Решение владелицы 03.10.2026: пуш не проходит, если покрытие упало ниже достигнутого уровня
      // (замер 03.10 вечером, с друзьями: строки 99,87%, операторы 99,53%, функции 99,53%, ветвления 97,68%).
      // Запас ~0,3 п.п. — на ветки, которые зависят от даты (день недели, начало суток). Подняли покрытие — поднять и порог.
      thresholds: { lines: 99.5, statements: 99.2, functions: 99.2, branches: 97.3 },
    },
  },
});
