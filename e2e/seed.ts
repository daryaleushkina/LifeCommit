// Одинаковые данные для проверки экранов: дела, три вида привычек, группа с делом и целью.
import type { Me } from './fixtures';

export async function seed(me: Me, opts: { manyTodos?: boolean } = {}) {
  const todo = (title: string, extra: object = {}) => me.api<{ id: number }>('POST', '/todos', { title, ...extra });
  await todo('Позвонить в банк', { time: '15:00' });
  await todo('Купить корм Тесле');
  const paid = await todo('Оплатить интернет');
  await me.api('PATCH', `/todos/${paid.id}`, { done: true });
  if (opts.manyTodos) for (let i = 1; i <= 12; i++) await todo(`Дело номер ${i}`);
  await me.api('POST', '/tasks', { title: 'Спортзал', kind: 'check', target: 1, schedule: 'daily' });
  await me.api('POST', '/tasks', { title: 'Пить воду', kind: 'count', target: 8, unit: 'стаканов', schedule: 'daily' });
  await me.api('POST', '/tasks', { title: 'Не пить алкоголь', kind: 'abstain', target: 1 });
  const g = await me.api<{ id: number }>('POST', '/groups', { title: 'Семья' });
  await me.api('POST', `/groups/${g.id}/items`, { title: 'Вынести мусор', mode: 'one' });
  await me.api('POST', `/groups/${g.id}/items`, { title: 'Отпуск', mode: 'goal', target: 150000 });
  return { groupId: g.id };
}
