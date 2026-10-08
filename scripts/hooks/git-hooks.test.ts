// git-хуки commit-msg (без подписей ИИ) и pre-commit (настройки IDE владелицы не уезжают в коммит) — во временном репозитории.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOOKS = path.dirname(fileURLToPath(import.meta.url));
// Без GIT_* из окружения: хук pre-push в linked worktree получает абсолютный GIT_DIR (и GIT_INDEX_FILE и т. п.), и с
// ним git init / config / commit временного репозитория уходили в настоящий — 04.10.2026 так в общий .git/config
// записались core.bare = true и core.hooksPath, а тестовые коммиты легли в ветку.
const env = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-git-hooks-'));
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8', env: env() });
  git('init', '-q', '-b', 'main');
  git('config', 'core.hooksPath', HOOKS);
  const write = (file: string, text = 'x') => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  return { dir, git, write };
}

describe('commit-msg', () => {
  const check = (message: string) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-msg-')), 'MSG');
    fs.writeFileSync(file, message);
    return spawnSync(path.join(HOOKS, 'commit-msg'), [file], { encoding: 'utf8' });
  };

  it.each([
    'Друзья: заявки\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
    'Fix\n\nco-authored-by: Someone <noreply@anthropic.com>',
    'Fix\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    'Fix\n\nClaude-Session: https://claude.ai/code/session_1',
    'Fix\n\nсм. claude.ai/code',
  ])('отклоняет подпись: %s', (message) => {
    const r = check(message);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('подпись ИИ-ассистента');
    expect(r.stderr).toMatch(/^ {2}\d+: /m);
  });

  it.each([
    'Друзья: заявки по @username',
    'Fix\n\nCo-Authored-By: Darya <darya@example.com>',
    'Сгенерировано скриптом\n\nGenerated with pnpm bot:setup',
    // Комментарии git и всё ниже «ножниц» в коммит не попадают.
    'Fix\n# Co-Authored-By: Claude <noreply@anthropic.com>',
    'Fix\n# ------------------------ >8 ------------------------\n+Co-Authored-By: Claude <noreply@anthropic.com>',
  ])('пропускает: %s', (message) => {
    expect(check(message).status).toBe(0);
  });

  it('нет файла сообщения — не мешает', () => {
    expect(spawnSync(path.join(HOOKS, 'commit-msg'), ['/nonexistent/MSG']).status).toBe(0);
  });
});

describe('git commit с хуками проекта', () => {
  it('обычный коммит проходит', () => {
    const { git, write } = repo();
    write('src/a.ts');
    git('add', '.');
    const r = git('commit', '-q', '-m', 'Обычная правка');
    expect(r.status, r.stderr).toBe(0);
  });

  it('подпись ИИ в сообщении — коммит отклонён', () => {
    const { git, write } = repo();
    write('src/a.ts');
    git('add', '.');
    const r = git('commit', '-q', '-m', 'Правка\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('подпись ИИ-ассистента');
  });

  it.each(['.idea/misc.xml', '.idea/LifeCommit.iml'])('настройки IDE %s — коммит отклонён с подсказкой', (file) => {
    const { git, write } = repo();
    write('src/a.ts');
    write(file);
    git('add', '.');
    const r = git('commit', '-q', '-m', 'Правка');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`  ${file}`);
    expect(r.stderr).toContain('git restore --staged');
  });

  // Решение владелицы 08.10.2026: скиллы и .mcp.json коммитятся обычными PR.
  it.each(['.claude/skills/x/SKILL.md', '.mcp.json'])('%s коммитится', (file) => {
    const { git, write } = repo();
    write(file);
    git('add', '.');
    const r = git('commit', '-q', '-m', 'Правка');
    expect(r.status, r.stderr).toBe(0);
  });

  it('удаление из .idea/ и прочие .claude/* не мешают', () => {
    const { dir, git, write } = repo();
    write('.idea/misc.xml');
    write('.claude/hooks/a.mjs');
    git('add', '.');
    expect(git('commit', '-q', '--no-verify', '-m', 'Исходное состояние').status).toBe(0);
    fs.rmSync(path.join(dir, '.idea/misc.xml'));
    write('.claude/hooks/a.mjs', 'y');
    git('add', '-A');
    const r = git('commit', '-q', '-m', 'Убрали .idea/misc.xml');
    expect(r.status, r.stderr).toBe(0);
  });
});

// 04.10.2026: хук pre-push из отдельной копии репозитория (git worktree) передаёт тестам абсолютный GIT_DIR.
// С ним git init/config/commit временного репозитория шли в настоящий: общий .git/config стал bare, хуки всех
// копий — из чужой папки, тестовые коммиты — в чужую ветку. Временный репозиторий не должен видеть GIT_* родителя.
describe('временный репозиторий изолирован от окружения хука', () => {
  it('чужой GIT_DIR не задевает настоящий репозиторий', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-real-'));
    spawnSync('git', ['init', '-q', '--bare', real], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    const config = () => fs.readFileSync(path.join(real, 'config'), 'utf8');
    const before = config();
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = real;
    try {
      const r = repo();
      r.write('a.txt');
      r.git('add', 'a.txt');
      r.git('commit', '-qm', 'тест');
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
    expect(config()).toBe(before);
    expect(spawnSync('git', ['--git-dir', real, 'rev-list', '--all'], { encoding: 'utf8', env: { PATH: process.env.PATH } }).stdout).toBe('');
  });
});

// Настоящий git: временный репозиторий и ~25 коммитов. В хуке (pnpm coverage, все файлы параллельно, рядом симулятор и
// стенд) это дольше 5 секунд по умолчанию — 06.10.2026 тест упал по сроку, а не по сути; отдельно он идёт ~3 с.
describe('apple-changed.sh: нужна ли перед пушем проверка iOS/Mac', { timeout: 30_000 }, () => {
  const SCRIPT = path.join(HOOKS, '..', 'apple-changed.sh');
  const needed = (dir: string, remote: string, sha: string) => spawnSync('sh', [SCRIPT, remote, sha], { cwd: dir, encoding: 'utf8', env: env() }).status === 0;

  it('правки apple/ или сервера — нужна; только сайт и документы — нет; новая ветка или неизвестный коммит — нужна', () => {
    const { dir, git, write } = repo();
    write('README.md');
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'база');
    const base = git('rev-parse', 'HEAD').stdout.trim();
    const commit = (file: string) => {
      write(file, String(Math.random()));
      git('add', '.');
      git('commit', '-q', '--no-verify', '-m', file);
      return git('rev-parse', 'HEAD').stdout.trim();
    };
    const site = commit('site/index.html');
    expect(needed(dir, base, site)).toBe(false);
    expect(needed(dir, site, commit('docs/landing.md'))).toBe(false);
    for (const file of ['apple/App/X.swift', 'worker/api.ts', 'shared/types.ts', 'supabase/migrations/x.sql', 'src/components/KindIcon.tsx']) {
      const before = git('rev-parse', 'HEAD').stdout.trim();
      expect({ file, needed: needed(dir, before, commit(file)) }).toEqual({ file, needed: true });
    }
    const head = git('rev-parse', 'HEAD').stdout.trim();
    expect(needed(dir, '0000000000000000000000000000000000000000', head)).toBe(true);
    expect(needed(dir, '', head)).toBe(true);
    expect(needed(dir, 'f'.repeat(40), head)).toBe(true);
  });
});

// Настоящий git: временный репозиторий и ~25 коммитов. В хуке (pnpm coverage, все файлы параллельно, рядом симулятор и
// стенд) это дольше 5 секунд по умолчанию — 06.10.2026 тест упал по сроку, а не по сути; отдельно он идёт ~3 с.
describe('android-changed.sh: нужна ли перед пушем проверка Android', { timeout: 30_000 }, () => {
  const SCRIPT = path.join(HOOKS, '..', 'android-changed.sh');
  const needed = (dir: string, remote: string, sha: string) => spawnSync('sh', [SCRIPT, remote, sha], { cwd: dir, encoding: 'utf8', env: env() }).status === 0;

  it('правки android/ или сервера — нужна; только сайт и документы — нет; новая ветка или неизвестный коммит — нужна', () => {
    const { dir, git, write } = repo();
    write('README.md');
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'база');
    const base = git('rev-parse', 'HEAD').stdout.trim();
    const commit = (file: string) => {
      write(file, String(Math.random()));
      git('add', '.');
      git('commit', '-q', '--no-verify', '-m', file);
      return git('rev-parse', 'HEAD').stdout.trim();
    };
    const site = commit('site/index.html');
    expect(needed(dir, base, site)).toBe(false);
    expect(needed(dir, site, commit('docs/landing.md'))).toBe(false);
    // apple/ — не повод проверять Android.
    const apple = git('rev-parse', 'HEAD').stdout.trim();
    expect(needed(dir, apple, commit('apple/App/X.swift'))).toBe(false);
    for (const file of ['android/app/X.kt', 'worker/api.ts', 'shared/types.ts', 'supabase/migrations/x.sql', 'src/components/KindIcon.tsx', 'src/i18n.ts']) {
      const before = git('rev-parse', 'HEAD').stdout.trim();
      expect({ file, needed: needed(dir, before, commit(file)) }).toEqual({ file, needed: true });
    }
    const head = git('rev-parse', 'HEAD').stdout.trim();
    expect(needed(dir, '0000000000000000000000000000000000000000', head)).toBe(true);
    expect(needed(dir, '', head)).toBe(true);
    expect(needed(dir, 'f'.repeat(40), head)).toBe(true);
  });
});
