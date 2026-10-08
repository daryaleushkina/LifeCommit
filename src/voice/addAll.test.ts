import { describe, expect, it, vi } from 'vitest';
import { newKey, plain, retryable, runAll, withKeys } from './addAll';

const net = () => new TypeError('Failed to fetch');
const http = (status: number, code = 'x') => Object.assign(new Error(code), { status, code });
const noWait = { wait: async () => {} };

describe('ключи повтора', () => {
  it('ключ — 32 шестнадцатеричных знака, каждый раз новый', () => {
    expect(newKey()).toMatch(/^[0-9a-f]{32}$/);
    expect(newKey()).not.toBe(newKey());
  });
  it('withKeys даёт ключ только тем, у кого его нет; plain убирает ключ', () => {
    const rows = withKeys<{ title: string }>([{ title: 'a' }, { title: 'b', key: 'k' }]);
    expect(rows[0]!.key).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[1]!.key).toBe('k');
    expect(plain(rows[1]!)).toEqual({ title: 'b' });
  });
});

describe('что повторять', () => {
  it('обрыв связи и 5xx — повторять; ответ не JSON — тоже; отказ 4xx — нет', () => {
    expect(retryable(net())).toBe(true);
    expect(retryable(http(503))).toBe(true);
    expect(retryable(http(200, 'network'))).toBe(true);
    expect(retryable(http(402, 'task_limit'))).toBe(false);
    expect(retryable(http(403, 'network'))).toBe(false);
    expect(retryable(null)).toBe(true);
  });
});

describe('runAll', () => {
  it('всё дошло с первого раза — ничего не повторяет', async () => {
    const run = vi.fn(async () => {});
    expect(await runAll([{ id: 'a', run }], noWait)).toEqual({ failed: [], error: null });
    expect(run).toHaveBeenCalledOnce();
  });

  it('не дошедшее повторяется само, дошедшее — нет; пауза растёт', async () => {
    const ok = vi.fn(async () => {});
    const flaky = vi.fn().mockRejectedValueOnce(net()).mockRejectedValueOnce(net()).mockResolvedValue({});
    const wait = vi.fn(async () => {});
    expect(await runAll([{ id: 'ok', run: ok }, { id: 'flaky', run: flaky }], { wait, pause: 100 })).toEqual({ failed: [], error: null });
    expect(ok).toHaveBeenCalledOnce();
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[100], [200]]);
  });

  it('связи так и нет — после всех попыток в failed с последней ошибкой', async () => {
    const e = net();
    const down = vi.fn(async () => Promise.reject(e));
    expect(await runAll([{ id: 'g0', run: down }], { ...noWait, attempts: 2 })).toEqual({ failed: ['g0'], error: e });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('отказ по делу не повторяется и важнее обрыва связи', async () => {
    const limit = http(402, 'task_limit');
    const refused = vi.fn(async () => Promise.reject(limit));
    const down = vi.fn(async () => Promise.reject(net()));
    const r = await runAll([{ id: 'habits', run: refused }, { id: 'g0', run: down }], { ...noWait, attempts: 2 });
    expect(r).toEqual({ failed: ['habits', 'g0'], error: limit });
    expect(refused).toHaveBeenCalledOnce();
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('пустой список — сразу без ошибок', async () => {
    expect(await runAll([])).toEqual({ failed: [], error: null });
  });
});
