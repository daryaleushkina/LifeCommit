// Хук PreToolUse: правки гейта перед продом — только с согласия владелицы (protect-gates.mjs).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyEdit, decide, loweredThresholds, thresholds } from './protect-gates.mjs';

const HOOK = fileURLToPath(new URL('./protect-gates.mjs', import.meta.url));
const ROOT = '/repo';
const CONFIG = `export default defineConfig({
  test: {
    coverage: {
      thresholds: { lines: 99.5, statements: 99.2, functions: 99.2, branches: 97.3 },
    },
  },
});
`;
const read = (text: string) => () => text;
const edit = (old_string: string, new_string: string, extra: object = {}) => ({
  tool_name: 'Edit',
  tool_input: { file_path: `${ROOT}/vitest.config.ts`, old_string, new_string, ...extra },
});

describe('thresholds / applyEdit / loweredThresholds', () => {
  it('читает пороги, нет блока — пусто', () => {
    expect(thresholds(CONFIG)).toEqual({ lines: 99.5, statements: 99.2, functions: 99.2, branches: 97.3 });
    expect(thresholds('export default {}')).toEqual({});
  });

  it('Write — новое содержимое; без content — как было', () => {
    expect(applyEdit('a', 'Write', { content: 'b' })).toBe('b');
    expect(applyEdit('a', 'Write', {})).toBe('a');
  });

  it('Edit — одна замена, replace_all — все; $ в замене не шаблон', () => {
    expect(applyEdit('x x', 'Edit', { old_string: 'x', new_string: '$&y' })).toBe('$&y x');
    expect(applyEdit('x x', 'Edit', { old_string: 'x', new_string: 'y', replace_all: true })).toBe('y y');
  });

  it('MultiEdit — по очереди; кривые и пустые правки пропускает', () => {
    const edits = [{ old_string: 'a', new_string: 'b' }, { old_string: 'b', new_string: 'c' }, null, { old_string: '', new_string: 'z' }, { old_string: 'c' }];
    expect(applyEdit('a', 'MultiEdit', { edits })).toBe('c');
    expect(applyEdit('a', 'MultiEdit', { edits: 'нет' })).toBe('a');
  });

  it('опущенный и убранный порог — да, поднятый — нет', () => {
    expect(loweredThresholds(CONFIG, CONFIG.replace('lines: 99.5', 'lines: 99'))).toEqual(['lines']);
    expect(loweredThresholds(CONFIG, CONFIG.replace('branches: 97.3', ''))).toEqual(['branches']);
    expect(loweredThresholds(CONFIG, CONFIG.replace('lines: 99.5', 'lines: 99.9'))).toEqual([]);
    expect(loweredThresholds('', CONFIG)).toEqual([]);
  });
});

describe('decide: что спрашивать у владелицы', () => {
  it.each(['scripts/hooks/pre-push', 'scripts/hooks/commit-msg', '.github/workflows/deploy.yml'])('%s — всегда', (file) => {
    const input = { tool_name: 'Edit', tool_input: { file_path: `${ROOT}/${file}`, old_string: 'a', new_string: 'b' } };
    expect(decide(input, ROOT, read(''))).toContain(file);
  });

  it('относительный путь считается от корня проекта', () => {
    expect(decide({ tool_name: 'Write', tool_input: { file_path: 'scripts/hooks/pre-push', content: '' } }, ROOT, read(''))).toContain('git-хук');
  });

  it('vitest.config.ts: опускание порога — спросить, с перечнем порогов', () => {
    expect(decide(edit('lines: 99.5', 'lines: 98'), ROOT, read(CONFIG))).toMatch(/порог покрытия \(lines\)/);
    expect(decide(edit('statements: 99.2, functions: 99.2, ', ''), ROOT, read(CONFIG))).toMatch(/\(statements, functions\)/);
    const write = { tool_name: 'Write', tool_input: { file_path: `${ROOT}/vitest.config.ts`, content: 'export default {}' } };
    expect(decide(write, ROOT, read(CONFIG))).toMatch(/lines, statements, functions, branches/);
    const multi = { tool_name: 'MultiEdit', tool_input: { file_path: `${ROOT}/vitest.config.ts`, edits: [{ old_string: 'branches: 97.3', new_string: 'branches: 90' }] } };
    expect(decide(multi, ROOT, read(CONFIG))).toMatch(/\(branches\)/);
  });

  it('vitest.config.ts: поднять порог или поправить другое — без вопросов', () => {
    expect(decide(edit('lines: 99.5', 'lines: 99.8'), ROOT, read(CONFIG))).toBeNull();
    expect(decide(edit("name: 'unit'", "name: 'unit2'"), ROOT, read(CONFIG))).toBeNull();
    expect(decide(edit('нет такого текста', ''), ROOT, read(CONFIG))).toBeNull();
  });

  it('прочие файлы, файлы вне проекта и непонятный вход — пропускает', () => {
    const src = { tool_name: 'Edit', tool_input: { file_path: `${ROOT}/src/App.tsx`, old_string: 'a', new_string: 'b' } };
    expect(decide(src, ROOT, read(''))).toBeNull();
    const outside = { tool_name: 'Edit', tool_input: { file_path: '/elsewhere/scripts/hooks/pre-push', old_string: 'a', new_string: 'b' } };
    expect(decide(outside, ROOT, read(''))).toBeNull();
    expect(decide({ tool_name: 'Edit', tool_input: { file_path: ROOT } }, ROOT, read(''))).toBeNull();
    expect(decide({ tool_name: 'Edit', tool_input: {} }, ROOT, read(''))).toBeNull();
    expect(decide(null, ROOT, read(''))).toBeNull();
    expect(decide(src, '', read(''))).toBeNull();
  });
});

describe('protect-gates как процесс', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'protect-gates-'));
  fs.writeFileSync(path.join(tmp, 'vitest.config.ts'), CONFIG);
  const run = (input: object | string, env: Record<string, string> = { CLAUDE_PROJECT_DIR: tmp }) =>
    spawnSync(process.execPath, [HOOK], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
    });

  it('опускание порога в настоящем файле — JSON с permissionDecision "ask"', () => {
    const r = run({ tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'vitest.config.ts'), old_string: 'lines: 99.5', new_string: 'lines: 1' } });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'ask' });
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('lines');
  });

  it('без CLAUDE_PROJECT_DIR берёт cwd из входа', () => {
    const r = run({ cwd: tmp, tool_name: 'Write', tool_input: { file_path: path.join(tmp, 'scripts/hooks/pre-push'), content: '' } }, {});
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('обычная правка и битый JSON — код 0 и пустой stdout', () => {
    const ok = run({ tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'src/a.ts'), old_string: 'a', new_string: 'b' } });
    expect([ok.status, ok.stdout]).toEqual([0, '']);
    const bad = run('{не json');
    expect([bad.status, bad.stdout]).toEqual([0, '']);
  });

  it('новый vitest.config.ts (файла ещё нет) — без вопросов', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'protect-gates-'));
    const r = run({ tool_name: 'Write', tool_input: { file_path: path.join(empty, 'vitest.config.ts'), content: CONFIG } }, { CLAUDE_PROJECT_DIR: empty });
    expect([r.status, r.stdout]).toEqual([0, '']);
  });
});
