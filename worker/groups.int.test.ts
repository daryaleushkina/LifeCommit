// Группы из мини-аппа: создать, настроить, пригласить, выйти; дела всех режимов, отметки, цели, календарь, чат.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays } from './day';
import { dbReady, env, sb, tg, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('тесты групп пропущены: нет локальной Supabase (pnpm db:start)');

const todayOf = async (u: TestUser) => (await u.call('GET', '/today')).body.day as string;

/** Группа «Семья»: создатель Даша и участники по порядку вступления. */
async function family(names: string[] = ['Маша']) {
  const owner = await user({ name: 'Даша' });
  const { body } = await owner.call('POST', '/groups', { title: 'Семья', kind: 'family' });
  const id = body.id as number;
  const members: TestUser[] = [];
  for (const name of names) {
    const u = await user({ name });
    await sb.from('group_members').insert({ group_id: id, user_id: u.id, role: 'member' });
    members.push(u);
  }
  return { id, owner, members };
}

async function addItem(u: TestUser, gid: number, body: object): Promise<number> {
  const res = await u.call('POST', `/groups/${gid}/items`, body);
  expect(res.status).toBe(201);
  return res.body.id as number;
}

const item = async (id: number) => (await sb.from('group_items').select('*').eq('id', id).single()).data!;
const groupRow = async (id: number) => (await sb.from('groups').select('*').eq('id', id).single()).data!;
const myGroup = async (u: TestUser, gid: number) => (await u.call('GET', '/groups')).body.find((g: { id: number }) => g.id === gid);

describe.skipIf(!ready)('создать группу: сбой базы', () => {
  afterEach(() => void vi.restoreAllMocks());
  /** Запросы к базе с этими методом и путём (пары подряд) отвечают ошибкой, как будто PostgREST упал. */
  const failDb = (...pairs: string[]) => {
    const real = globalThis.fetch;
    const failing = new Set(pairs.flatMap((p, i) => (i % 2 ? [] : [`${p} ${pairs[i + 1]}`])));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const req = new Request(input as RequestInfo, init);
      if (req.url.startsWith(env.SUPABASE_URL) && failing.has(`${req.method} ${new URL(req.url).pathname}`)) return Response.json({ message: 'boom' }, { status: 500 });
      return real(req);
    });
  };

  // 04.10.2026: группа и создатель — два запроса без транзакции; второй не прошёл — оставалась группа без владельца-участника.
  it('создателя записать не вышло — группы-сироты нет, в лог, ответ 500', async () => {
    const u = await user();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failDb('POST', '/rest/v1/group_members');
    const res = await u.call('POST', '/groups', { title: 'Дача' });
    vi.mocked(globalThis.fetch).mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('group_not_created');
    expect(log).toHaveBeenCalledWith('POST /groups: owner not added', expect.any(Number), u.id, expect.anything());
    expect((await sb.from('groups').select('id').eq('owner_id', u.id)).data).toEqual([]);
  });

  it('и убрать такую группу не вышло — это тоже в лог', async () => {
    const u = await user();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failDb('POST', '/rest/v1/group_members', 'DELETE', '/rest/v1/groups');
    const res = await u.call('POST', '/groups', { title: 'Дача' });
    vi.mocked(globalThis.fetch).mockRestore();
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledWith('POST /groups: orphan not removed', expect.any(Number), expect.anything());
    await sb.from('groups').delete().eq('owner_id', u.id);
  });
});

describe.skipIf(!ready)('группы', () => {
  it('создать: без названия — 400, неизвестный вид — «другое», длинное название обрезается; в списке я — создатель', async () => {
    const u = await user({ name: 'Даша' });
    const empty = await u.call('POST', '/groups', { title: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('no_title');
    expect((await u.call('POST', '/groups', {})).body.error).toBe('no_title');
    const res = await u.call('POST', '/groups', { title: 'Очень'.repeat(20), kind: 'weird' });
    expect(res.status).toBe(201);
    const row = await groupRow(res.body.id);
    expect(row.kind).toBe('other');
    expect(row.title).toHaveLength(60);
    expect(row.owner_id).toBe(u.id);
    const g = await myGroup(u, res.body.id);
    expect(g).toMatchObject({ role: 'owner', kind: 'other', members: [{ id: u.id, name: 'Даша' }], items: [], planned: 0, done: 0 });
  });

  it('экран группы: настройки и «Скоро» только этой группы; чужому и по кривому адресу — 404', async () => {
    const { id, owner } = await family([]);
    const day = await todayOf(owner);
    await addItem(owner, id, { title: 'Сегодняшнее', mode: 'one' });
    await addItem(owner, id, { title: 'Купить корм', mode: 'one', day: addDays(day, 1) });
    await addItem(owner, id, { title: 'Полить цветы', mode: 'one', rrule: 'FREQ=DAILY' });
    await addItem(owner, id, { title: 'Ужин', mode: 'event', day: addDays(day, 3), time: '19:00' });
    // Вторая группа того же человека — её дела на экран первой не попадают.
    const other = (await owner.call('POST', '/groups', { title: 'Работа', kind: 'work' })).body.id;
    await addItem(owner, other, { title: 'Отчёт', mode: 'one', day: addDays(day, 1) });

    const res = await owner.call('GET', `/groups/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, title: 'Семья', role: 'owner' });
    expect(res.body.settings).toEqual({ admins_only_edit: false, rating_enabled: false, chat_digest: true, chat_reminders: true, tg_chat_title: null });
    const upcoming = res.body.upcoming as { day: string; group: { id: number }; items: { title: string }[] }[];
    expect(upcoming.every((b) => b.group.id === id)).toBe(true);
    const titles = (d: string) => upcoming.find((b) => b.day === d)?.items.map((x) => x.title) ?? [];
    expect(titles(addDays(day, 1))).toEqual(expect.arrayContaining(['Купить корм', 'Полить цветы']));
    expect(titles(addDays(day, 3))).toContain('Ужин');
    expect(titles(addDays(day, 2))).toEqual(['Полить цветы']);
    expect(upcoming.flatMap((b) => b.items.map((x) => x.title))).not.toContain('Сегодняшнее');
    expect(upcoming).toHaveLength(14);

    const outsider = await user();
    expect((await outsider.call('GET', `/groups/${id}`)).status).toBe(404);
    expect((await owner.call('GET', '/groups/abc')).status).toBe(404);
    expect((await owner.call('GET', '/groups/0')).status).toBe(404);
    expect((await owner.call('GET', '/groups/1.5')).status).toBe(404);
  });

  it('настройки меняют создатель и админ, участник — нет; мусор пропускается', async () => {
    const { id, owner, members: [masha] } = await family();
    expect((await masha.call('PATCH', `/groups/${id}`, { title: 'Моя' })).status).toBe(403);
    const res = await owner.call('PATCH', `/groups/${id}`, { title: '  Дом  ', kind: 'pair', admins_only_edit: true, chat_digest: false, rating_enabled: 'да' });
    expect(res.status).toBe(200);
    expect(await groupRow(id)).toMatchObject({ title: 'Дом', kind: 'pair', admins_only_edit: true, chat_digest: false, rating_enabled: false });
    // Пустое и неверное — ничего не меняет.
    expect((await owner.call('PATCH', `/groups/${id}`, { title: '   ', kind: 'weird' })).status).toBe(200);
    expect((await owner.call('PATCH', `/groups/${id}`, {})).status).toBe(200);
    expect(await groupRow(id)).toMatchObject({ title: 'Дом', kind: 'pair' });
    await sb.from('group_members').update({ role: 'admin' }).eq('group_id', id).eq('user_id', masha.id);
    expect((await masha.call('PATCH', `/groups/${id}`, { chat_reminders: false, rating_enabled: true })).status).toBe(200);
    expect(await groupRow(id)).toMatchObject({ chat_reminders: false, rating_enabled: true });
  });

  it('удалить группу может только создатель: группа в архиве, дела остаются в базе', async () => {
    const { id, owner, members: [masha] } = await family();
    const it1 = await addItem(owner, id, { title: 'Посуда', mode: 'one' });
    await sb.from('group_members').update({ role: 'admin' }).eq('group_id', id).eq('user_id', masha.id);
    expect((await masha.call('DELETE', `/groups/${id}`)).status).toBe(403);
    expect((await owner.call('DELETE', `/groups/${id}`)).status).toBe(200);
    expect((await groupRow(id)).archived_at).not.toBeNull();
    expect((await item(it1)).title).toBe('Посуда');
    expect(await myGroup(owner, id)).toBeUndefined();
    expect((await owner.call('GET', `/groups/${id}`)).status).toBe(404);
    expect((await owner.call('POST', `/groups/${id}/items`, { title: 'Ещё', mode: 'one' })).status).toBe(404);
    // Чата не было — в Telegram никто не писал.
    expect(tg.calls).toEqual([]);
  });

  it('выйти: участник уходит; создатель передаёт группу самому давнему; ушёл последний — архив', async () => {
    const { id, owner, members: [masha, petya] } = await family(['Маша', 'Петя']);
    expect((await masha.call('POST', `/groups/${id}/leave`)).status).toBe(200);
    expect((await sb.from('group_members').select('user_id').eq('group_id', id).eq('user_id', masha.id)).data).toEqual([]);
    expect((await owner.call('POST', `/groups/${id}/leave`)).status).toBe(200);
    expect((await groupRow(id)).owner_id).toBe(petya.id);
    expect((await sb.from('group_members').select('role').eq('group_id', id).eq('user_id', petya.id).single()).data?.role).toBe('owner');
    expect((await petya.call('POST', `/groups/${id}/leave`)).status).toBe(200);
    expect((await groupRow(id)).archived_at).not.toBeNull();
    expect((await petya.call('POST', `/groups/${id}/leave`)).status).toBe(404);
  });
});

describe.skipIf(!ready)('приглашения', () => {
  it('ссылка на неделю; по ней видно группу и кто зовёт; вступить можно и повторно — без дублей', async () => {
    const { id, owner } = await family([]);
    const inv = await owner.call('POST', `/groups/${id}/invite`);
    expect(inv.status).toBe(201);
    expect(inv.body.code).toMatch(/^[a-z2-9]{10}$/);
    expect(inv.body.link).toBe(`https://t.me/LifeCommit_bot?startapp=g_${inv.body.code}`);
    const week = Date.parse(inv.body.expires_at) - Date.now();
    expect(week).toBeGreaterThan(6.9 * 86_400_000);
    expect(week).toBeLessThanOrEqual(7 * 86_400_000);

    const guest = await user({ name: 'Гость' });
    const view = await guest.call('GET', `/invites/${inv.body.code}`);
    expect(view.status).toBe(200);
    expect(view.body).toEqual({ group: { id, title: 'Семья', kind: 'family', color: null }, inviter: 'Даша', members: [{ id: owner.id, name: 'Даша' }], member: false });
    expect((await guest.call('POST', `/invites/${inv.body.code}/join`)).body).toEqual({ id });
    expect((await guest.call('POST', `/invites/${inv.body.code}/join`)).status).toBe(200);
    const rows = (await sb.from('group_members').select('role').eq('group_id', id).eq('user_id', guest.id)).data;
    expect(rows).toEqual([{ role: 'member' }]);
    const again = await guest.call('GET', `/invites/${inv.body.code}`);
    expect(again.body.member).toBe(true);
    expect(again.body.members).toHaveLength(2);

    // Не участник позвать не может.
    const outsider = await user();
    expect((await outsider.call('POST', `/groups/${id}/invite`)).status).toBe(404);
  });

  it('просроченная — 410; неизвестная, без группы и от удалённой группы — 404; без срока — действует', async () => {
    const { id, owner } = await family([]);
    const guest = await user();
    const code = (s: string) => `t${s}${Math.random().toString(36).slice(2, 10)}`;
    const old = code('old');
    await sb.from('invites').insert({ code: old, inviter_id: owner.id, group_id: id, expires_at: new Date(Date.now() - 60_000).toISOString() });
    expect((await guest.call('GET', `/invites/${old}`)).status).toBe(410);
    const join = await guest.call('POST', `/invites/${old}/join`);
    expect(join.status).toBe(410);
    expect(join.body.error).toBe('invite_expired');
    expect((await sb.from('group_members').select('user_id').eq('group_id', id).eq('user_id', guest.id)).data).toEqual([]);

    expect((await guest.call('GET', '/invites/nosuchcode')).status).toBe(404);
    const personal = code('me');
    await sb.from('invites').insert({ code: personal, inviter_id: owner.id });
    expect((await guest.call('GET', `/invites/${personal}`)).status).toBe(404);

    const forever = code('ever');
    await sb.from('invites').insert({ code: forever, inviter_id: owner.id, group_id: id, expires_at: null });
    expect((await guest.call('GET', `/invites/${forever}`)).status).toBe(200);

    await owner.call('DELETE', `/groups/${id}`);
    expect((await guest.call('GET', `/invites/${forever}`)).body.error).toBe('invite_not_found');
  });
});

describe.skipIf(!ready)('дела группы', () => {
  it('все режимы: кто-то один, назначено (только участникам), по очереди, «Все», цель, мероприятие', async () => {
    const { id, owner, members: [masha] } = await family();
    const outsider = await user();
    const day = await todayOf(owner);

    const one = await item(await addItem(owner, id, { title: '  Купить корм  ', mode: 'one', day: '2026-13-45', rotate: true, due_day: addDays(day, 3) }));
    expect(one).toMatchObject({ title: 'Купить корм', mode: 'one', day, rotate: false, due_day: addDays(day, 3), created_by: owner.id });

    const assigned = await item(await addItem(owner, id, { title: 'Посуда', mode: 'assign', assignees: [masha.id, masha.id, outsider.id, '7'], rrule: 'FREQ=DAILY', time: '21:00' }));
    expect(assigned).toMatchObject({ assignees: [masha.id], rrule: 'FREQ=DAILY', time: '21:00:00', rotate: false });

    const turns = await item(await addItem(owner, id, { title: 'Мусор', mode: 'assign', assignees: [owner.id, masha.id], rotate: true, rrule: 'FREQ=WEEKLY;BYDAY=TU' }));
    expect(turns).toMatchObject({ rotate: true, assignees: [owner.id, masha.id] });

    const all = await item(await addItem(owner, id, { title: 'Зарядка', mode: 'assign', all_members: 1, assignees: null, rrule: 'FREQ=DAILY' }));
    expect(all).toMatchObject({ all_members: true, assignees: [] });

    const unit = { type: 'money', forms: ['₽', '₽', '₽'], currency: '₽' };
    const goal = await item(await addItem(owner, id, { title: 'Отпуск', mode: 'goal', target: 150000, unit, goal_until: '2026-12-31', rotate: true }));
    expect(goal).toMatchObject({ target: 150000, unit, goal_until: '2026-12-31', rotate: false });

    const event = await item(await addItem(owner, id, { title: 'Ужин', mode: 'event', day: addDays(day, 1), time: '19:00', duration_min: 90, due_day: 'потом', goal_until: 'никогда' }));
    expect(event).toMatchObject({ day: addDays(day, 1), time: '19:00:00', duration_min: 90, due_day: null, goal_until: null });

    // Длительность — от минуты до двух недель.
    expect((await item(await addItem(owner, id, { title: 'А', mode: 'one', duration_min: 0 }))).duration_min).toBe(1);
    expect((await item(await addItem(owner, id, { title: 'Б', mode: 'one', duration_min: 99999 }))).duration_min).toBe(20160);
    expect((await item(await addItem(owner, id, { title: 'В', mode: 'one', duration_min: null, time: null }))).duration_min).toBeNull();

    // Участник видит дела группы на «Сегодня»; мероприятие завтра и очередь по вторникам — только в свои дни.
    const g = await myGroup(masha, id);
    const titles = g.items.map((x: { title: string }) => x.title);
    expect(titles).toEqual(expect.arrayContaining(['Купить корм', 'Посуда', 'Зарядка', 'Отпуск']));
    expect(titles).not.toContain('Ужин');
  });

  it('кривые поля — 400: нет названия или режима, цель без числа, неверные время, повтор и число', async () => {
    const { id, owner } = await family([]);
    const post = (body: object) => owner.call('POST', `/groups/${id}/items`, body);
    expect((await post({ mode: 'one' })).body.error).toBe('no_title');
    expect((await post({ title: 'Х' })).body.error).toBe('bad_mode');
    expect((await post({ title: 'Х', mode: 'weird' })).body.error).toBe('bad_mode');
    expect((await post({ title: 'Х', mode: 'goal' })).body.error).toBe('no_target');
    expect((await post({ title: 'Х', mode: 'one', time: '25:00' })).body.error).toBe('bad_time');
    expect((await post({ title: 'Х', mode: 'one', rrule: 'EVERY DAY' })).body.error).toBe('bad_repeat');
    expect((await post({ title: 'Х', mode: 'goal', target: -5 })).body.error).toBe('bad_target');
    expect((await post({ title: 'Х', mode: 'goal', target: 1e12 })).body.error).toBe('bad_target');
    expect((await post({ title: 'Х', mode: 'goal', target: 'много' })).status).toBe(400);
    // Единица цели — снаружи: кривую не храним (её не прочли бы приложения: «Сегодня» не загрузилось бы у всей группы).
    for (const unit of [5, 'книг', { type: 'x' }, { type: 'x', forms: ['а', 'б'] }, { type: 'x', forms: [1, 2, 3] }, { type: '', forms: ['а', 'б', 'в'] }, { type: 'money', forms: ['₽', '₽', '₽'], currency: 7 }]) {
      const res = await post({ title: 'Х', mode: 'goal', target: 5, unit });
      expect(res.status, JSON.stringify(unit)).toBe(400);
      expect(res.body.error, JSON.stringify(unit)).toBe('bad_unit');
    }
    expect((await sb.from('group_items').select('id').eq('group_id', id)).data).toEqual([]);
  });

  it('единица цели: голосовые «₽» и «книг» сохраняются, лишние поля отбрасываются; правка кривой — 400', async () => {
    const { id, owner } = await family([]);
    const money = await addItem(owner, id, { title: 'Отпуск', mode: 'goal', target: 150000, unit: { type: 'money', forms: ['₽', '₽', '₽'], currency: '₽', extra: 'x' } });
    const books = await addItem(owner, id, { title: 'Книги', mode: 'goal', target: 50, unit: { type: 'custom', forms: ['книга', 'книги', 'книг'], icon: null } });
    const units = (await sb.from('group_items').select('id, unit').in('id', [money, books]).order('id')).data?.map((r) => r.unit);
    expect(units).toEqual([{ type: 'money', forms: ['₽', '₽', '₽'], currency: '₽' }, { type: 'custom', forms: ['книга', 'книги', 'книг'] }]);
    const patch = await owner.call('PATCH', `/groups/${id}/items/${books}`, { unit: { type: 'x' } });
    expect(patch.status).toBe(400);
    expect(patch.body.error).toBe('bad_unit');
    expect((await owner.call('PATCH', `/groups/${id}/items/${books}`, { unit: null })).status).toBe(200);
  });

  it('несуществующая дата («30 февраля») — как кривая: день — сегодня, срок — пусто, пропуск — 400; не сбой сервера', async () => {
    const { id, owner } = await family([]);
    const day = await todayOf(owner);
    const res = await owner.call('POST', `/groups/${id}/items`, { title: 'Корм', mode: 'one', rrule: 'FREQ=DAILY', day: '2026-02-30', due_day: '2026-02-31', goal_until: '2026-04-31' });
    expect(res.status).toBe(201);
    expect(await item(res.body.id)).toMatchObject({ day, due_day: null, goal_until: null });
    const skip = await owner.call('POST', `/groups/${id}/items/${res.body.id}/skip`, { day: '2026-02-30' });
    expect(skip.status).toBe(400);
    expect(skip.body.error).toBe('bad_day');
  });

  it('правка по частям: меняется только присланное; смена режима сбрасывает очередь', async () => {
    const { id, owner, members: [masha] } = await family();
    const day = await todayOf(owner);
    const itemId = await addItem(owner, id, { title: 'Мусор', mode: 'assign', assignees: [owner.id, masha.id], rotate: true, rrule: 'FREQ=DAILY', time: '20:00' });
    const patch = (body: object, gid = id, iid = itemId) => owner.call('PATCH', `/groups/${gid}/items/${iid}`, body);

    expect((await patch({ title: 'Вынести мусор' })).status).toBe(200);
    expect(await item(itemId)).toMatchObject({ title: 'Вынести мусор', rotate: true, time: '20:00:00', rrule: 'FREQ=DAILY' });

    await patch({ time: '08:30', rrule: null, duration_min: 30, target: null, unit: null, due_day: addDays(day, 2), goal_until: 'никогда', all_members: false, day: addDays(day, 1) });
    expect(await item(itemId)).toMatchObject({ time: '08:30:00', rrule: null, duration_min: 30, due_day: addDays(day, 2), goal_until: null, day: addDays(day, 1), rotate: true });

    await patch({ time: null, duration_min: null, assignees: [masha.id] });
    expect(await item(itemId)).toMatchObject({ time: null, duration_min: null, assignees: [masha.id] });

    await patch({ mode: 'one' });
    expect(await item(itemId)).toMatchObject({ mode: 'one', rotate: false });

    expect((await patch({})).status).toBe(200);
    expect((await patch({ title: '  ' })).body.error).toBe('no_title');
    expect((await patch({ time: '9:5' })).body.error).toBe('bad_time');

    // Дело другой группы через эту не правится.
    const other = (await owner.call('POST', '/groups', { title: 'Работа' })).body.id;
    const foreign = await addItem(owner, other, { title: 'Отчёт', mode: 'one' });
    expect((await patch({ title: 'Взлом' }, id, foreign)).status).toBe(200);
    expect((await item(foreign)).title).toBe('Отчёт');
  });

  it('цель без числа при правке — 400, как при создании, а не сбой сервера', async () => {
    const { id, owner } = await family([]);
    const goal = await addItem(owner, id, { title: 'Отпуск', mode: 'goal', target: 1000 });
    const one = await addItem(owner, id, { title: 'Корм', mode: 'one' });
    const cleared = await owner.call('PATCH', `/groups/${id}/items/${goal}`, { target: null });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error).toBe('no_target');
    expect((await item(goal)).target).toBe(1000);
    expect((await owner.call('PATCH', `/groups/${id}/items/${one}`, { mode: 'goal' })).body.error).toBe('no_target');
    expect((await owner.call('PATCH', `/groups/${id}/items/${one}`, { mode: 'goal', target: 40 })).status).toBe(200);
    expect(await item(one)).toMatchObject({ mode: 'goal', target: 40 });
  });

  it('«только создатель и админы»: участник не заводит, не правит, не пропускает и не удаляет — но отмечает', async () => {
    const { id, owner, members: [masha] } = await family();
    const day = await todayOf(owner);
    // По умолчанию участник может.
    const own = await addItem(masha, id, { title: 'Моё', mode: 'one' });
    await owner.call('PATCH', `/groups/${id}`, { admins_only_edit: true });
    const daily = await addItem(owner, id, { title: 'Зарядка', mode: 'one', rrule: 'FREQ=DAILY' });
    for (const res of [
      await masha.call('POST', `/groups/${id}/items`, { title: 'Ещё', mode: 'one' }),
      await masha.call('PATCH', `/groups/${id}/items/${daily}`, { title: 'Не зарядка' }),
      await masha.call('POST', `/groups/${id}/items/${daily}/skip`, { day }),
      await masha.call('DELETE', `/groups/${id}/items/${own}`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('admins_only');
    }
    expect((await item(own)).archived_at).toBeNull();
    expect((await masha.call('PUT', `/groups/${id}/items/${daily}/mark`, {})).body).toEqual({ ok: true, taken: false });
    await sb.from('group_members').update({ role: 'admin' }).eq('group_id', id).eq('user_id', masha.id);
    expect((await masha.call('POST', `/groups/${id}/items`, { title: 'Ещё', mode: 'one' })).status).toBe(201);
  });

  it('убрать только сегодня у повторяющегося: день в исключениях, остальные дни на месте', async () => {
    const { id, owner } = await family([]);
    const day = await todayOf(owner);
    const daily = await addItem(owner, id, { title: 'Зарядка', mode: 'one', rrule: 'FREQ=DAILY' });
    const skip = (body: object, iid = daily) => owner.call('POST', `/groups/${id}/items/${iid}/skip`, body);
    expect((await skip({ day: 'завтра' })).body.error).toBe('bad_day');
    expect((await skip({})).status).toBe(400);
    expect((await skip({ day }, 999_999_999)).status).toBe(404);
    // Дело другой группы — тоже «нет такого».
    const other = (await owner.call('POST', '/groups', { title: 'Работа' })).body.id;
    expect((await skip({ day }, await addItem(owner, other, { title: 'Отчёт', mode: 'one' }))).status).toBe(404);

    await skip({ day: addDays(day, 1) });
    await skip({ day });
    expect((await skip({ day })).status).toBe(200);
    expect((await item(daily)).exdates).toEqual([day, addDays(day, 1)]);
    expect((await myGroup(owner, id)).items).toEqual([]);
    const upcoming = (await owner.call('GET', `/groups/${id}`)).body.upcoming as { day: string }[];
    expect(upcoming.map((b) => b.day)).not.toContain(addDays(day, 1));
    expect(upcoming.map((b) => b.day)).toContain(addDays(day, 2));
  });

  it('удалить дело — в архив, со «Сегодня» пропадает', async () => {
    const { id, owner } = await family([]);
    const a = await addItem(owner, id, { title: 'Корм', mode: 'one' });
    expect((await owner.call('DELETE', `/groups/${id}/items/${a}`)).status).toBe(200);
    expect((await item(a)).archived_at).not.toBeNull();
    expect((await myGroup(owner, id)).items).toEqual([]);
    expect((await owner.call('DELETE', `/groups/${id}/items/abc`)).status).toBe(404);
  });
});

describe.skipIf(!ready)('отметки и цели', () => {
  it('«кто-то один»: отметил — закрыто для всех; повторно — taken; снять может только сделавший', async () => {
    const { id, owner, members: [masha] } = await family();
    const a = await addItem(owner, id, { title: 'Купить корм', mode: 'one' });
    const mark = (u: TestUser, body: object = {}) => u.call('PUT', `/groups/${id}/items/${a}/mark`, body);
    expect((await mark(masha)).body).toEqual({ ok: true, taken: false });
    expect((await sb.from('group_item_marks').select('user_id, solo').eq('item_id', a)).data).toEqual([{ user_id: masha.id, solo: true }]);
    expect((await mark(masha)).body).toEqual({ ok: true, taken: true });
    expect(await myGroup(owner, id)).toMatchObject({ planned: 1, done: 1 });
    const other = await mark(owner);
    expect(other.status).toBe(403);
    expect(other.body.error).toBe('not_yours');
    expect((await mark(owner, { done: false })).status).toBe(403);
    expect((await mark(masha, { done: false })).body).toEqual({ ok: true, taken: false });
    expect((await sb.from('group_item_marks').select('user_id').eq('item_id', a)).data).toEqual([]);
  });

  it('назначенное отмечает только тот, кому; у каждого из «Все» своя отметка', async () => {
    const { id, owner, members: [masha] } = await family();
    const toMasha = await addItem(owner, id, { title: 'Посуда', mode: 'assign', assignees: [masha.id] });
    expect((await owner.call('PUT', `/groups/${id}/items/${toMasha}/mark`, {})).status).toBe(403);
    expect((await masha.call('PUT', `/groups/${id}/items/${toMasha}/mark`, {})).status).toBe(200);
    const all = await addItem(owner, id, { title: 'Зарядка', mode: 'assign', all_members: true, rrule: 'FREQ=DAILY' });
    await owner.call('PUT', `/groups/${id}/items/${all}/mark`, { done: true });
    expect(await myGroup(owner, id)).toMatchObject({ planned: 3, done: 2 });
    await masha.call('PUT', `/groups/${id}/items/${all}/mark`, {});
    expect((await sb.from('group_item_marks').select('user_id, solo').eq('item_id', all)).data).toHaveLength(2);
    expect(await myGroup(owner, id)).toMatchObject({ planned: 3, done: 3 });
  });

  it('по очереди: сегодня отмечает только тот, чья очередь; мероприятие и чужое не отмечают', async () => {
    const { id, owner, members: [masha] } = await family();
    const turns = await addItem(owner, id, { title: 'Мусор', mode: 'assign', assignees: [masha.id, owner.id], rotate: true, rrule: 'FREQ=DAILY' });
    expect((await owner.call('PUT', `/groups/${id}/items/${turns}/mark`, {})).status).toBe(403);
    expect((await masha.call('PUT', `/groups/${id}/items/${turns}/mark`, {})).status).toBe(200);
    expect((await sb.from('group_item_marks').select('solo').eq('item_id', turns).single()).data?.solo).toBe(true);
    const event = await addItem(owner, id, { title: 'Ужин', mode: 'event', time: '19:00' });
    expect((await owner.call('PUT', `/groups/${id}/items/${event}/mark`, {})).status).toBe(403);
    expect((await owner.call('PUT', `/groups/999999999/items/${turns}/mark`, {})).status).toBe(403);
    expect((await owner.call('PUT', `/groups/${id}/items/999999999/mark`, {})).status).toBe(403);
  });

  // Решение владелицы 07.10.2026: день вне последней недели — отказ, а не отметка «за сегодня» (календарь давал отметить
  // любой прошлый день, и сервер тихо ставил её на сегодня — группа видела «сделано», хотя сегодня никто не делал).
  it('отметка задним числом — до недели назад; раньше, в будущем и не день — 400 bad_day, сегодня не отмечено', async () => {
    const { id, owner } = await family([]);
    const day = await todayOf(owner);
    const daily = await addItem(owner, id, { title: 'Зарядка', mode: 'one', rrule: 'FREQ=DAILY', day: addDays(day, -10) });
    const mark = (d: unknown) => owner.call('PUT', `/groups/${id}/items/${daily}/mark`, { day: d });
    expect((await mark(addDays(day, -3))).body.taken).toBe(false);
    expect((await mark(addDays(day, -7))).body.taken).toBe(false);
    for (const bad of [addDays(day, -8), addDays(day, 1), 'вчера', 5]) {
      const res = await mark(bad);
      expect(res.status, String(bad)).toBe(400);
      expect(res.body.error, String(bad)).toBe('bad_day');
    }
    const days = (await sb.from('group_item_marks').select('day').eq('item_id', daily).order('day')).data?.map((m) => m.day);
    expect(days).toEqual([addDays(day, -7), addDays(day, -3)]);
  });

  it('цель: вклады копятся; кривая сумма — 400; не цель, удалённая и чужая — 404', async () => {
    const { id, owner, members: [masha] } = await family();
    const goal = await addItem(owner, id, { title: 'Отпуск', mode: 'goal', target: 1000 });
    const add = (u: TestUser, body: object, iid = goal) => u.call('POST', `/groups/${id}/items/${iid}/entries`, body);
    expect((await add(owner, { amount: 250 })).status).toBe(201);
    expect((await add(masha, { amount: 100.5 })).status).toBe(201);
    const g = await myGroup(owner, id);
    expect(g.items.find((x: { id: number }) => x.id === goal)).toMatchObject({ total: 350.5, target: 1000 });
    for (const amount of [0, -1, 'много', 1e12, undefined]) expect((await add(owner, { amount })).body.error).toBe('bad_amount');
    const one = await addItem(owner, id, { title: 'Корм', mode: 'one' });
    expect((await add(owner, { amount: 5 }, one)).status).toBe(404);
    expect((await add(owner, { amount: 5 }, 999_999_999)).status).toBe(404);
    const outsider = await user();
    expect((await add(outsider, { amount: 5 })).status).toBe(404);
    await owner.call('DELETE', `/groups/${id}/items/${goal}`);
    expect((await add(owner, { amount: 5 })).status).toBe(404);
    expect((await sb.from('group_goal_entries').select('amount').eq('item_id', goal)).data).toHaveLength(2);
  });
});

describe.skipIf(!ready)('календарь и чат из приложения', () => {
  it('«Календарь»: только мои дела групп; несделанное разовое переезжает на сегодня, сделанное раньше — нет', async () => {
    const { id, owner, members: [masha] } = await family();
    const day = await todayOf(owner);
    await addItem(owner, id, { title: 'Старое', mode: 'one', day: addDays(day, -2) });
    const doneBefore = await addItem(owner, id, { title: 'Сделанное', mode: 'one', day: addDays(day, -3) });
    await owner.call('PUT', `/groups/${id}/items/${doneBefore}/mark`, { day: addDays(day, -1) });
    await addItem(owner, id, { title: 'Маше', mode: 'assign', assignees: [masha.id] });
    const done = await addItem(owner, id, { title: 'Сегодня', mode: 'one' });
    await masha.call('PUT', `/groups/${id}/items/${done}/mark`, {});
    await addItem(owner, id, { title: 'Завтра', mode: 'event', day: addDays(day, 1) });
    // Повтор в день недели, которого в эти три дня нет.
    const absent = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][(new Date(`${addDays(day, 3)}T00:00:00Z`).getUTCDay() + 6) % 7];
    await addItem(owner, id, { title: 'Редкое', mode: 'one', rrule: `FREQ=WEEKLY;BYDAY=${absent}` });

    const res = await owner.call('GET', `/calendar?from=${day}&to=${addDays(day, 2)}`);
    expect(res.status).toBe(200);
    const blocks = res.body.groups as { day: string; group: { id: number }; items: { title: string }[] }[];
    const titles = (d: string) => blocks.filter((b) => b.group.id === id && b.day === d).flatMap((b) => b.items.map((x) => x.title));
    expect(titles(day).sort()).toEqual(['Сегодня', 'Старое']);
    // Сделанное сегодня остаётся в своём дне — уже закрытым, с тем, кто сделал.
    const doneToday = blocks.find((b) => b.day === day)!.items.find((x) => x.title === 'Сегодня') as unknown as { done: boolean; done_by: number[] };
    expect(doneToday).toMatchObject({ done: true, done_by: [masha.id] });
    expect(titles(addDays(day, 1))).toEqual(['Завтра']);
    expect(titles(addDays(day, 2))).toEqual([]);
    // У Маши — её назначенное.
    const mashas = (await masha.call('GET', `/calendar?from=${day}&to=${day}`)).body.groups as { items: { title: string }[] }[];
    expect(mashas.flatMap((b) => b.items.map((x) => x.title))).toContain('Маше');
    // «Редкое» в эти дни не бывает и на «Сегодня» тоже.
    expect((await myGroup(owner, id)).items.map((x: { title: string }) => x.title)).not.toContain('Редкое');
  });

  it('правки в приложении обновляют «Сегодня в группе» в привязанном чате', async () => {
    const { id, owner } = await family([]);
    const day = await todayOf(owner);
    const chatId = -1_009_000_000_000 - Math.floor(Math.random() * 1e9);
    await sb.from('groups').update({ tg_chat_id: chatId, tg_chat_title: 'Семейный чат', tg_today_msg_id: 555, tg_today_day: day }).eq('id', id);
    const a = await addItem(owner, id, { title: 'Купить корм', mode: 'one', rrule: 'FREQ=DAILY' });
    const edits = () => tg.sent('editMessageText').filter((c) => c.body.chat_id === chatId && c.body.message_id === 555);
    expect(edits()).toHaveLength(1);
    expect(edits()[0]!.body.text).toContain('Купить корм');
    await owner.call('PUT', `/groups/${id}/items/${a}/mark`, {});
    expect(edits().at(-1)!.body.text).toContain('<s>Купить корм</s>');
    await owner.call('POST', `/groups/${id}/items/${a}/skip`, { day: addDays(day, 1) });
    await owner.call('DELETE', `/groups/${id}/items/${a}`);
    expect(edits()).toHaveLength(4);
    expect(edits().at(-1)!.body.text).toContain('На сегодня дел нет.');
    expect(tg.sent('sendMessage')).toEqual([]);
  });

  it('проверка чата: без чата — null, чужому — 404; отключить: участник — 403, админ — бот прощается и выходит', async () => {
    const { id, owner, members: [masha] } = await family();
    expect((await owner.call('POST', `/groups/${id}/chat/check`)).body).toEqual({ tg_chat_title: null });
    expect((await (await user()).call('POST', `/groups/${id}/chat/check`)).status).toBe(404);
    expect(tg.calls).toEqual([]);

    const chatId = -1_009_000_000_000 - Math.floor(Math.random() * 1e9);
    await sb.from('groups').update({ tg_chat_id: chatId, tg_chat_title: 'Семейный чат' }).eq('id', id);
    expect((await masha.call('DELETE', `/groups/${id}/chat`)).status).toBe(403);
    expect((await groupRow(id)).tg_chat_id).toBe(chatId);
    await sb.from('group_members').update({ role: 'admin' }).eq('group_id', id).eq('user_id', masha.id);
    // Чата уже может не быть: ошибки Telegram при прощании не мешают отключить.
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the group chat' });
    tg.reply('leaveChat', { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
    expect((await masha.call('DELETE', `/groups/${id}/chat`)).status).toBe(200);
    expect(await groupRow(id)).toMatchObject({ tg_chat_id: null, tg_chat_title: null });
    expect(tg.sent('sendMessage')[0]!.body).toMatchObject({ chat_id: chatId, text: 'Этот чат отключили от группы «Семья» в LifeCommit. Пока!' });
    expect(tg.sent('leaveChat')[0]!.body).toEqual({ chat_id: chatId });
    // Повторно — уже нечего отключать.
    tg.calls = [];
    expect((await owner.call('DELETE', `/groups/${id}/chat`)).status).toBe(200);
    expect(tg.calls).toEqual([]);
  });

  it('удалить группу с чатом: бот прощается по-английски у англоязычного создателя и выходит', async () => {
    const owner = await user({ name: 'Ann', lang: 'en' });
    const id = (await owner.call('POST', '/groups', { title: 'Team' })).body.id;
    const chatId = -1_009_000_000_000 - Math.floor(Math.random() * 1e9);
    await sb.from('groups').update({ tg_chat_id: chatId, tg_chat_title: 'Team chat' }).eq('id', id);
    expect((await owner.call('DELETE', `/groups/${id}`)).status).toBe(200);
    expect(tg.sent('sendMessage')[0]!.body.text).toBe('This chat was disconnected from the “Team” group in LifeCommit. Bye!');
    expect(tg.sent('leaveChat')).toHaveLength(1);
    expect(await groupRow(id)).toMatchObject({ tg_chat_id: null });
  });
});
