// Лимит бесплатных привычек. С 01.10.2026 его нет (FREE_TASK_LIMIT = null), но проверки остались —
// здесь лимит возвращён (2), чтобы они не сломались незаметно до того дня, когда понадобятся.
import { describe, expect, it, vi } from 'vitest';
import { dbReady, sb, user } from './test/harness';

vi.mock('../shared/types', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/types')>()), FREE_TASK_LIMIT: 2 }));

const ready = await dbReady();
if (!ready) console.warn('api-тесты пропущены: нет локальной Supabase (pnpm db:start)');

const check = (title: string) => ({ title, kind: 'check', target: 1 });

describe.skipIf(!ready)('лимит бесплатных привычек', () => {
  it('без подписки — не больше лимита: по одной, пачкой, из шаблонов и возвратом из отложенных', async () => {
    const u = await user();
    const first = (await u.call('POST', '/tasks', check('Первая'))).body.id;
    expect((await u.call('POST', '/tasks/batch', { tasks: [check('Вторая'), check('Третья')] })).body).toEqual({ error: 'task_limit' });
    expect((await u.call('POST', '/tasks', check('Вторая'))).status).toBe(201);
    expect(await u.call('POST', '/tasks', check('Третья'))).toMatchObject({ status: 402, body: { error: 'task_limit' } });
    expect((await u.call('POST', '/tasks/from-templates', { slugs: ['water'] })).status).toBe(402);
    expect((await u.call('GET', '/today')).body.limits).toEqual({ max_tasks: 2, active: 2 });

    // Отложенная не считается — место освобождается; вернуть её, когда места нет, нельзя.
    await u.call('POST', `/tasks/${first}/archive`);
    expect((await u.call('POST', '/tasks', check('Третья'))).status).toBe(201);
    expect((await u.call('POST', `/tasks/${first}/restore`)).status).toBe(402);
    expect((await sb.from('tasks').select('archived_at').eq('id', first).single()).data?.archived_at).not.toBeNull();
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toHaveLength(3);
  });

  it('с подпиской лимита нет', async () => {
    const u = await user();
    await sb.from('users').update({ premium_until: new Date(Date.now() + 86_400_000).toISOString() }).eq('id', u.id);
    const res = await u.call('POST', '/tasks/batch', { tasks: [check('А'), check('Б'), check('В')] });
    expect(res.status).toBe(201);
    expect((await u.call('GET', '/today')).body.limits).toEqual({ max_tasks: null, active: 3 });
  });
});
