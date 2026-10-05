// Сервер целиком — глубже базовых тестов (api.int.test.ts): подпись initData и связанные аккаунты,
// «Сегодня» во всех вариантах, проверки привычек, целей, отметок, дел, карты, итога и настроек, Bot API.
// Календарные подключения (/api/calendars*) проверяются отдельно.
import { sign } from '@tma.js/init-data-node/web';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, logicalDay, weekdayIndex } from './day';
import { byTelegram, tg as botApi, TgError } from './env';
import { dbReady, env, net, request, sb, tg, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('api-тесты пропущены: нет локальной Supabase (pnpm db:start)');

const MOCK_HASH = 'mock-hash-not-valid-for-backend';

/** Свои id Telegram (не из user()): удаляем после каждого теста. */
const mine: number[] = [];
afterEach(async () => {
  const ids = mine.splice(0);
  if (ids.length) await sb.from('users').delete().in('id', ids);
});
const freshId = () => {
  const id = 9_100_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  mine.push(id);
  return id;
};

/** initData подмены разработки с любыми полями пользователя (null — без пользователя). */
function initData(tgUser: Record<string, unknown> | null, extra: Record<string, string> = {}): string {
  return new URLSearchParams([
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['hash', MOCK_HASH],
    ['signature', 'mock-signature'],
    ...(tgUser ? [['user', JSON.stringify(tgUser)]] : []),
    ...Object.entries(extra),
  ]).toString();
}

/** Запрос к /api с произвольной initData. */
function as(raw: string, method: string, path: string, body?: unknown) {
  return request(`/api${path}`, {
    method,
    headers: { Authorization: `tma ${raw}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

const todayOf = async (u: TestUser) => (await u.call('GET', '/today')).body.day as string;

async function habit(u: TestUser, input: Record<string, unknown>): Promise<number> {
  const res = await u.call('POST', '/tasks', { kind: 'check', target: 1, ...input });
  expect(res.status).toBe(201);
  return res.body.id;
}

/** Привычка прямо в базе, без истории целей (как старые строки до task_goals). */
async function bareTask(userId: number, row: Record<string, unknown>): Promise<number> {
  const { data, error } = await sb.from('tasks').insert({ user_id: userId, ...row }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function todo(userId: number, row: Record<string, unknown>): Promise<number> {
  const { data, error } = await sb.from('todos').insert({ user_id: userId, ...row }).select('id').single();
  if (error) throw error;
  return data.id;
}

/** Подключение календаря без сети: статус «ошибка», чтобы синхронизация по расписанию его не трогала. */
async function idleCalendar(userId: number) {
  const { data, error } = await sb
    .from('calendar_accounts')
    .insert({ user_id: userId, provider: 'apple', login: 'a@icloud.test', secret: 'x', status: 'error', last_sync_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as number;
}

const retimeOf = async (accountId: number) => (await sb.from('calendar_accounts').select('retime, last_sync_at').eq('id', accountId).single()).data!;

const byTitle = <T extends { title: string }>(list: T[]) => Object.fromEntries(list.map((x) => [x.title, x])) as Record<string, T>;

/** Часовой пояс и начало дня, при которых сегодня не понедельник (нужно прошедшее в этой неделе). */
function notMonday(): { timezone: string; hour: number } {
  for (const timezone of ['Europe/Moscow', 'Pacific/Kiritimati', 'Etc/GMT+12']) {
    for (const hour of [4, 0, 12]) if (weekdayIndex(logicalDay(timezone, hour)) !== 0) return { timezone, hour };
  }
  throw new Error('везде понедельник');
}

describe.skipIf(!ready)('вход: подпись Telegram', () => {
  it('настоящая подпись проходит; просроченная и чужим токеном — 401', async () => {
    const id = freshId();
    const raw = await sign({ user: { id, first_name: 'Подпись' } }, env.TELEGRAM_BOT_TOKEN, new Date());
    const ok = await as(raw, 'POST', '/session', { timezone: 'Europe/Berlin' });
    expect(ok.status).toBe(200);
    expect(ok.body.is_new).toBe(true);
    expect((await sb.from('users').select('timezone').eq('id', id).single()).data?.timezone).toBe('Europe/Berlin');

    const old = await sign({ user: { id, first_name: 'Подпись' } }, env.TELEGRAM_BOT_TOKEN, new Date(Date.now() - 8 * 86_400_000));
    expect(await as(old, 'GET', '/me')).toMatchObject({ status: 401, body: { error: 'bad_init_data' } });
    const forged = await sign({ user: { id, first_name: 'Подпись' } }, '7000000002:OTHER-TOKEN', new Date());
    expect((await as(forged, 'GET', '/me')).status).toBe(401);
  });

  it('без схемы tma, с пустой initData и без пользователя — 401', async () => {
    expect(await request('/api/me', { headers: { Authorization: 'Basic abc' } })).toMatchObject({ status: 401, body: { error: 'no_init_data' } });
    // Bearer — ключ входа на компьютере (worker/desktop.ts): неизвестный ключ — свой отказ.
    expect(await request('/api/me', { headers: { Authorization: 'Bearer abc' } })).toMatchObject({ status: 401, body: { error: 'bad_session' } });
    expect(await request('/api/me', { headers: { Authorization: 'tma ' } })).toMatchObject({ status: 401, body: { error: 'no_init_data' } });
    expect(await as(initData(null), 'GET', '/me')).toMatchObject({ status: 401, body: { error: 'no_user' } });
  });

  it('без сессии (не входил) — 401 no_session', async () => {
    const res = await as(initData({ id: freshId(), first_name: 'Гость' }), 'GET', '/today');
    expect(res).toMatchObject({ status: 401, body: { error: 'no_session' } });
  });
});

describe.skipIf(!ready)('вход: профиль и часовой пояс', () => {
  it('первый вход: язык не русский или не указан — en; фамилия и фото сохраняются; start_param отдаётся', async () => {
    const id = freshId();
    const res = await as(
      initData({ id, first_name: 'Ann', last_name: 'Lee', photo_url: 'https://t.me/i/userpic/ann.jpg', language_code: 'de' }, { start_param: 'g_42' }),
      'POST',
      '/session',
      { timezone: 'Europe/Paris' },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ is_new: true, start_param: 'g_42' });
    expect(res.body.user).toMatchObject({ id, language_code: 'en', username: null, photo_url: 'https://t.me/i/userpic/ann.jpg', timezone: 'Europe/Paris', premium: false });
    expect((await sb.from('users').select('last_name').eq('id', id).single()).data?.last_name).toBe('Lee');

    const silent = freshId();
    const res2 = await as(initData({ id: silent, first_name: 'Без языка' }), 'POST', '/session', {});
    expect(res2.body.user.language_code).toBe('en');
    // Пояс не прислали — остаётся пояс по умолчанию.
    expect(res2.body.user.timezone).toBe('Europe/Moscow');
  });

  it('вход без тела и с выдуманным поясом — пояс не меняется', async () => {
    const u = await user({ timezone: 'Asia/Tokyo' });
    const bare = await request('/api/session', { method: 'POST', headers: { Authorization: `tma ${u.initData}` } });
    expect(bare.status).toBe(200);
    expect((await u.call('POST', '/session', { timezone: 'Mars/Olympus' })).status).toBe(200);
    expect((await sb.from('users').select('timezone').eq('id', u.id).single()).data?.timezone).toBe('Asia/Tokyo');
  });

  it('повторный вход: имя из Telegram обновляется, язык и настройки — нет; сменился пояс — календари перечитаются', async () => {
    const u = await user({ name: 'Старое имя' });
    await u.call('PATCH', '/settings', { language_code: 'en', day_start_hour: 6 });
    const acc = await idleCalendar(u.id);
    const raw = initData({ id: u.id, first_name: 'Новое имя', username: `n${u.id}`, language_code: 'ru' });

    const res = await as(raw, 'POST', '/session', { timezone: 'Asia/Dubai' });
    expect(res.body).toMatchObject({ is_new: false, start_param: null });
    expect(res.body.user).toMatchObject({ first_name: 'Новое имя', language_code: 'en', day_start_hour: 6, timezone: 'Asia/Dubai' });
    expect(await retimeOf(acc)).toEqual({ retime: true, last_sync_at: null });

    // Тот же пояс — перечитывать нечего.
    await sb.from('calendar_accounts').update({ retime: false }).eq('id', acc);
    await as(raw, 'POST', '/session', { timezone: 'Asia/Dubai' });
    expect((await retimeOf(acc)).retime).toBe(false);
  });
});

describe.skipIf(!ready)('вход: связанный аккаунт Telegram', () => {
  it('входит в того же человека: профиль основного не трогает, пояс — с телефона; удалить аккаунт нельзя', async () => {
    const main = await user({ name: 'Даша' });
    const alias = freshId();
    await sb.from('users').update({ telegram_aliases: [alias] }).eq('id', main.id);
    const acc = await idleCalendar(main.id);
    const raw = initData({ id: alias, first_name: 'Рабочий', username: `w${alias}`, language_code: 'en' });

    const res = await as(raw, 'POST', '/session', { timezone: 'Asia/Bangkok' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ is_new: false, start_param: null });
    expect(res.body.user).toMatchObject({ id: main.id, first_name: 'Даша', language_code: 'ru', timezone: 'Asia/Bangkok' });
    expect((await sb.from('users').select('id').eq('id', alias)).data).toEqual([]);
    expect((await retimeOf(acc)).retime).toBe(true);

    // Без пояса и с тем же поясом — календари не трогаем.
    await sb.from('calendar_accounts').update({ retime: false }).eq('id', acc);
    expect((await request('/api/session', { method: 'POST', headers: { Authorization: `tma ${raw}` } })).status).toBe(200);
    await as(raw, 'POST', '/session', { timezone: 'Asia/Bangkok' });
    expect((await retimeOf(acc)).retime).toBe(false);
    expect((await sb.from('users').select('timezone').eq('id', main.id).single()).data?.timezone).toBe('Asia/Bangkok');

    // Привычка со связанного — у основного.
    const made = await as(raw, 'POST', '/tasks', { title: 'Общая', kind: 'check', target: 1 });
    expect((await sb.from('tasks').select('user_id').eq('id', made.body.id).single()).data?.user_id).toBe(main.id);
    expect((await main.call('GET', '/today')).body.tasks.map((t: { title: string }) => t.title)).toEqual(['Общая']);

    expect(await as(raw, 'DELETE', '/account')).toMatchObject({ status: 403, body: { error: 'linked_account' } });
    expect((await sb.from('users').select('id').eq('id', main.id)).data).toHaveLength(1);
  });
});

describe.skipIf(!ready)('«Сегодня»: привычки', () => {
  it('по дням недели — только в отмеченные дни; N раз в неделю — пока не набрано, а отмеченная сегодня — видна', async () => {
    const { timezone, hour } = notMonday();
    const u = await user({ timezone });
    await u.call('PATCH', '/settings', { day_start_hour: hour });
    const day = await todayOf(u);
    const wd = weekdayIndex(day);
    expect(wd).toBeGreaterThan(0);

    await habit(u, { title: 'Сегодня по плану', schedule: 'weekdays', weekdays: 1 << wd });
    await habit(u, { title: 'Не сегодня', schedule: 'weekdays', weekdays: 1 << ((wd + 1) % 7) });
    const weekly = await habit(u, { title: 'Раз в неделю', schedule: 'per_week', per_week: 1 });
    const quit = await habit(u, { title: 'Без сахара', kind: 'abstain' });

    await u.call('PUT', '/logs', { task_id: weekly, value: 1, day: addDays(day, -1) });
    // Срыв не считается сделанным днём недели.
    await u.call('PUT', '/logs', { task_id: quit, status: 'slip', day: addDays(day, -1) });
    let tasks = byTitle((await u.call('GET', '/today')).body.tasks as { title: string; due: boolean; week_done: number; logged: boolean }[]);
    expect(tasks['Сегодня по плану'].due).toBe(true);
    expect(tasks['Не сегодня'].due).toBe(false);
    expect(tasks['Раз в неделю']).toMatchObject({ due: false, week_done: 1, logged: false });
    expect(tasks['Без сахара'].week_done).toBe(0);

    await u.call('PUT', '/logs', { task_id: weekly, value: 1 });
    tasks = byTitle((await u.call('GET', '/today')).body.tasks);
    expect(tasks['Раз в неделю']).toMatchObject({ due: true, week_done: 1, logged: true, value: 1 });
  });

  it('привычка без истории целей — цель 1, первый день — сегодня', async () => {
    const u = await user();
    await bareTask(u.id, { title: 'Старая', kind: 'count' });
    await bareTask(u.id, { title: 'Старый отказ', kind: 'abstain', last_slip_on: '2000-01-01' });
    const tasks = byTitle((await u.call('GET', '/today')).body.tasks as { title: string; target: number; clean_before: number }[]);
    expect(tasks['Старая'].target).toBe(1);
    expect(tasks['Старая'].clean_before).toBe(0);
    // Нет первого дня — считаем от сегодня: все дни с «последнего раза» чистые.
    expect(tasks['Старый отказ'].clean_before).toBeGreaterThan(9000);
  });

  it('«Бросить»: дни с «последнего раза» — чистые, срыв задним числом их уменьшает, «чисто» до начала — снимает отметку', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await habit(u, { title: 'Не курить', kind: 'abstain', last_slip_on: addDays(day, -10) });
    const cleanBefore = async () => byTitle((await u.call('GET', '/today')).body.tasks as { title: string; clean_before: number; last_slip_on: string }[])['Не курить'];
    expect(await cleanBefore()).toMatchObject({ clean_before: 9, last_slip_on: addDays(day, -10) });

    await u.call('PUT', '/logs', { task_id: id, status: 'slip', day: addDays(day, -5) });
    expect((await cleanBefore()).clean_before).toBe(8);

    // «Чисто» в день до появления привычки — это убрать отметку, а не завести вторую.
    expect((await u.call('PUT', '/logs', { task_id: id, status: 'clean', day: addDays(day, -5) })).status).toBe(200);
    expect((await sb.from('task_logs').select('day').eq('task_id', id)).data).toEqual([]);
    expect((await cleanBefore()).clean_before).toBe(9);

    // «Чисто» сегодня — записывается (это уже дни в приложении).
    await u.call('PUT', '/logs', { task_id: id, status: 'clean' });
    expect((await sb.from('task_logs').select('day, value, status').eq('task_id', id)).data).toEqual([{ day, value: 1, status: 'clean' }]);
  });

  it('отложенные — отдельным списком с эмодзи; лимита на бесплатном нет', async () => {
    const u = await user();
    const id = await habit(u, { title: 'Йога', emoji: '🧘' });
    await u.call('POST', `/tasks/${id}/archive`);
    const today = (await u.call('GET', '/today')).body;
    expect(today.archived).toEqual([{ id, title: 'Йога', emoji: '🧘' }]);
    expect(today.limits).toEqual({ max_tasks: null, active: 0 });
  });
});

describe.skipIf(!ready)('«Сегодня»: дела', () => {
  it('переехавшие «со вчера», сделанные сегодня — вниз, со временем — по часам; события календаря не переезжают, скрытые не видны', async () => {
    const u = await user();
    const day = await todayOf(u);
    await todo(u.id, { title: 'Со вчера', day: addDays(day, -1), position: 1 });
    await todo(u.id, { title: 'Сделано вчера', day: addDays(day, -2), done_on: addDays(day, -1) });
    await todo(u.id, { title: 'Сделано сегодня', day: addDays(day, -3), done_on: day });
    await todo(u.id, { title: 'Позже', day, time: '18:00' });
    await u.call('POST', '/todos', { title: 'Рано', time: '9:05' });
    await todo(u.id, { title: 'Вчерашняя встреча', day: addDays(day, -1), source: 'apple', time: '10:00' });
    await todo(u.id, { title: 'Скрытая встреча', day, source: 'google', hidden: true });
    await todo(u.id, { title: 'Созвон', day, source: 'google', time: '12:00', duration_min: 45, details: { location: 'Офис', link: 'https://meet.test/x' } });
    await todo(u.id, { title: 'Потом', day: addDays(day, 3) });
    await todo(u.id, { title: 'Потом скрытое', day: addDays(day, 3), source: 'apple', hidden: true });

    const res = (await u.call('GET', '/today')).body;
    expect(res.todos.map((t: { title: string }) => t.title)).toEqual(['Рано', 'Созвон', 'Позже', 'Со вчера', 'Сделано сегодня']);
    const list = byTitle(res.todos as { title: string; day: string; done: boolean; time: string | null }[]);
    expect(list['Со вчера']).toMatchObject({ day: addDays(day, -1), done: false, time: null });
    expect(list['Сделано сегодня']).toMatchObject({ done: true, day: addDays(day, -3) });
    expect(list['Рано'].time).toBe('09:05');
    expect(list['Созвон']).toMatchObject({ source: 'google', duration_min: 45, recurring: false, details: { location: 'Офис', link: 'https://meet.test/x' } });
    expect(res.todos_later).toBe(1);
  });

  it('повторяющиеся: по правилу, «сделано» на свой день; непонятное правило — один раз в день начала', async () => {
    const u = await user();
    const day = await todayOf(u);
    const daily = await todo(u.id, { title: 'Зарядка', day: addDays(day, -3), rrule: 'FREQ=DAILY' });
    await todo(u.id, { title: 'По неделям со вчера', day: addDays(day, -1), rrule: 'FREQ=WEEKLY' });
    await todo(u.id, { title: 'Ежечасно сегодня', day, rrule: 'FREQ=HOURLY' });
    await todo(u.id, { title: 'Ежечасно вчера', day: addDays(day, -1), rrule: 'FREQ=HOURLY' });
    await todo(u.id, { title: 'С пропуском', day: addDays(day, -1), rrule: 'FREQ=DAILY', exdates: [day] });

    const titles = async () => (await u.call('GET', '/today')).body.todos as { id: number; title: string; done: boolean; recurring: boolean; day: string }[];
    expect((await titles()).map((t) => t.title).sort()).toEqual(['Ежечасно сегодня', 'Зарядка']);
    expect(byTitle(await titles())['Зарядка']).toMatchObject({ day, done: false, recurring: true });

    // «Сделано» без дня — на сегодня; с днём — на тот день.
    expect((await u.call('PATCH', `/todos/${daily}`, { done: true })).status).toBe(200);
    expect(byTitle(await titles())['Зарядка'].done).toBe(true);
    await u.call('PATCH', `/todos/${daily}`, { done: true, on: addDays(day, -1) });
    await u.call('PATCH', `/todos/${daily}`, { done: true, on: 'вчера' });
    const done = async () => ((await sb.from('todo_done').select('day').eq('todo_id', daily).order('day')).data ?? []).map((r) => r.day);
    expect(await done()).toEqual([addDays(day, -1), day]);
    await u.call('PATCH', `/todos/${daily}`, { done: false, on: addDays(day, -1) });
    expect(await done()).toEqual([day]);
    // Отметка повторяющегося не трогает done_on, а день начала не двигается.
    await u.call('PATCH', `/todos/${daily}`, { day: addDays(day, 5) });
    expect((await sb.from('todos').select('day, done_on').eq('id', daily).single()).data).toEqual({ day: addDays(day, -3), done_on: null });

    const cal = await u.call('GET', `/calendar?from=${addDays(day, -4)}&to=${addDays(day, 1)}`);
    const zar = cal.body.todos.filter((t: { title: string }) => t.title === 'Зарядка');
    expect(zar.map((t: { day: string; done: boolean }) => [t.day, t.done])).toEqual([
      [addDays(day, -3), false],
      [addDays(day, -2), false],
      [addDays(day, -1), false],
      [day, true],
      [addDays(day, 1), false],
    ]);
    const hourly = cal.body.todos.filter((t: { title: string }) => t.title.startsWith('Ежечасно')).map((t: { title: string; day: string }) => [t.title, t.day]);
    expect(hourly.sort()).toEqual([
      ['Ежечасно вчера', addDays(day, -1)],
      ['Ежечасно сегодня', day],
    ]);
    expect(cal.body.todos.filter((t: { title: string }) => t.title === 'С пропуском').map((t: { day: string }) => t.day)).toEqual([addDays(day, -1), addDays(day, 1)]);
    expect(cal.body.today).toBe(day);
  });

  it('группы: блок группы с её делами на сегодня', async () => {
    const u = await user();
    const day = await todayOf(u);
    const g = await u.call('POST', '/groups', { title: 'Дом', kind: 'family' });
    await sb.from('group_items').insert({ group_id: g.body.id, created_by: u.id, title: 'Полить цветы', mode: 'one', day });
    const groups = (await u.call('GET', '/today')).body.groups;
    expect(groups).toEqual([expect.objectContaining({ id: g.body.id, title: 'Дом', planned: 1, done: 0, items: [expect.objectContaining({ title: 'Полить цветы', for_me: true })] })]);
  });
});

describe.skipIf(!ready)('привычки: создание', () => {
  it('поля обрезаются и зажимаются в пределы: название, единица, эмодзи, дни недели, раз в неделю, подзадачи', async () => {
    const u = await user();
    const day = await todayOf(u);
    const subtasks = [' Глава ', '', '   ', ...Array.from({ length: 25 }, (_, i) => `Пункт ${i + 1}`)];
    const id = await habit(u, {
      title: `  ${'Ч'.repeat(100)}  `,
      kind: 'count',
      target: 25,
      unit: '  страниц на ночь перед сном  ',
      emoji: '📚',
      visibility: 'friends',
      schedule: 'weekdays',
      weekdays: 500,
      subtasks,
    });
    const { data: t } = await sb.from('tasks').select('title, unit, step, emoji, weekdays, per_week, visibility, schedule').eq('id', id).single();
    expect(t).toEqual({ title: 'Ч'.repeat(80), unit: 'страниц на ночь пере', step: 5, emoji: '📚', weekdays: 127, per_week: null, visibility: 'friends', schedule: 'weekdays' });
    const { data: subs } = await sb.from('task_subtasks').select('title, position').eq('task_id', id).order('position');
    expect(subs).toHaveLength(20);
    expect(subs![0]).toEqual({ title: 'Глава', position: 0 });
    expect((await sb.from('task_goals').select('effective_from, target').eq('task_id', id)).data).toEqual([{ effective_from: day, target: 25 }]);

    const row = async (input: Record<string, unknown>) => (await sb.from('tasks').select('kind, unit, step, emoji, weekdays, per_week, visibility, schedule').eq('id', await habit(u, input)).single()).data;
    expect(await row({ title: 'Раз в неделю', schedule: 'per_week' })).toMatchObject({ per_week: 3, weekdays: 127, visibility: 'private' });
    expect(await row({ title: 'Много', schedule: 'per_week', per_week: 9 })).toMatchObject({ per_week: 7 });
    expect(await row({ title: 'Ноль', schedule: 'per_week', per_week: 0 })).toMatchObject({ per_week: 1 });
    expect(await row({ title: 'Ни дня', schedule: 'weekdays', weekdays: 0 })).toMatchObject({ weekdays: 1 });
    expect(await row({ title: 'Все дни', schedule: 'weekdays' })).toMatchObject({ weekdays: 127 });
    // Галочка: единица и цель не нужны; пустой эмодзи — нет эмодзи.
    expect(await row({ title: 'Галочка', unit: 'раз', target: 50, emoji: '' })).toMatchObject({ kind: 'check', unit: null, step: 1, emoji: null });
    expect(await row({ title: 'Без единицы', kind: 'count', target: 500 })).toMatchObject({ unit: null, step: 50 });
    expect(await row({ title: 'Пустая единица', kind: 'count', target: 3, unit: '   ' })).toMatchObject({ unit: null, step: 1 });
  });

  it('цель «Считать» — положительное число, иначе 400; «последний раз» — дата не позже сегодня', async () => {
    const u = await user();
    const day = await todayOf(u);
    expect(await u.call('POST', '/tasks', { kind: 'check', target: 1 })).toMatchObject({ status: 400, body: { error: 'title_required' } });
    expect(await u.call('POST', '/tasks', { title: 'Ноль', kind: 'count', target: 0 })).toMatchObject({ status: 400, body: { error: 'bad_target' } });
    expect((await u.call('POST', '/tasks', { title: 'Буквы', kind: 'count', target: 'много' })).status).toBe(400);
    expect(await u.call('POST', '/tasks', { title: 'Отказ', kind: 'abstain', last_slip_on: 'вчера' })).toMatchObject({ status: 400, body: { error: 'bad_date' } });
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toEqual([]);

    const slip = async (input: Record<string, unknown>) => (await sb.from('tasks').select('last_slip_on').eq('id', await habit(u, input)).single()).data?.last_slip_on;
    expect(await slip({ title: 'Будущее', kind: 'abstain', last_slip_on: addDays(day, 30) })).toBe(day);
    expect(await slip({ title: 'Пусто', kind: 'abstain', last_slip_on: '' })).toBe(null);
    expect(await slip({ title: 'Не отказ', kind: 'check', last_slip_on: addDays(day, -3) })).toBe(null);
  });

  it('неизвестные расписание и видимость — 400, а не ошибка базы', async () => {
    const u = await user();
    expect(await u.call('POST', '/tasks', { title: 'Х', kind: 'check', target: 1, schedule: 'monthly' })).toMatchObject({ status: 400, body: { error: 'bad_schedule' } });
    expect(await u.call('POST', '/tasks', { title: 'Х', kind: 'check', target: 1, visibility: 'everyone' })).toMatchObject({ status: 400, body: { error: 'bad_visibility' } });
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('несуществующая дата «последнего раза» (30 февраля) — 400, а не ошибка базы', async () => {
    const u = await user();
    expect(await u.call('POST', '/tasks', { title: 'Отказ', kind: 'abstain', last_slip_on: '2026-02-30' })).toMatchObject({ status: 400, body: { error: 'bad_date' } });
  });

  it('пачкой: не список — 400; больше восьми — первые восемь; одна неверная — не создаётся ни одна', async () => {
    const u = await user();
    expect(await u.call('POST', '/tasks/batch', { tasks: 'Читать' })).toMatchObject({ status: 400, body: { error: 'no_tasks' } });
    expect((await u.call('POST', '/tasks/batch', {})).status).toBe(400);
    expect((await u.call('POST', '/tasks/batch', { tasks: [{ title: 'Хорошая', kind: 'check', target: 1 }, { title: '', kind: 'check', target: 1 }] })).status).toBe(400);
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `Привычка ${i + 1}`, kind: 'check', target: 1 }));
    const res = await u.call('POST', '/tasks/batch', { tasks: many });
    expect(res.body.ids).toHaveLength(8);
    expect((await sb.from('tasks').select('title').eq('user_id', u.id)).data).toHaveLength(8);
  });
});

describe.skipIf(!ready)('шаблоны', () => {
  it('названия и единицы — на языке человека; повторы выбора не дублируют; без выбора — 400', async () => {
    const u = await user({ lang: 'en' });
    const list = (await u.call('GET', '/templates')).body as { slug: string; title: string; unit: string | null; subtasks: string[] }[];
    const bySlug = Object.fromEntries(list.map((t) => [t.slug, t]));
    expect(bySlug.pushups).toMatchObject({ title: 'Push-ups', unit: 'reps', kind: 'count', target: 20 });
    expect(bySlug.meds).toMatchObject({ title: 'Meds', unit: null });
    expect(bySlug.tidy.subtasks).toEqual(['Dishes', 'Floor in one room', 'Take out trash']);

    const made = await u.call('POST', '/tasks/from-templates', { slugs: ['water', 'water', 'tidy'] });
    expect(made.status).toBe(201);
    expect(made.body.ids).toHaveLength(2);
    const { data } = await sb.from('tasks').select('title, unit, kind, emoji').eq('user_id', u.id).order('title');
    expect(data).toEqual([
      { title: 'Drink water', unit: 'glasses', kind: 'count', emoji: '💧' },
      { title: 'Tidy up', unit: null, kind: 'check', emoji: '🧹' },
    ]);
    expect((await u.call('POST', '/tasks/from-templates', {})).status).toBe(400);
  });

  it('шаблон старого вида «Лимит» не предлагается и не ломает выбор остальных', async () => {
    const u = await user();
    const list = (await u.call('GET', '/templates')).body as { slug: string; kind: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((t) => ['count', 'check', 'abstain'].includes(t.kind))).toBe(true);
    const made = await u.call('POST', '/tasks/from-templates', { slugs: ['social', 'water'] });
    expect(made.status).toBe(201);
    expect((await sb.from('tasks').select('title').eq('user_id', u.id)).data).toEqual([{ title: 'Выпить воды' }]);
    const none = await u.call('POST', '/tasks/from-templates', { slugs: ['social', 'no-such-template'] });
    expect(none.status).toBe(201);
    expect(none.body).toEqual({ ids: [] });
  });
});

describe.skipIf(!ready)('привычки: правка', () => {
  it('название, эмодзи, единица, видимость; пустая правка ничего не меняет; чужая или несуществующая — 404', async () => {
    const u = await user();
    const id = await habit(u, { title: 'Читать', kind: 'count', target: 10, unit: 'стр', emoji: '📖' });
    expect(await u.call('PATCH', `/tasks/${id}`, { title: '   ' })).toMatchObject({ status: 400, body: { error: 'title_required' } });
    await u.call('PATCH', `/tasks/${id}`, { title: `  ${'К'.repeat(90)} `, emoji: '🔥', unit: '  страниц  ', visibility: 'friends' });
    const row = async () => (await sb.from('tasks').select('title, emoji, unit, visibility, schedule, weekdays, per_week, last_slip_on').eq('id', id).single()).data!;
    expect(await row()).toMatchObject({ title: 'К'.repeat(80), emoji: '🔥', unit: 'страниц', visibility: 'friends' });
    await u.call('PATCH', `/tasks/${id}`, { emoji: null, unit: '' });
    expect(await row()).toMatchObject({ emoji: null, unit: null });
    await u.call('PATCH', `/tasks/${id}`, { emoji: '', unit: null });
    expect(await row()).toMatchObject({ emoji: null, unit: null });
    const before = await row();
    expect(await u.call('PATCH', `/tasks/${id}`, {})).toMatchObject({ status: 200, body: { ok: true, goal_effective_from: null } });
    expect(await row()).toEqual(before);
    expect((await u.call('PATCH', '/tasks/999999999', { title: 'Нет' })).status).toBe(404);
  });

  it('расписание: дни недели и «раз в неделю» берут прежние значения, если новых не прислали', async () => {
    const u = await user();
    const id = await habit(u, { title: 'Бег', schedule: 'weekdays', weekdays: 0b0010101 });
    const row = async () => (await sb.from('tasks').select('schedule, weekdays, per_week').eq('id', id).single()).data!;
    await u.call('PATCH', `/tasks/${id}`, { schedule: 'weekdays' });
    expect(await row()).toEqual({ schedule: 'weekdays', weekdays: 0b0010101, per_week: null });
    await u.call('PATCH', `/tasks/${id}`, { schedule: 'weekdays', weekdays: 900 });
    expect((await row()).weekdays).toBe(127);
    await u.call('PATCH', `/tasks/${id}`, { schedule: 'per_week' });
    expect(await row()).toEqual({ schedule: 'per_week', weekdays: 127, per_week: 3 });
    await u.call('PATCH', `/tasks/${id}`, { schedule: 'per_week', per_week: 12 });
    expect((await row()).per_week).toBe(7);
    await u.call('PATCH', `/tasks/${id}`, { schedule: 'per_week' });
    expect((await row()).per_week).toBe(7);
    await u.call('PATCH', `/tasks/${id}`, { schedule: 'daily' });
    expect(await row()).toEqual({ schedule: 'daily', weekdays: 127, per_week: null });
    expect(await u.call('PATCH', `/tasks/${id}`, { schedule: 'yearly' })).toMatchObject({ status: 400, body: { error: 'bad_schedule' } });
    expect(await u.call('PATCH', `/tasks/${id}`, { visibility: 'world' })).toMatchObject({ status: 400, body: { error: 'bad_visibility' } });
    // «Подписчики» и «Все» больше нет — только «Только я / Друзья».
    expect(await u.call('PATCH', `/tasks/${id}`, { visibility: 'public' })).toMatchObject({ status: 400, body: { error: 'bad_visibility' } });
    expect(await row()).toEqual({ schedule: 'daily', weekdays: 127, per_week: null });
  });

  it('«последний раз» правится только у отказа и не позже сегодня', async () => {
    const u = await user();
    const day = await todayOf(u);
    const quit = await habit(u, { title: 'Без кофе', kind: 'abstain' });
    const other = await habit(u, { title: 'Зарядка' });
    const slip = async (id: number) => (await sb.from('tasks').select('last_slip_on').eq('id', id).single()).data?.last_slip_on;
    await u.call('PATCH', `/tasks/${quit}`, { last_slip_on: addDays(day, -4) });
    expect(await slip(quit)).toBe(addDays(day, -4));
    await u.call('PATCH', `/tasks/${quit}`, { last_slip_on: addDays(day, 4) });
    expect(await slip(quit)).toBe(day);
    await u.call('PATCH', `/tasks/${quit}`, { last_slip_on: null });
    expect(await slip(quit)).toBe(null);
    expect((await u.call('PATCH', `/tasks/${quit}`, { last_slip_on: '04.10.2026' })).status).toBe(400);
    await u.call('PATCH', `/tasks/${other}`, { last_slip_on: addDays(day, -4) });
    expect(await slip(other)).toBe(null);
  });

  it('цель: сложнее — сразу, легче — с завтра; новая сложнее отменяет отложенную; у галочки цель не меняется', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await habit(u, { title: 'Слова', kind: 'count', target: 10 });
    const goals = async () => (await sb.from('task_goals').select('effective_from, target').eq('task_id', id).order('effective_from')).data;
    const step = async () => (await sb.from('tasks').select('step').eq('id', id).single()).data?.step;

    expect((await u.call('PATCH', `/tasks/${id}`, { target: 20 })).body).toEqual({ ok: true, goal_effective_from: day });
    expect(await goals()).toEqual([{ effective_from: day, target: 20 }]);
    expect(await step()).toBe(5);

    expect((await u.call('PATCH', `/tasks/${id}`, { target: 5 })).body.goal_effective_from).toBe(addDays(day, 1));
    expect(await goals()).toEqual([
      { effective_from: day, target: 20 },
      { effective_from: addDays(day, 1), target: 5 },
    ]);
    // Сегодня цель прежняя, история не показывает будущую.
    expect(byTitle((await u.call('GET', '/today')).body.tasks as { title: string; target: number }[])['Слова'].target).toBe(20);
    expect((await u.call('GET', `/tasks/${id}/history`)).body.goals).toEqual([{ effective_from: day, target: 20 }]);

    expect((await u.call('PATCH', `/tasks/${id}`, { target: 30 })).body.goal_effective_from).toBe(day);
    expect(await goals()).toEqual([{ effective_from: day, target: 30 }]);
    expect((await u.call('PATCH', `/tasks/${id}`, { target: 30 })).body.goal_effective_from).toBe(null);
    expect(await u.call('PATCH', `/tasks/${id}`, { target: -1 })).toMatchObject({ status: 400, body: { error: 'bad_target' } });

    const check = await habit(u, { title: 'Галочка' });
    expect((await u.call('PATCH', `/tasks/${check}`, { target: 5 })).body.goal_effective_from).toBe(null);
    expect((await sb.from('task_goals').select('target').eq('task_id', check)).data).toEqual([{ target: 1 }]);
  });

  it('привычка без истории целей: новая цель больше единицы — сразу; история начинается сегодня', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await bareTask(u.id, { title: 'Старая', kind: 'count' });
    expect((await u.call('GET', `/tasks/${id}/history`)).body).toEqual({ start: day, goals: [], logs: [] });
    expect((await u.call('PATCH', `/tasks/${id}`, { target: 3 })).body.goal_effective_from).toBe(day);
  });
});

describe.skipIf(!ready)('адреса с id', () => {
  it('id не числом — 404 (а не ошибка базы)', async () => {
    const u = await user();
    for (const [method, path] of [
      ['PATCH', '/tasks/abc'],
      ['POST', '/tasks/abc/archive'],
      ['POST', '/tasks/1.5/restore'],
      ['DELETE', '/tasks/abc'],
      ['GET', '/tasks/abc/history'],
      ['PATCH', '/todos/abc'],
      ['DELETE', '/todos/-1'],
    ] as const) {
      expect(await u.call(method, path, method === 'GET' ? undefined : {})).toMatchObject({ status: 404, body: { error: 'not_found' } });
    }
  });
});

describe.skipIf(!ready)('отметки', () => {
  it('задним числом — до двух лет; будущее, старее и кривая дата — 400; чужая привычка — 404', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await habit(u, { title: 'Отжимания', kind: 'count', target: 20 });
    expect((await u.call('PUT', '/logs', { task_id: id, value: 5, day: addDays(day, -731) })).status).toBe(200);
    for (const bad of [addDays(day, -732), addDays(day, 1), '2026-1-1', '2026-02-30']) {
      expect(await u.call('PUT', '/logs', { task_id: id, value: 5, day: bad })).toMatchObject({ status: 400, body: { error: 'bad_day' } });
    }
    expect((await u.call('PUT', '/logs', { task_id: 999999999, value: 1 })).status).toBe(404);
    expect((await sb.from('task_logs').select('day').eq('task_id', id)).data).toEqual([{ day: addDays(day, -731) }]);
  });

  it('история привычки: отметки от старых к новым, будущих нет; цели числами', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await habit(u, { title: 'Страницы', kind: 'count', target: 15 });
    await u.call('PUT', '/logs', { task_id: id, value: 5 });
    await u.call('PUT', '/logs', { task_id: id, value: 3, day: addDays(day, -2) });
    await sb.from('task_logs').insert({ task_id: id, user_id: u.id, day: addDays(day, 1), value: 9 });
    expect((await u.call('GET', `/tasks/${id}/history`)).body).toEqual({
      start: day,
      goals: [{ effective_from: day, target: 15 }],
      logs: [
        { day: addDays(day, -2), value: 3, status: null },
        { day, value: 5, status: null },
      ],
    });
  });

  it('«Считать»: значение не больше миллиона; ноль или пусто — снять отметку', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await habit(u, { title: 'Шаги', kind: 'count', target: 10000 });
    const logs = async () => (await sb.from('task_logs').select('day, value, status').eq('task_id', id)).data;
    await u.call('PUT', '/logs', { task_id: id, value: 5_000_000 });
    expect(await logs()).toEqual([{ day, value: 1_000_000, status: null }]);
    await u.call('PUT', '/logs', { task_id: id, value: null });
    expect(await logs()).toEqual([]);
    await u.call('PUT', '/logs', { task_id: id, value: 7 });
    await u.call('PUT', '/logs', { task_id: id, value: 0 });
    expect(await logs()).toEqual([]);
  });

  it('«Бросить»: срыв, «чисто», снять; неизвестный статус — 400', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await habit(u, { title: 'Без алкоголя', kind: 'abstain' });
    const logs = async () => (await sb.from('task_logs').select('day, value, status').eq('task_id', id)).data;
    await u.call('PUT', '/logs', { task_id: id, status: 'slip' });
    expect(await logs()).toEqual([{ day, value: 0, status: 'slip' }]);
    await u.call('PUT', '/logs', { task_id: id, status: null });
    expect(await logs()).toEqual([]);
    await u.call('PUT', '/logs', { task_id: id, status: 'clean', day: addDays(day, -1) });
    expect(await logs()).toEqual([{ day: addDays(day, -1), value: 1, status: 'clean' }]);
    expect(await u.call('PUT', '/logs', { task_id: id, status: 'maybe' })).toMatchObject({ status: 400, body: { error: 'bad_status' } });
    expect(await logs()).toHaveLength(1);
  });

  it('«Бросить» без истории целей: «чисто» после «последнего раза» записывается', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await bareTask(u.id, { title: 'Старый отказ', kind: 'abstain', last_slip_on: addDays(day, -5) });
    await u.call('PUT', '/logs', { task_id: id, status: 'clean', day: addDays(day, -2) });
    // «Чисто» в сам день «последнего раза» — тоже отметка (он не раньше первого дня).
    const quit = await habit(u, { title: 'Новый отказ', kind: 'abstain', last_slip_on: addDays(day, -5) });
    await u.call('PUT', '/logs', { task_id: quit, status: 'clean', day: addDays(day, -5) });
    expect((await sb.from('task_logs').select('task_id, day, status').in('task_id', [id, quit]).order('task_id')).data).toEqual([
      { task_id: id, day: addDays(day, -2), status: 'clean' },
      { task_id: quit, day: addDays(day, -5), status: 'clean' },
    ]);
  });
});

describe.skipIf(!ready)('дела: проверка полей', () => {
  it('время — «Ч:ММ» в пределах суток; длительность — до двух недель; место — без лишних пробелов; дата — от сегодня до года вперёд', async () => {
    const u = await user();
    const day = await todayOf(u);
    expect(await u.call('POST', '/todos', {})).toMatchObject({ status: 400, body: { error: 'title_required' } });
    for (const time of ['24:00', '12:60', 'полдень']) expect(await u.call('POST', '/todos', { title: 'Х', time })).toMatchObject({ status: 400, body: { error: 'bad_time' } });

    const row = async (input: Record<string, unknown>) =>
      (await sb.from('todos').select('title, day, time, duration_min, details').eq('id', (await u.call('POST', '/todos', { title: 'Дело', ...input })).body.id).single()).data;
    expect(await row({ time: '7:30', duration_min: 90.4, location: '  Кафе   «Снежинка»  ' })).toEqual({ title: 'Дело', day, time: '07:30:00', duration_min: 90, details: { location: 'Кафе «Снежинка»' } });
    expect(await row({ time: '', duration_min: 0, location: 42 })).toMatchObject({ time: null, duration_min: null, details: null });
    expect(await row({ duration_min: 20161, location: '   ' })).toMatchObject({ duration_min: null, details: null });
    expect(await row({ day: addDays(day, -3) })).toMatchObject({ day });
    expect(await row({ day: addDays(day, 400) })).toMatchObject({ day: addDays(day, 366) });
    expect(await row({ day: 'завтра' })).toMatchObject({ day });
    // 30 февраля впереди: V8 считает его 2 марта, а база такой даты не примет — это «сегодня».
    const year = Number(day.slice(0, 4));
    const feb30 = `${day < `${year}-02-30` ? year : year + 1}-02-30`;
    expect(await row({ day: feb30 })).toMatchObject({ day });
    expect(await row({ day: addDays(day, 2) })).toMatchObject({ day: addDays(day, 2) });
    expect((await row({ title: `  ${'Д'.repeat(130)}` }))!.title).toBe('Д'.repeat(120));
  });

  it('пачка дел: пустая или не список — 400; больше двенадцати — первые двенадцать', async () => {
    const u = await user();
    expect(await u.call('POST', '/todos/batch', { todos: [] })).toMatchObject({ status: 400, body: { error: 'no_todos' } });
    expect((await u.call('POST', '/todos/batch', { todos: 'Купить хлеб' })).status).toBe(400);
    const res = await u.call('POST', '/todos/batch', { todos: Array.from({ length: 15 }, (_, i) => ({ title: `Дело ${i + 1}` })) });
    expect(res.body.ids).toHaveLength(12);
    expect((await sb.from('todos').select('id').eq('user_id', u.id)).data).toHaveLength(12);
  });
});

describe.skipIf(!ready)('дела: правка', () => {
  it('время, день, место у своих дел; «скрыть» своё нельзя; пустая правка ничего не меняет', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await todo(u.id, { title: 'Встреча', day, time: '10:00', details: { location: 'Дом', link: 'https://meet.test/a' } });
    const row = async (x = id) => (await sb.from('todos').select('day, time, details, hidden, done_on').eq('id', x).single()).data!;

    await u.call('PATCH', `/todos/${id}`, { location: '  Офис  на  Ленина ' });
    expect((await row()).details).toEqual({ link: 'https://meet.test/a', location: 'Офис на Ленина' });
    await u.call('PATCH', `/todos/${id}`, { location: '' });
    expect((await row()).details).toEqual({ link: 'https://meet.test/a' });

    const plain = await todo(u.id, { title: 'Погулять', day });
    await u.call('PATCH', `/todos/${plain}`, { location: 'Парк' });
    expect((await row(plain)).details).toEqual({ location: 'Парк' });
    await u.call('PATCH', `/todos/${plain}`, { location: null });
    expect((await row(plain)).details).toBe(null);

    await u.call('PATCH', `/todos/${id}`, { time: null, day: addDays(day, -5), hidden: true });
    expect(await row()).toMatchObject({ time: null, day, hidden: false });
    expect(await u.call('PATCH', `/todos/${id}`, { time: '25:00' })).toMatchObject({ status: 400, body: { error: 'bad_time' } });
    const before = await row();
    expect((await u.call('PATCH', `/todos/${id}`, {})).body).toEqual({ ok: true });
    expect(await row()).toEqual(before);
    // Ни календарей, ни сети: выгружать некуда.
    expect(net.calls).toEqual([]);
  });

  it('событие из календаря: отметить нельзя, скрыть и вернуть можно, место не правится; несуществующее — 404', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await todo(u.id, { title: 'Планёрка', day, source: 'apple', details: { location: 'Зал' } });
    expect(await u.call('PATCH', `/todos/${id}`, { done: true })).toMatchObject({ status: 400, body: { error: 'event_not_checkable' } });

    await u.call('PATCH', `/todos/${id}`, { hidden: true, location: 'Другое место', title: 'Планёрка в 10' });
    const { data } = await sb.from('todos').select('title, hidden, details').eq('id', id).single();
    expect(data).toEqual({ title: 'Планёрка в 10', hidden: true, details: { location: 'Зал' } });
    expect((await u.call('GET', '/today')).body.todos).toEqual([]);
    expect((await u.call('GET', `/calendar?from=${day}&to=${day}`)).body.todos).toEqual([]);

    await u.call('PATCH', `/todos/${id}`, { hidden: false });
    expect((await u.call('GET', '/today')).body.todos.map((t: { title: string }) => t.title)).toEqual(['Планёрка в 10']);
    expect((await u.call('PATCH', '/todos/999999999', { done: true })).status).toBe(404);
  });

  it('разовое: «сделано» — на сегодня, снять — обратно; «Потом» — без сделанных, скрытых и повторяющихся', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await todo(u.id, { title: 'Позвонить', day: addDays(day, -2) });
    await u.call('PATCH', `/todos/${id}`, { done: true });
    expect((await sb.from('todos').select('done_on').eq('id', id).single()).data?.done_on).toBe(day);
    await u.call('PATCH', `/todos/${id}`, { done: false });
    expect((await sb.from('todos').select('done_on').eq('id', id).single()).data?.done_on).toBe(null);

    await todo(u.id, { title: 'Потом', day: addDays(day, 2), time: '08:00', details: { location: 'Банк' } });
    await todo(u.id, { title: 'Потом сделано', day: addDays(day, 2), done_on: day });
    await todo(u.id, { title: 'Потом скрыто', day: addDays(day, 2), source: 'google', hidden: true });
    await todo(u.id, { title: 'Потом повтор', day: addDays(day, 2), rrule: 'FREQ=DAILY' });
    const later = (await u.call('GET', '/todos/later')).body;
    expect(later).toEqual([expect.objectContaining({ title: 'Потом', day: addDays(day, 2), time: '08:00', done: false, recurring: false, source: null, details: { location: 'Банк' } })]);
  });

  it('удалить дело, связанное с событием: удаляется у нас, без подключения в календарь не ходим', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await todo(u.id, { title: 'Выгруженное', day, time: '09:00', external_href: 'https://caldav.test/cal/lifecommit-1.ics' });
    expect((await u.call('DELETE', `/todos/${id}`)).status).toBe(200);
    expect((await sb.from('todos').select('id').eq('id', id)).data).toEqual([]);
    expect(net.calls).toEqual([]);
  });

  it('«Календарь»: неверные границы — 400', async () => {
    const u = await user();
    for (const q of ['', '?from=2026-10-01', '?from=x&to=2026-10-02', '?from=2026-10-05&to=2026-10-01', '?from=2026-02-30&to=2026-03-02']) {
      expect(await u.call('GET', `/calendar${q}`)).toMatchObject({ status: 400, body: { error: 'bad_range' } });
    }
  });
});

describe.skipIf(!ready)('карта и итог', () => {
  it('карта: по умолчанию — год, больше 371 дня не отдаёт; не число — год', async () => {
    const u = await user();
    const day = await todayOf(u);
    const id = await habit(u, { title: 'Зарядка' });
    await sb.from('task_logs').insert([300, 370, 380].map((n) => ({ task_id: id, user_id: u.id, day: addDays(day, -n), value: 1 })));
    const days = async (q: string) => ((await u.call('GET', `/heatmap${q}`)).body.days as { day: string }[]).map((d) => d.day);
    expect(await days('')).toEqual([addDays(day, -300)]);
    expect(await days('?days=1000')).toEqual([addDays(day, -370), addDays(day, -300)]);
    expect(await days('?days=301')).toEqual([addDays(day, -300)]);
    expect(await days('?days=300')).toEqual([]);
    const odd = await u.call('GET', '/heatmap?days=год');
    expect(odd.status).toBe(200);
    expect(odd.body).toEqual({ today: day, days: [{ day: addDays(day, -300), score: 1 }] });
  });

  it('итог: больше тысячи отметок собираются порциями — ничего не теряется', async () => {
    const u = await user();
    const day = await todayOf(u);
    const count = await habit(u, { title: 'Страницы', kind: 'count', target: 10, unit: 'стр' });
    const check = await habit(u, { title: 'Зарядка' });
    const quit = await habit(u, { title: 'Без сахара', kind: 'abstain' });
    const rows = Array.from({ length: 366 }, (_, i) => addDays(day, -i)).flatMap((d) => [
      { task_id: count, user_id: u.id, day: d, value: 2 },
      { task_id: check, user_id: u.id, day: d, value: 1 },
      { task_id: quit, user_id: u.id, day: d, value: 1, status: 'clean' },
    ]);
    const { error } = await sb.from('task_logs').insert(rows);
    expect(error).toBeNull();
    const res = await u.call('GET', `/summary?from=${addDays(day, -365)}&to=${day}`);
    expect(res.status).toBe(200);
    expect(res.body.map((x: { title: string; total: number }) => [x.title, x.total])).toEqual([
      ['Страницы', 732],
      ['Зарядка', 366],
      ['Без сахара', 366],
    ]);
    expect(res.body[0].months.reduce((a: number, b: number) => a + b, 0)).toBe(732);
  });

  it('итог: без периода и с несуществующей датой — 400', async () => {
    const u = await user();
    expect(await u.call('GET', '/summary')).toMatchObject({ status: 400, body: { error: 'bad_range' } });
    expect(await u.call('GET', '/summary?from=2026-02-30&to=2026-03-10')).toMatchObject({ status: 400, body: { error: 'bad_range' } });
  });
});

describe.skipIf(!ready)('настройки', () => {
  it('неверные значения не применяются; час начала дня зажимается в 0–12', async () => {
    const u = await user();
    const before = (await u.call('GET', '/me')).body;
    const res = await u.call('PATCH', '/settings', { language_code: 'de', timezone: 'Mars/Base', remind_morning: '8:30', remind_evening: 'вечером' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(before);

    const hour = async (v: unknown) => (await u.call('PATCH', '/settings', { day_start_hour: v })).body.day_start_hour;
    expect(await hour(30)).toBe(12);
    expect(await hour(-5)).toBe(0);
    expect(await hour(5.9)).toBe(5);
  });

  it('время за пределами суток и час не числом — не применяются (а не 500)', async () => {
    const u = await user();
    await u.call('PATCH', '/settings', { remind_morning: '08:00', day_start_hour: 3 });
    for (const body of [{ remind_morning: '25:00' }, { remind_evening: '23:61' }, { day_start_hour: 'утро' }]) {
      const res = await u.call('PATCH', '/settings', body);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ remind_morning: '08:00', remind_evening: null, day_start_hour: 3 });
    }
  });

  it('всё сразу: язык, пояс, напоминания; снять напоминание — null; переключателя профиля больше нет', async () => {
    const u = await user();
    const res = await u.call('PATCH', '/settings', { language_code: 'en', timezone: 'Asia/Almaty', profile_mode: 'open', remind_morning: '07:15', remind_evening: '22:00' });
    expect(res.body).toMatchObject({ language_code: 'en', timezone: 'Asia/Almaty', remind_morning: '07:15', remind_evening: '22:00' });
    expect(res.body).not.toHaveProperty('profile_mode');
    expect((await sb.from('users').select('remind_morning').eq('id', u.id).single()).data?.remind_morning).toBe('07:15:00');
    expect((await u.call('PATCH', '/settings', { remind_morning: null })).body).toMatchObject({ remind_morning: null, remind_evening: '22:00' });
    expect((await u.call('GET', '/me')).body).toMatchObject({ language_code: 'en', remind_morning: null, remind_evening: '22:00' });
  });

  it('пустая правка — ничего не меняет', async () => {
    const u = await user();
    const before = (await u.call('GET', '/me')).body;
    const res = await u.call('PATCH', '/settings', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(before);
  });

  it('разрешили боту писать — bot_chat_ok', async () => {
    const u = await user();
    expect((await u.call('GET', '/me')).body.bot_chat_ok).toBe(false);
    expect((await u.call('POST', '/write-access')).body).toEqual({ ok: true });
    expect((await sb.from('users').select('bot_chat_ok').eq('id', u.id).single()).data?.bot_chat_ok).toBe(true);
  });

  it('подписка: действует — premium и без лимита; кончилась — нет', async () => {
    const u = await user();
    await sb.from('users').update({ premium_until: new Date(Date.now() + 86_400_000).toISOString() }).eq('id', u.id);
    expect((await u.call('GET', '/me')).body.premium).toBe(true);
    expect((await u.call('GET', '/today')).body.limits.max_tasks).toBe(null);
    await sb.from('users').update({ premium_until: new Date(Date.now() - 86_400_000).toISOString() }).eq('id', u.id);
    expect((await u.call('GET', '/me')).body.premium).toBe(false);
  });
});

describe.skipIf(!ready)('Bot API', () => {
  it('ответ ok — результат; отказ — TgError с кодом, описанием и параметрами', async () => {
    expect(await botApi(env, 'getMe', {})).toEqual({ id: 7000000001, username: 'LifeCommit_bot' });
    expect(tg.sent('getMe')).toHaveLength(1);

    tg.reply('sendMessage', { ok: false, error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: -100123 } });
    const upgraded = await botApi(env, 'sendMessage', { chat_id: -1, text: 'x' }).catch((e: unknown) => e);
    expect(upgraded).toBeInstanceOf(TgError);
    expect(upgraded).toMatchObject({ code: 400, parameters: { migrate_to_chat_id: -100123 }, message: 'Telegram sendMessage: Bad Request: group chat was upgraded to a supergroup chat' });

    // Без кода и описания — код ответа HTTP.
    tg.reply('sendMessage', { ok: false });
    const bare = await botApi(env, 'sendMessage', { chat_id: 1, text: 'x' }).catch((e: unknown) => e);
    expect(bare).toMatchObject({ code: 200, description: '200', parameters: {} });
  });

  it('фильтр «этот аккаунт или связанный» — целым числом', () => {
    expect(byTelegram(12.7)).toBe('id.eq.12,telegram_aliases.cs.{12}');
  });
});
