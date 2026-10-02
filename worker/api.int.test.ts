// Сервер целиком: вход, привычки, отметки, «Сегодня», карта, итог, дела, настройки, аккаунт.
import { describe, expect, it } from 'vitest';
import { dbReady, request, sb, user } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('api-тесты пропущены: нет локальной Supabase (pnpm db:start)');

describe.skipIf(!ready)('вход', () => {
  it('без initData — 401, с чужой подписью — 401', async () => {
    expect((await request('/api/today')).status).toBe(401);
    const forged = await request('/api/today', { headers: { Authorization: 'tma user=%7B%22id%22%3A1%7D&hash=bad' } });
    expect(forged.status).toBe(401);
  });

  it('первая сессия заводит пользователя (is_new), вторая — нет; часовой пояс берётся с телефона', async () => {
    const u = await user({ timezone: 'Asia/Ho_Chi_Minh' });
    const again = await u.call('POST', '/session', { timezone: 'Asia/Ho_Chi_Minh' });
    expect(again.status).toBe(200);
    expect(again.body.is_new).toBe(false);
    const { data } = await sb.from('users').select('timezone').eq('id', u.id).single();
    expect(data?.timezone).toBe('Asia/Ho_Chi_Minh');
  });

  it('неразборчивая initData — 401, а не 500', async () => {
    const res = await request('/api/today', { headers: { Authorization: 'tma hash=mock-hash-not-valid-for-backend&user=not-json' } });
    expect(res.status).toBe(401);
  });

  it('неизвестный адрес API — 404 в JSON', async () => {
    const u = await user();
    const res = await u.call('GET', '/no-such-route');
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!ready)('привычки и отметки', () => {
  it('создать три вида, отметить, «Сегодня» показывает отметки', async () => {
    const u = await user();
    const check = await u.call('POST', '/tasks', { title: 'Спортзал', kind: 'check', target: 1, schedule: 'daily' });
    const count = await u.call('POST', '/tasks', { title: 'Вода', kind: 'count', target: 8, unit: 'стаканов', schedule: 'daily' });
    const quit = await u.call('POST', '/tasks', { title: 'Без сладкого', kind: 'abstain', target: 1 });
    for (const r of [check, count, quit]) expect(r.status).toBeLessThan(300);
    const today = await u.call('GET', '/today');
    const day = today.body.day as string;
    await u.call('PUT', '/logs', { task_id: check.body.id, value: 1, day });
    await u.call('PUT', '/logs', { task_id: count.body.id, value: 5, day });
    await u.call('PUT', '/logs', { task_id: quit.body.id, value: null, status: 'clean', day });
    const after = await u.call('GET', '/today');
    const byTitle = Object.fromEntries((after.body.tasks as { title: string; value: number; status: string | null }[]).map((t) => [t.title, t]));
    expect(byTitle['Спортзал']!.value).toBe(1);
    expect(byTitle['Вода']!.value).toBe(5);
    expect(byTitle['Без сладкого']!.status).toBe('clean');
  });

  it('пустое название и неизвестный вид — 400', async () => {
    const u = await user();
    expect((await u.call('POST', '/tasks', { title: '', kind: 'check', target: 1 })).status).toBe(400);
    expect((await u.call('POST', '/tasks', { title: 'X', kind: 'weird', target: 1 })).status).toBe(400);
  });

  it('чужую привычку нельзя отметить, поправить, удалить, посмотреть историю', async () => {
    const owner = await user();
    const other = await user();
    const { body } = await owner.call('POST', '/tasks', { title: 'Моё', kind: 'check', target: 1, schedule: 'daily' });
    const day = (await other.call('GET', '/today')).body.day;
    expect((await other.call('PUT', '/logs', { task_id: body.id, value: 1, day })).status).toBeGreaterThanOrEqual(400);
    expect((await other.call('PATCH', `/tasks/${body.id}`, { title: 'Чужое' })).status).toBeGreaterThanOrEqual(400);
    // Удаление чужого — пустая операция (как «удалить то, чего у тебя нет»): ответ 200, данные целы.
    await other.call('DELETE', `/tasks/${body.id}`);
    expect((await other.call('GET', `/tasks/${body.id}/history`)).status).toBe(404);
    const { data } = await sb.from('tasks').select('title').eq('id', body.id).single();
    expect(data?.title).toBe('Моё');
  });

  it('правка, «Отложить» и вернуть, удалить; история', async () => {
    const u = await user();
    const { body } = await u.call('POST', '/tasks', { title: 'Читать', kind: 'count', target: 20, unit: 'страниц', schedule: 'daily' });
    expect((await u.call('PATCH', `/tasks/${body.id}`, { title: 'Читать книгу', target: 30 })).status).toBe(200);
    expect((await u.call('POST', `/tasks/${body.id}/archive`)).status).toBe(200);
    expect((await u.call('GET', '/today')).body.tasks.some((t: { id: number }) => t.id === body.id)).toBe(false);
    expect((await u.call('POST', `/tasks/${body.id}/restore`)).status).toBe(200);
    const history = await u.call('GET', `/tasks/${body.id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.goals.length).toBeGreaterThan(0);
    expect((await u.call('DELETE', `/tasks/${body.id}`)).status).toBe(200);
    const { data } = await sb.from('tasks').select('id').eq('id', body.id);
    expect(data).toEqual([]);
  });

  it('пачкой (как из голоса) и из шаблонов', async () => {
    const u = await user();
    const batch = await u.call('POST', '/tasks/batch', { tasks: [{ title: 'А', kind: 'check', target: 1 }, { title: 'Б', kind: 'count', target: 3 }] });
    expect(batch.status).toBeLessThan(300);
    expect(batch.body.ids).toHaveLength(2);
    const { data: made } = await sb.from('tasks').select('title').eq('user_id', u.id);
    expect(made?.map((t) => t.title).sort()).toEqual(['А', 'Б']);
    const templates = await u.call('GET', '/templates');
    expect(templates.status).toBe(200);
    expect(Array.isArray(templates.body)).toBe(true);
    if (templates.body.length) {
      const res = await u.call('POST', '/tasks/from-templates', { slugs: [templates.body[0].slug] });
      expect(res.status).toBeLessThan(300);
    }
    expect((await u.call('POST', '/tasks/from-templates', { slugs: [] })).status).toBe(400);
  });
});

describe.skipIf(!ready)('карта и итог', () => {
  it('карта за год и итог по привычкам за период', async () => {
    const u = await user();
    const { body } = await u.call('POST', '/tasks', { title: 'Испанский', kind: 'count', target: 20, unit: 'слов', schedule: 'daily' });
    const day = (await u.call('GET', '/today')).body.day as string;
    await u.call('PUT', '/logs', { task_id: body.id, value: 40, day });
    const heat = await u.call('GET', '/heatmap?days=30');
    expect(heat.status).toBe(200);
    expect(heat.body.days.find((d: { day: string }) => d.day === day)?.score).toBeGreaterThan(0);
    const sum = await u.call('GET', `/summary?from=${day.slice(0, 8)}01&to=${day}`);
    expect(sum.status).toBe(200);
    expect(sum.body).toEqual([expect.objectContaining({ title: 'Испанский', total: 40 })]);
  });

  it('итог: неверный период — 400', async () => {
    const u = await user();
    expect((await u.call('GET', '/summary?from=2026-10-10&to=2026-10-01')).status).toBe(400);
    expect((await u.call('GET', '/summary?from=2024-01-01&to=2026-01-01')).status).toBe(400);
    expect((await u.call('GET', '/summary?from=bad&to=2026-01-01')).status).toBe(400);
  });
});

describe.skipIf(!ready)('дела', () => {
  it('добавить, отметить, перенести, со временем, удалить; «Потом»', async () => {
    const u = await user();
    const day = (await u.call('GET', '/today')).body.day as string;
    const a = await u.call('POST', '/todos', { title: 'Купить хлеб' });
    expect(a.status).toBeLessThan(300);
    expect((await u.call('PATCH', `/todos/${a.body.id}`, { done: true })).status).toBe(200);
    expect((await u.call('PATCH', `/todos/${a.body.id}`, { time: '15:00', title: 'Купить хлеб и молоко' })).status).toBe(200);
    const tomorrow = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect((await u.call('PATCH', `/todos/${a.body.id}`, { day: tomorrow, done: false })).status).toBe(200);
    const later = await u.call('GET', '/todos/later');
    expect(later.body.some((t: { title: string }) => t.title === 'Купить хлеб и молоко')).toBe(true);
    const cal = await u.call('GET', `/calendar?from=${day}&to=${tomorrow}`);
    expect(cal.status).toBe(200);
    expect((await u.call('DELETE', `/todos/${a.body.id}`)).status).toBe(200);
    const batch = await u.call('POST', '/todos/batch', { todos: [{ title: 'Раз' }, { title: 'Два', day: tomorrow }] });
    expect(batch.body.ids).toHaveLength(2);
  });

  it('пустое название — 400; чужое дело — не найдено', async () => {
    const u = await user();
    const other = await user();
    expect((await u.call('POST', '/todos', { title: '   ' })).status).toBe(400);
    const { body } = await u.call('POST', '/todos', { title: 'Моё дело' });
    expect((await other.call('PATCH', `/todos/${body.id}`, { done: true })).status).toBeGreaterThanOrEqual(400);
    await other.call('DELETE', `/todos/${body.id}`);
    const { data } = await sb.from('todos').select('title').eq('id', body.id);
    expect(data).toEqual([{ title: 'Моё дело' }]);
  });

  it('календарь: слишком длинный промежуток — 400', async () => {
    const u = await user();
    expect((await u.call('GET', '/calendar?from=2026-01-01&to=2026-12-31')).status).toBe(400);
  });
});

describe.skipIf(!ready)('настройки и аккаунт', () => {
  it('настройки читаются и меняются, аккаунт удаляется со всеми данными', async () => {
    const u = await user();
    expect((await u.call('GET', '/me')).status).toBe(200);
    expect((await u.call('PATCH', '/settings', { remind_evening: '21:00', day_start_hour: 5 })).status).toBe(200);
    const me = await u.call('GET', '/me');
    expect(me.body.day_start_hour).toBe(5);
    await u.call('POST', '/tasks', { title: 'Х', kind: 'check', target: 1 });
    expect((await u.call('DELETE', '/account')).status).toBe(200);
    const { data } = await sb.from('tasks').select('id').eq('user_id', u.id);
    expect(data).toEqual([]);
  });
});
