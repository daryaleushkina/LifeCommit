// Ответы на ошибки запроса и передача групп при удалении аккаунта.
import { describe, expect, it } from 'vitest';
import { dbReady, sb, user } from './test/harness';

const ready = await dbReady();

describe.skipIf(!ready)('ошибки запроса', () => {
  it('тело не JSON — 400 bad_json, а не 500', async () => {
    const u = await user();
    const res = await u.call('POST', '/tasks', 'это не json');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad_json' });
  });
});

describe.skipIf(!ready)('удаление аккаунта и группы', () => {
  it('группа переходит самому давнему участнику; без участников — в архив', async () => {
    const owner = await user();
    const masha = await user();
    const lonely = await user();
    const { body: g } = await owner.call('POST', '/groups', { title: 'Семья' });
    const { body: inv } = await owner.call('POST', `/groups/${g.id}/invite`);
    await masha.call('POST', `/invites/${inv.code}/join`);
    const { body: solo } = await lonely.call('POST', '/groups', { title: 'Только я' });
    expect((await owner.call('DELETE', '/account')).status).toBe(200);
    expect((await lonely.call('DELETE', '/account')).status).toBe(200);
    const family = (await sb.from('groups').select('owner_id, archived_at').eq('id', g.id).single()).data;
    expect(family).toEqual({ owner_id: masha.id, archived_at: null });
    const role = (await sb.from('group_members').select('role').eq('group_id', g.id).eq('user_id', masha.id).single()).data;
    expect(role?.role).toBe('owner');
    const alone = (await sb.from('groups').select('archived_at').eq('id', solo.id).single()).data;
    expect(alone?.archived_at).not.toBeNull();
  });
});
