import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { insertTasks, insertTodos, type UserRow } from './api';

vi.mock('../shared/types', async (orig) => ({ ...(await orig<typeof import('../shared/types')>()), FREE_TASK_LIMIT: 2 }));

const user: UserRow = {
  id: 7, first_name: 'Даша', username: null, photo_url: null, language_code: 'ru', timezone: 'UTC', day_start_hour: 4,
  remind_morning: null, remind_evening: null, bot_chat_ok: false, premium_until: null,
};
const task = { title: 'Читать', kind: 'count', target: 10, subtasks: ['Утром'] };

function database(result: { data: unknown; error: { message: string } | null } = { data: [11], error: null }) {
  const rpc = vi.fn(async () => result);
  const from = vi.fn();
  return { sb: { rpc, from } as unknown as SupabaseClient, rpc, from };
}

describe('добавление привычки с зависимостями', () => {
  it('отправляет цель и подзадачи вместе с ключом одним запросом к базе, с текущим лимитом', async () => {
    const { sb, rpc, from } = database();
    expect(await insertTasks(sb, user, [task], ['7:row'])).toEqual([11]);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('insert_tasks', expect.objectContaining({
      p_user: 7, p_limit: 2,
      p_tasks: [expect.objectContaining({ title: 'Читать', request_key: '7:row', target: 10, subtasks: ['Утром'] })],
    }));
  });

  it('без ключа сохраняет обычное добавление; премиум не ограничивается', async () => {
    const { sb, rpc } = database();
    await insertTasks(sb, { ...user, premium_until: new Date(Date.now() + 86_400_000).toISOString() }, [{ title: 'Гулять', kind: 'check' }]);
    expect(rpc).toHaveBeenCalledWith('insert_tasks', expect.objectContaining({ p_limit: null, p_tasks: [expect.objectContaining({ request_key: null, target: 1, subtasks: [] })] }));
  });

  it('лимит в транзакции возвращает 402, ошибка записи — 500', async () => {
    await expect(insertTasks(database({ data: null, error: { message: 'task_limit' } }).sb, user, [task])).rejects.toMatchObject({ status: 402, message: 'task_limit' });
    await expect(insertTasks(database({ data: null, error: { message: 'db_down' } }).sb, user, [task])).rejects.toMatchObject({ status: 500, message: 'db_down' });
  });

  it('неполный или неверный ответ базы не считается успешным добавлением', async () => {
    for (const data of [null, {}, [], ['11'], [1.5], [11, 12]]) {
      await expect(insertTasks(database({ data, error: null }).sb, user, [task])).rejects.toMatchObject({ status: 500, message: 'bad_insert_result' });
    }
  });

  it('неверная строка отклоняется до записи всей пачки, с 400', async () => {
    const { sb, rpc } = database();
    for (const invalid of [null, [], 42, { ...task, title: {} }, { ...task, kind: 'limit' }, { ...task, target: '10' }, { ...task, target: Infinity }, { ...task, target: 1e99 }, { ...task, subtasks: 'утром' }, { ...task, subtasks: [1] }, { ...task, emoji: {} }, { ...task, unit: [] }, { ...task, schedule: {} }, { ...task, weekdays: [] }, { ...task, per_week: '2' }, { ...task, visibility: 'public' }, { title: 'Бросить', kind: 'abstain', last_slip_on: 42 }]) {
      await expect(insertTasks(sb, user, [task, invalid])).rejects.toMatchObject({ status: 400 });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('проверяет дела перед записью, а пустой список не пишет', async () => {
    const { sb, from } = database();
    for (const invalid of [null, {}, { title: 42 }, { title: 'Молоко', time: {} }, { title: 'Молоко', day: {} }, { title: 'Молоко', location: {} }, { title: 'Молоко', duration_min: '10' }]) {
      await expect(insertTodos(sb, user, [{ title: 'Хлеб' }, invalid])).rejects.toMatchObject({ status: 400 });
    }
    expect(await insertTodos(sb, user, [])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
