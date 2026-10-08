import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { insertKeyed, MAX_KEY, requestKeys } from './requestKey';

describe('ключи повтора от клиента', () => {
  it('годные — свои для человека, по одному на строку', () => {
    expect(requestKeys(['a', 'b'], 2, 7)).toEqual(['7:a', '7:b']);
  });
  it('нет ключей или не список — все null (обычное добавление)', () => {
    expect(requestKeys(undefined, 2, 7)).toEqual([null, null]);
    expect(requestKeys('a', 1, 7)).toEqual([null]);
  });
  it('негодный ключ (не строка, пустой, слишком длинный) — null только у этой строки; ключей меньше строк — null', () => {
    expect(requestKeys([42, '', 'x'.repeat(MAX_KEY + 1), 'x'.repeat(MAX_KEY)], 5, 1)).toEqual([null, null, null, `1:${'x'.repeat(MAX_KEY)}`, null]);
    expect(requestKeys([null, {}, [], 'bad\0key'], 4, 1)).toEqual([null, null, null, null]);
  });
});

type Result = { data: unknown; error: { message: string } | null };
const result = (data: unknown): Result => ({ data, error: null });
function database(results: Result[]) {
  const queries = results.map((res) => {
    const q = {
      insert: vi.fn(() => q), upsert: vi.fn(() => q), select: vi.fn(() => q), in: vi.fn(() => q), eq: vi.fn(() => q),
      then: (...args: Parameters<Promise<Result>['then']>) => Promise.resolve(res).then(...args),
    };
    return q;
  });
  let index = 0;
  const from = vi.fn(() => queries[index++]!);
  return { sb: { from } as unknown as SupabaseClient, from, queries };
}

describe('запись дел с ключами', () => {
  it('без ключей — обычные новые строки; пустой список не ходит в базу', async () => {
    const db = database([result([{ id: 1 }, { id: 2 }])]);
    expect(await insertKeyed(db.sb, 'todos', [{ title: 'Хлеб' }, { title: 'Молоко' }], [], { user_id: 7 })).toEqual({ ids: [1, 2], fresh: [true, true] });
    expect(db.queries[0]!.insert).toHaveBeenCalledWith([{ title: 'Хлеб' }, { title: 'Молоко' }]);
    expect(await insertKeyed(db.sb, 'todos', [], [], { user_id: 7 })).toEqual({ ids: [], fresh: [] });
    expect(db.from).toHaveBeenCalledOnce();
  });

  it('повтор и новая строка возвращают id в порядке запроса, с ограничением пользователя', async () => {
    const db = database([
      result([{ id: 3, request_key: '7:new' }]),
      result([{ id: 3, request_key: '7:new' }, { id: 2, request_key: '7:old' }]),
    ]);
    expect(await insertKeyed(db.sb, 'todos', [{ title: 'Молоко' }, { title: 'Хлеб' }], ['7:old', '7:new'], { user_id: 7 })).toEqual({ ids: [2, 3], fresh: [false, true] });
    expect(db.queries[0]!.upsert).toHaveBeenCalledWith(expect.any(Array), { onConflict: 'request_key', ignoreDuplicates: true });
    expect(db.queries[1]!.eq).toHaveBeenCalledWith('user_id', 7);
  });

  it('смешанная пачка: ключи, повтор и обычная строка сохраняют порядок', async () => {
    const db = database([result([{ id: 4 }]), result([]), result([{ id: 2, request_key: '7:old' }])]);
    expect(await insertKeyed(db.sb, 'todos', [{ title: 'Молоко' }, { title: 'Хлеб' }], ['7:old', null], { user_id: 7 })).toEqual({ ids: [2, 4], fresh: [false, true] });
  });

  it('повтор группового дела ограничивается автором и текущей группой', async () => {
    const db = database([result([]), result([{ id: 9, request_key: '7:g' }])]);
    expect(await insertKeyed(db.sb, 'group_items', [{ title: 'Уборка' }], ['7:g'], { group_id: 10, created_by: 7 })).toEqual({ ids: [9], fresh: [false] });
    expect(db.queries[1]!.eq.mock.calls).toEqual([['group_id', 10], ['created_by', 7]]);
  });

  it('ключ из другой группы не возвращает её id', async () => {
    const db = database([result([]), result([])]);
    await expect(insertKeyed(db.sb, 'group_items', [{}], ['7:g'], { group_id: 11, created_by: 7 })).rejects.toMatchObject({ status: 409, message: 'request_key_conflict' });
  });

  it('ошибки записи и поиска не глотаются', async () => {
    const error = { data: null, error: { message: 'down' } };
    for (const keys of [[], ['7:a']]) {
      await expect(insertKeyed(database([error]).sb, 'todos', [{}], keys, { user_id: 7 })).rejects.toMatchObject({ status: 500, message: 'down' });
    }
    await expect(insertKeyed(database([result([]), error]).sb, 'todos', [{}], ['7:a'], { user_id: 7 })).rejects.toMatchObject({ status: 500, message: 'down' });
  });

  it('неверный ответ базы не считается успехом', async () => {
    for (const data of [null, {}, [], [null], [{}], [{ id: '1' }], [{ id: 1.5 }], [{ id: 1, request_key: 42 }]]) {
      await expect(insertKeyed(database([result(data)]).sb, 'todos', [{}], [], { user_id: 7 })).rejects.toMatchObject({ status: 500, message: 'bad_insert_result' });
    }
  });
});
