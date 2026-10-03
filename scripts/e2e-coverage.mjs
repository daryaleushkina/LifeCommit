#!/usr/bin/env node
// Покрытие фронта сквозными тестами: E2E_COVERAGE=1 pnpm e2e --project=android-light пишет сырой V8-замер
// в coverage-e2e-raw, этот скрипт сводит его в отчёт по файлам src/ (coverage-e2e/index.html и сводка в консоль).
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { CoverageReport } from 'monocart-coverage-reports';

const dir = 'coverage-e2e-raw';
const report = new CoverageReport({
  name: 'LifeCommit — фронт под сквозными тестами',
  outputDir: 'coverage-e2e',
  reports: ['v8', 'console-summary', 'json-summary'],
  entryFilter: (e) => e.url.includes('/src/') && !e.url.includes('node_modules'),
  // Пути исходников после развёртки карт — относительно адреса модуля (localhost-5173/src/...): берём всё своё.
  sourceFilter: (path) => !path.includes('node_modules') && !path.includes('mockEnv') && !/\.test\.tsx?$/.test(path) && !path.endsWith('.css'),
  // Папку берём из адреса модуля (/src/components/X.tsx), имя — из карты исходников.
  sourcePath: (path, info) => {
    let dir = '';
    try {
      dir = new URL(info?.url ?? '').pathname.replace(/[^/]*$/, '').replace(/^\//, '');
    } catch {
      // адрес модуля не полный — оставляем только имя файла
    }
    return dir + path.replace(/^localhost-\d+\//, '').replace(/-t=\d+$/, '').split('/').pop();
  },
  cleanCache: true,
  logging: process.env.MCR_LOG ?? 'info',
});
for (const f of readdirSync(dir)) await report.add(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
await report.generate();
if (!process.env.KEEP_RAW) rmSync(dir, { recursive: true, force: true });
