// Синхронизация календарей по расписанию (syncDue). Через cronTick её не проверить: тик берёт подключения
// всей базы, а рядом параллельно идут тесты календарей (calsync.*.int.test.ts) — поэтому база здесь подменённая.
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { syncDue, type AccountRow } from './calsync';
import type { Env } from './env';

/** База в памяти: подключения, люди и что в неё записали. Цепочки запросов отвечают сразу. */
function fakeDb(accounts: Partial<AccountRow>[], users: { id: number; timezone: string; day_start_hour: number }[]) {
  const writes: { table: string; values: unknown; filters: Record<string, unknown> }[] = [];
  const asked: { table: string; filters: Record<string, unknown>; limit?: number }[] = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let values: unknown = null;
    let limit: number | undefined;
    const q = {
      select: () => q,
      order: () => q,
      maybeSingle: () => q,
      limit: (n: number) => ((limit = n), q),
      eq: (k: string, v: unknown) => ((filters[k] = v), q),
      update: (v: unknown) => ((values = v), q),
      then: (ok: (r: unknown) => unknown, fail: (e: unknown) => unknown) => {
        if (values) writes.push({ table, values, filters });
        else asked.push({ table, filters, limit });
        const data = table === 'users' ? (users.find((u) => u.id === filters.id) ?? null) : accounts;
        return Promise.resolve({ data, error: null }).then(ok, fail);
      },
    };
    return q;
  };
  return { sb: { from } as unknown as SupabaseClient, writes, asked };
}

const env = { CALENDAR_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;

describe('syncDue', () => {
  it('без ключа календарей ничего не делает', async () => {
    const db = fakeDb([{ id: 1, user_id: 1, status: 'ok' }], []);
    await syncDue({ ...env, CALENDAR_KEY: '' }, db.sb);
    expect(db.asked).toEqual([]);
  });

  it('берёт до 4 рабочих подключений; человека нет — пропускает; сбой одного не мешает остальным', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = fakeDb(
      [
        // человека уже нет
        { id: 1, user_id: 404, status: 'ok' },
        // ждёт выбора календарей — синхронизировать нечего
        { id: 2, user_id: 7, status: 'setup' },
        // секрет не расшифровывается — подключение помечается «ошибка», цикл идёт дальше
        { id: 3, user_id: 7, provider: 'apple', status: 'ok', secret: 'broken' },
        { id: 4, user_id: 7, status: 'setup' },
      ],
      [{ id: 7, timezone: 'Europe/Moscow', day_start_hour: 4 }],
    );
    await syncDue(env, db.sb);
    expect(db.asked[0]).toEqual({ table: 'calendar_accounts', filters: { status: 'ok' }, limit: 4 });
    expect(db.asked.filter((a) => a.table === 'users').map((a) => a.filters.id)).toEqual([404, 7, 7, 7]);
    expect(db.writes).toEqual([{ table: 'calendar_accounts', values: { status: 'error', last_error: expect.any(String) }, filters: { id: 3 } }]);
    expect(errors).toHaveBeenCalledWith('calendar pull failed', 3, expect.anything());
    errors.mockRestore();
  });
});
