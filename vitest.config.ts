import { defineConfig } from 'vitest/config';

// Отдельно от vite.config.ts: тестам чистых функций не нужен плагин Cloudflare.
export default defineConfig({
  test: { environment: 'node', include: ['{src,worker,shared}/**/*.test.ts'] },
});
