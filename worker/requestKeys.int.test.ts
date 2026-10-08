// Ключ повтора (решение владелицы 04.10.2026: нажали «Добавить» — добавиться должно всё, без дублей).
// Голосовое «Добавить всё» повторяет не дошедшее само; ответ мог потеряться уже после записи — повтор с тем же
// ключом не создаёт вторую строку. Ключ свой у каждой строки и у каждого человека.
import { describe, expect, it, vi } from 'vitest';
import { dbReady, sb, user } from './test/harness';

// В проде лимит выключен; здесь возвращён, чтобы проверить повтор уже заполненной пачки.
vi.mock('../shared/types', async (orig) => ({ ...(await orig<typeof import('../shared/types')>()), FREE_TASK_LIMIT: 2 }));

const ready = await dbReady();
if (!ready) console.warn('тесты ключа повтора пропущены: нет локальной Supabase (pnpm db:start)');

const key = () => `k-${crypto.randomUUID()}`;

describe.skipIf(!ready)('ключ повтора при добавлении', () => {
  it('дела пачкой: повтор с теми же ключами — те же id, ничего не задвоилось; новый ключ — новое дело', async () => {
    const u = await user();
    const keys = [key(), key()];
    const todos = [{ title: 'Купить молоко' }, { title: 'Позвонить маме' }];
    const first = await u.call('POST', '/todos/batch', { todos, keys });
    expect(first.status).toBe(201);
    const again = await u.call('POST', '/todos/batch', { todos, keys });
    expect(again.status).toBe(201);
    expect(again.body.ids).toEqual(first.body.ids);
    const rows = (await sb.from('todos').select('title').eq('user_id', u.id)).data!;
    expect(rows.map((r) => r.title).sort()).toEqual(['Купить молоко', 'Позвонить маме']);
    // Половина пачки уже была (ответ потерялся), второй строки ещё нет — дописывается только она.
    const third = await u.call('POST', '/todos/batch', { todos: [{ title: 'Купить молоко' }, { title: 'Хлеб' }], keys: [keys[0], key()] });
    expect(third.body.ids[0]).toBe(first.body.ids[0]);
    expect((await sb.from('todos').select('id').eq('user_id', u.id)).data).toHaveLength(3);
  });

  it('привычки пачкой: повтор — без дубля, с целью и подзадачами один раз', async () => {
    const u = await user();
    const keys = [key()];
    const tasks = [{ title: 'Читать', kind: 'count', target: 10, unit: 'страниц', subtasks: ['Утром'] }];
    const first = await u.call('POST', '/tasks/batch', { tasks, keys });
    expect(first.status).toBe(201);
    const again = await u.call('POST', '/tasks/batch', { tasks, keys });
    expect(again.status).toBe(201);
    expect(again.body.ids).toEqual(first.body.ids);
    const id = first.body.ids[0] as number;
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toHaveLength(1);
    expect((await sb.from('task_goals').select('task_id').eq('task_id', id)).data).toHaveLength(1);
    expect((await sb.from('task_subtasks').select('title').eq('task_id', id)).data).toEqual([{ title: 'Утром' }]);
  });

  it('сбой после записи привычки и цели откатывает пачку; повтор записывает всё один раз', async () => {
    const u = await user();
    const k = key();
    // Обходим только проверку Worker, чтобы ошибка БД случилась внутри транзакции, на подзадаче.
    // Никаких триггеров или изменений схемы общей базы: пустой title нарушает существующий CHECK.
    const failed = await sb.rpc('insert_tasks', {
      p_user: u.id, p_day: '2026-10-08', p_limit: 2,
      p_tasks: [{ title: 'Читать', kind: 'count', target: 10, step: 1, schedule: 'daily', weekdays: 127, visibility: 'private', position: 0, request_key: `${u.id}:${k}`, subtasks: ['Утром', ''] }],
    });
    expect(failed.error?.code).toBe('23514');
    const rolledBack = await sb.from('tasks').select('id').eq('user_id', u.id);
    expect(rolledBack.error).toBeNull();
    expect(rolledBack.data).toEqual([]);

    const tasks = [{ title: 'Читать', kind: 'count', target: 10, subtasks: ['Утром', 'Вечером'] }];
    const first = await u.call('POST', '/tasks/batch', { tasks, keys: [k] });
    expect(first.status).toBe(201);
    const again = await u.call('POST', '/tasks/batch', { tasks, keys: [k] });
    expect(again.status).toBe(201);
    expect(again.body.ids).toEqual(first.body.ids);
    const id = first.body.ids[0] as number;
    expect((await sb.from('task_goals').select('target').eq('task_id', id)).data).toEqual([{ target: 10 }]);
    expect((await sb.from('task_subtasks').select('title').eq('task_id', id).order('position')).data).toEqual([{ title: 'Утром' }, { title: 'Вечером' }]);
  });

  it('повтор заполненной пачки проходит на лимите; смешанная пачка считает только новые ключи', async () => {
    const u = await user();
    const keys = [key(), key()];
    const tasks = [{ title: 'Читать', kind: 'check' }, { title: 'Гулять', kind: 'check' }];
    const first = await u.call('POST', '/tasks/batch', { tasks: [tasks[0]], keys: [keys[0]] });
    expect(first.status).toBe(201);
    // В пачке два новых ключа, но осталось одно место: даже её первая вставка откатится.
    expect((await u.call('POST', '/tasks/batch', { tasks, keys: [key(), key()] })).status).toBe(402);
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toHaveLength(1);
    const mixed = await u.call('POST', '/tasks/batch', { tasks, keys });
    expect(mixed.status).toBe(201);
    expect(mixed.body.ids[0]).toBe(first.body.ids[0]);
    const again = await u.call('POST', '/tasks/batch', { tasks, keys });
    expect(again.status).toBe(201);
    expect(again.body.ids).toEqual(mixed.body.ids);
    expect(await u.call('POST', '/tasks/batch', { tasks: [tasks[0]], keys: [key()] })).toMatchObject({ status: 402, body: { error: 'task_limit' } });
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toHaveLength(2);
  });

  it('параллельный повтор и одинаковые ключи внутри пачки — одна привычка с зависимостями', async () => {
    const u = await user();
    const k = key();
    const task = { title: 'Читать', kind: 'check', subtasks: ['Утром'] };
    const [a, b] = await Promise.all([
      u.call('POST', '/tasks/batch', { tasks: [task, task], keys: [k, k] }),
      u.call('POST', '/tasks/batch', { tasks: [task], keys: [k] }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.ids).toEqual([b.body.ids[0], b.body.ids[0]]);
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toHaveLength(1);
    expect((await sb.from('task_goals').select('target').eq('task_id', b.body.ids[0])).data).toEqual([{ target: 1 }]);
    expect((await sb.from('task_subtasks').select('title').eq('task_id', b.body.ids[0])).data).toEqual([{ title: 'Утром' }]);
  });

  it('дело в группу: повтор с тем же ключом — то же дело', async () => {
    const u = await user();
    const g = (await u.call('POST', '/groups', { title: 'Семья' })).body.id as number;
    const k = key();
    const item = { title: 'Уборка', mode: 'one' };
    const first = await u.call('POST', `/groups/${g}/items`, { ...item, key: k });
    const again = await u.call('POST', `/groups/${g}/items`, { ...item, key: k });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect((await sb.from('group_items').select('id').eq('group_id', g)).data).toHaveLength(1);
  });

  it('ключ свой у каждого человека: чужой такой же ключ не мешает и ничего не раскрывает', async () => {
    const a = await user();
    const b = await user();
    const keys = [key()];
    const mine = await a.call('POST', '/todos/batch', { todos: [{ title: 'Моё' }], keys });
    const theirs = await b.call('POST', '/todos/batch', { todos: [{ title: 'Чужое' }], keys });
    expect(theirs.status).toBe(201);
    expect(theirs.body.ids[0]).not.toBe(mine.body.ids[0]);
    expect((await sb.from('todos').select('title').eq('user_id', b.id)).data).toEqual([{ title: 'Чужое' }]);
    const tasks = [{ title: 'Читать', kind: 'check' }];
    const mineTask = await a.call('POST', '/tasks/batch', { tasks, keys });
    const theirTask = await b.call('POST', '/tasks/batch', { tasks, keys });
    expect(theirTask.status).toBe(201);
    expect(theirTask.body.ids[0]).not.toBe(mineTask.body.ids[0]);
    const ga = (await a.call('POST', '/groups', { title: 'Моя семья' })).body.id as number;
    const gb = (await b.call('POST', '/groups', { title: 'Их семья' })).body.id as number;
    const mineItem = await a.call('POST', `/groups/${ga}/items`, { title: 'Уборка', mode: 'one', key: keys[0] });
    const theirItem = await b.call('POST', `/groups/${gb}/items`, { title: 'Уборка', mode: 'one', key: keys[0] });
    expect(theirItem.status).toBe(201);
    expect(theirItem.body.id).not.toBe(mineItem.body.id);
  });

  it('без ключей и с негодными ключами — обычное добавление', async () => {
    const u = await user();
    expect((await u.call('POST', '/todos/batch', { todos: [{ title: 'Раз' }] })).status).toBe(201);
    expect((await u.call('POST', '/todos/batch', { todos: [{ title: 'Два' }], keys: 'не список' })).status).toBe(201);
    expect((await u.call('POST', '/todos/batch', { todos: [{ title: 'Три' }], keys: [42] })).status).toBe(201);
    expect((await u.call('POST', '/todos/batch', { todos: [{ title: 'Четыре' }], keys: ['x'.repeat(200)] })).status).toBe(201);
    expect((await sb.from('todos').select('id').eq('user_id', u.id)).data).toHaveLength(4);
  });

  it('негодные ключи привычек и групповых дел тоже не включают защиту от повторов', async () => {
    for (const k of [undefined, 42, '', 'x'.repeat(81)]) {
      const u = await user();
      const tasks = [{ title: 'Читать', kind: 'check' }];
      const a = await u.call('POST', '/tasks/batch', { tasks, keys: [k] });
      const b = await u.call('POST', '/tasks/batch', { tasks, keys: [k] });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(b.body.ids[0]).not.toBe(a.body.ids[0]);
      const g = (await u.call('POST', '/groups', { title: 'Семья' })).body.id as number;
      const first = await u.call('POST', `/groups/${g}/items`, { title: 'Уборка', mode: 'one', key: k });
      const again = await u.call('POST', `/groups/${g}/items`, { title: 'Уборка', mode: 'one', key: k });
      expect(again.status).toBe(201);
      expect(again.body.id).not.toBe(first.body.id);
    }
  });

  it('повтор не даёт доступа к чужой группе или id дела из другой группы', async () => {
    const u = await user();
    const stranger = await user();
    const a = (await u.call('POST', '/groups', { title: 'Первая' })).body.id as number;
    const b = (await u.call('POST', '/groups', { title: 'Вторая' })).body.id as number;
    const k = key();
    const input = { title: 'Уборка', mode: 'one', key: k };
    expect((await u.call('POST', `/groups/${a}/items`, input)).status).toBe(201);
    expect((await stranger.call('POST', `/groups/${a}/items`, input)).status).toBe(404);
    expect(await u.call('POST', `/groups/${b}/items`, input)).toMatchObject({ status: 409, body: { error: 'request_key_conflict' } });
    expect((await sb.from('group_items').select('id').eq('group_id', b)).data).toEqual([]);
  });

  it('неверный JSON и типы полей дают 400, без частичной записи', async () => {
    const u = await user();
    for (const payload of [null, [], { tasks: [null] }, { tasks: [{ title: 'Читать', kind: 'count', target: {} }] }, { tasks: [{ title: 'Читать', kind: 'check', subtasks: [42] }] }]) {
      expect((await u.call('POST', '/tasks/batch', payload)).status).toBe(400);
    }
    expect((await u.call('POST', '/todos/batch', { todos: [{ title: 'Молоко' }, null], keys: [key(), key()] })).status).toBe(400);
    const g = (await u.call('POST', '/groups', { title: 'Семья' })).body.id as number;
    for (const payload of [null, { title: 42, mode: 'one' }, { title: 'Уборка', mode: 'one', assignees: 'все' }]) {
      expect((await u.call('POST', `/groups/${g}/items`, payload)).status).toBe(400);
    }
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect((await sb.from('todos').select('id').eq('user_id', u.id)).data).toEqual([]);
  });
});
