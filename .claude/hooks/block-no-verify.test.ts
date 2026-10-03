// Хук PreToolUse: агент не обходит git-хуки проекта (block-no-verify.mjs).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decide } from './block-no-verify.mjs';

const HOOK = fileURLToPath(new URL('./block-no-verify.mjs', import.meta.url));
const asTool = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
const run = (stdin: string) => spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });

describe('block-no-verify: блокирует обход хуков', () => {
  it.each([
    'git push --no-verify',
    'git push --no-verify origin main',
    'git commit --no-verify -m "x"',
    'git commit -n -m "x"',
    'git commit -an -m "x"',
    'git push --no-verif origin main', // git принимает однозначный префикс длинного флага
    'git merge --no-verify feature',
    'git -c core.hooksPath=/dev/null push origin main',
    'git -c core.hookspath=/dev/null commit -m x',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/tmp git push',
    'bash -c "git push --no-verify"',
    'pnpm build && git push --no-verify origin main',
    "eval 'git commit -n -m x'",
    'bash <<EOF\ngit push --no-verify\nEOF',
  ])('%s', (command) => {
    expect(decide(asTool(command))).toMatch(/^Обход git-хуков запрещён: .*отключает хуки проекта\./);
  });

  it('причина называет команду и способ обхода', () => {
    expect(decide(asTool('git push --no-verify'))).toContain('флаг --no-verify (-n) в git push');
    expect(decide(asTool('git -c core.hooksPath=x push'))).toContain('подмена core.hooksPath в git push');
  });

  it('слишком сложную команду не пропускает вслепую', () => {
    const huge = `${'$('.repeat(4000)}git push${')'.repeat(4000)}`;
    expect(decide(asTool(huge))).toContain('слишком сложна для разбора');
  });
});

describe('block-no-verify: не мешает обычной работе', () => {
  it.each([
    'git push origin main',
    'git commit -m "почему нельзя --no-verify"',
    'git commit -m -n',
    'git commit -F msg.txt',
    'git log -n 5',
    'head -n 20 worker/api.ts',
    'grep -n "no-verify" scripts/hooks/pre-push',
    'echo git push --no-verify',
    'pnpm typecheck && pnpm coverage',
    '',
  ])('%s', (command) => {
    expect(decide(asTool(command))).toBeNull();
  });

  it('понимает и голую команду, и общий JSON без tool_input', () => {
    expect(decide('git push --no-verify')).not.toBeNull();
    expect(decide(JSON.stringify({ command: 'git push --no-verify' }))).not.toBeNull();
    expect(decide(JSON.stringify({ tool_input: {} }))).toBeNull();
    expect(decide('{не json')).toBeNull();
    expect(decide('null')).toBeNull();
  });
});

describe('block-no-verify: как процесс', () => {
  it('обход — код 2 и причина в stderr, stdout пустой', () => {
    const r = run(asTool('git push --no-verify origin main'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Обход git-хуков запрещён');
    expect(r.stdout).toBe('');
  });

  it('обычная команда — код 0, ничего не печатает (вход обратно в stdout не эхом)', () => {
    const r = run(asTool('git push origin main'));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('вход больше 1 МБ обрезается, а не роняет хук', () => {
    const r = run(asTool(`echo ${'x'.repeat(1_200_000)}`));
    expect(r.status).toBe(0);
  });
});
