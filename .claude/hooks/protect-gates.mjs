#!/usr/bin/env node
// PreToolUse (Edit | Write | MultiEdit): правку того, что держит гейт перед продом, агент делает только с согласия
// владелицы — хук отвечает permissionDecision "ask", и Claude Code спрашивает её.
//   • scripts/hooks/* (pre-push, commit-msg, pre-commit) и .github/workflows/* — проверки перед деплоем;
//   • vitest.config.ts — только если правка опускает или убирает порог покрытия (thresholds). Поднимать — можно.
//     AGENTS.md: «Порог не опускать; подняли покрытие — поднять и порог».
// Файлы вне проекта (другие worktree и т. п.) не трогаем. Непонятный вход — пропускаем (хук не должен мешать работе).
// Тест: .claude/hooks/protect-gates.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Пороги покрытия из текста vitest.config.ts: { lines: 99.5, … }. Нет блока — пустой объект. */
export function thresholds(text) {
  const block = /thresholds\s*:\s*\{([^}]*)\}/.exec(text)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(\w+)\s*:\s*(\d+(?:\.\d+)?)/g)].map((m) => [m[1], Number(m[2])]));
}

/** Текст файла после правки: Write — новое содержимое, Edit и MultiEdit — замены по очереди. */
export function applyEdit(current, toolName, input) {
  if (toolName === 'Write') return typeof input.content === 'string' ? input.content : current;
  const edits = toolName === 'MultiEdit' ? (Array.isArray(input.edits) ? input.edits : []) : [input];
  let next = current;
  for (const e of edits) {
    if (typeof e?.old_string !== 'string' || typeof e.new_string !== 'string' || e.old_string === '') continue;
    next = e.replace_all ? next.split(e.old_string).join(e.new_string) : next.replace(e.old_string, () => e.new_string);
  }
  return next;
}

/** Какие пороги правка опускает или убирает: ['lines', …]. */
export function loweredThresholds(before, after) {
  const was = thresholds(before);
  const now = thresholds(after);
  return Object.keys(was).filter((k) => !(k in now) || now[k] < was[k]);
}

/**
 * Решение по входу хука. null — пропустить, строка — причина спросить владелицу.
 * readFile — чтение текущего файла (подменяется в тестах); нет файла — пустая строка.
 */
export function decide(input, root, readFile = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '')) {
  const file = input?.tool_input?.file_path;
  if (typeof file !== 'string' || !file || !root) return null;
  const abs = path.resolve(root, file);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return null;

  if (rel.startsWith('scripts/hooks/')) {
    return `${rel} — git-хук, часть гейта перед продом (typecheck → coverage → e2e → сборка → деплой). Правка только с согласия владелицы.`;
  }
  if (rel.startsWith('.github/workflows/')) {
    return `${rel} — проверка и деплой в GitHub Actions (гейт для пушей из облака). Правка только с согласия владелицы.`;
  }
  if (rel === 'vitest.config.ts') {
    const before = readFile(abs);
    const lowered = loweredThresholds(before, applyEdit(before, input.tool_name, input.tool_input));
    if (lowered.length) {
      return `Правка опускает или убирает порог покрытия (${lowered.join(', ')}) в vitest.config.ts. AGENTS.md: «Порог не опускать». Только с согласия владелицы.`;
    }
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0);
    }
    const reason = decide(input, process.env.CLAUDE_PROJECT_DIR || input?.cwd);
    if (reason) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }),
      );
    }
    process.exit(0);
  });
}
