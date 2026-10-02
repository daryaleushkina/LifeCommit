import { defineConfig } from 'vitest/config';

// Отдельно от vite.config.ts: тестам не нужен плагин Cloudflare.
//   unit — чистые функции (быстро, без базы);
//   api  — сервер целиком (worker/index.ts) против локальной Supabase, внешнее подменено (worker/test/harness.ts).
// Покрытие: pnpm coverage (сервер и общие функции; фронт проверяют сквозные тесты e2e/).
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['{src,worker,shared}/**/*.test.ts'], exclude: ['**/*.int.test.ts', '**/node_modules/**'] } },
      { test: { name: 'api', environment: 'node', include: ['worker/**/*.int.test.ts'], testTimeout: 20_000, hookTimeout: 20_000 } },
    ],
    coverage: {
      provider: 'v8',
      include: ['worker/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.test.ts', 'worker/test/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
});
