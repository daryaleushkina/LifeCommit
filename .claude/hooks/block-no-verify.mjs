#!/usr/bin/env node
// PreToolUse (Bash): агент не обходит git-хуки проекта — ни `--no-verify` / `-n`, ни подменой core.hooksPath,
// в том числе внутри `bash -c`, `eval` и heredoc. Хук pre-push — гейт перед продом (typecheck → coverage → e2e →
// сборка → деплой), AGENTS.md: «красное — чинить, а не обходить --no-verify».
// Разбор команды — порт из ECC (lib/no-verify-check.cjs). Блок — код 2 и причина в stderr; иначе — молча 0.
// Владелица в своём терминале по-прежнему может пушить с --no-verify: хук действует только на Claude.
// Тест: .claude/hooks/block-no-verify.test.ts.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { checkCommand, extractCommand } = require('./lib/no-verify-check.cjs');

const MAX_STDIN = 1024 * 1024;

/** Решение по сырому входу хука (JSON Claude Code или голая команда): null — пропустить, строка — текст отказа. */
export function decide(raw) {
  const { blocked, reason } = checkCommand(extractCommand(raw));
  if (!blocked) return null;
  return [
    `Обход git-хуков запрещён: ${reason}.`,
    'Хуки проекта — гейт перед продом (pre-push: typecheck → coverage → e2e → сборка → деплой).',
    'Красное — чинить, а не обходить (AGENTS.md). Если правда нужно отдать деплой GitHub Actions — спроси владелицу.',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (raw.length < MAX_STDIN) raw += chunk.slice(0, MAX_STDIN - raw.length);
  });
  process.stdin.on('end', () => {
    const message = decide(raw);
    if (message) {
      process.stderr.write(`${message}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}
