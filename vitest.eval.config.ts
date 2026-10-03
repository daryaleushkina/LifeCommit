import { defineConfig } from 'vitest/config';

// pnpm eval:voice — эталоны разбора голоса против настоящего Gemini (worker/test/voice.eval.ts).
// Отдельно от vitest.config.ts: в pnpm test, покрытие и хук перед пушем это не входит.
export default defineConfig({
  test: {
    include: ['worker/test/voice.eval.ts'],
    environment: 'node',
    // Три прогона, повторы после 429 с паузой и ограничение запросов в минуту — кейс может идти несколько минут.
    testTimeout: 20 * 60_000,
    hookTimeout: 60_000,
    maxConcurrency: Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 2)),
    // Таблицу итогов печатаем сами, без перехвата консоли.
    disableConsoleIntercept: true,
  },
});
