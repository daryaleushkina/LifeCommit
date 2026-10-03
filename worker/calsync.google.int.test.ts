// Синхронизация с Google Календарём через API, как это делает человек: вошёл через Google, выбрал календари,
// события пришли делами, свои дела со временем ушли в календарь, правки идут в обе стороны; и Apple, и Google сразу.
// Google — поддельный API с памятью (worker/test/calendars.ts): жетоны, страницы, отменённые разы повторов, 410.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, logicalDay } from './day';
import type { Env } from './env';
import { GOOGLE_SCOPES, type GoogleEvent } from './gcal';
import worker from './index';
import { readState, signState } from './secret';
import { APPLE_ID, GMAIL, gcal, gcalUrl, geventUrl, icloud, type Gcal } from './test/calendars';
import { ctx, dbReady, env, net, sb, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('тесты Google Календаря пропущены: нет локальной Supabase (pnpm db:start)');

afterEach(() => void vi.restoreAllMocks());

const TZ = 'Europe/Moscow';
const WORK = 'work@group.calendar.google.com';
const HOLIDAYS = 'ru.russian#holiday@group.v.calendar.google.com';
/** Момент по Москве так, как его пишет Google. */
const at = (day: string, hm: string) => ({ dateTime: `${day}T${hm}:00+03:00`, timeZone: TZ });
const local = (day: string, hm: string) => ({ dateTime: `${day}T${hm}:00`, timeZone: TZ });
const COLS = 'id, title, day, time, duration_min, rrule, exdates, source, external_uid, external_href, external_etag, calendar_url, details';

interface Row {
  id: number;
  title: string;
  day: string;
  time: string | null;
  duration_min: number | null;
  rrule: string | null;
  exdates: string[] | null;
  source: 'apple' | 'google' | null;
  external_uid: string | null;
  external_href: string | null;
  external_etag: string | null;
  calendar_url: string | null;
  details: Record<string, unknown> | null;
}

const rows = async (u: TestUser) => (await sb.from('todos').select(COLS).eq('user_id', u.id).order('id')).data as Row[];
const byUid = async (u: TestUser) => Object.fromEntries((await rows(u)).filter((r) => r.external_uid).map((r) => [r.external_uid!, r])) as Record<string, Row>;
const row = async (id: number) => (await sb.from('todos').select(COLS).eq('id', id).single()).data as Row;
const account = async (u: TestUser, provider: 'apple' | 'google' = 'google') => (await sb.from('calendar_accounts').select('*').eq('user_id', u.id).eq('provider', provider).single()).data!;
const create = async (u: TestUser, todo: Record<string, unknown>) => (await u.call('POST', '/todos', todo)).body.id as number;
/** Наше событие в Google — по метке lifecommit. */
const ownEvent = (g: Gcal, calId: string, todoId: number) => g.live(calId).find((e) => e.extendedProperties?.private?.lifecommit === String(todoId));

async function sync(u: TestUser) {
  await sb.from('calendar_accounts').update({ last_sync_at: '2000-01-01T00:00:00Z' }).eq('user_id', u.id).eq('status', 'ok');
  return u.call('POST', '/calendars/sync');
}

/** Браузер вернулся из входа Google с кодом. */
async function callback(u: TestUser) {
  const c = ctx();
  const res = await worker.fetch(new Request(`https://lifecommit.test/google/callback?${new URLSearchParams({ state: await signState(env.CALENDAR_KEY, u.id), code: 'code-1' })}`), env, c as unknown as ExecutionContext);
  await c.settle();
  return res.status;
}

async function callWith(u: TestUser, patch: Partial<Env>, method: string, path: string) {
  const c = ctx();
  const res = await worker.fetch(new Request(`https://lifecommit.test/api${path}`, { method, headers: { Authorization: `tma ${u.initData}` } }), { ...env, ...patch }, c as unknown as ExecutionContext);
  await c.settle();
  return { status: res.status, body: await res.json() };
}

const eventsOf = (g: Gcal, calId: string) => g.sent('GET', `${gcalUrl(calId)}/events?`);

const plan = (d: string): GoogleEvent => ({
  id: 'plan',
  summary: 'Планёрка',
  start: at(d, '10:00'),
  end: at(d, '10:30'),
  location: 'Переговорка 5',
  hangoutLink: 'https://meet.google.com/xyz-abcd-efg',
  htmlLink: 'https://calendar.google.com/event?eid=plan',
  attendees: [
    { email: GMAIL, self: true },
    { email: 'masha@example.com', displayName: 'Маша' },
    { email: 'room5@resource.calendar.google.com', displayName: 'Переговорка 5', resource: true },
  ],
});

/** Что лежит в Google Календаре человека. */
function phone(g: Gcal, d: string) {
  g.put('primary', plan(d));
  g.put('primary', { id: 'vacation', summary: 'Отпуск', start: { date: addDays(d, 5) }, end: { date: addDays(d, 12) } });
  // Бассейн по неделям: один раз исключён в самом повторе, один перенесли на вечер, один отменили.
  g.put('primary', { id: 'swim', summary: 'Бассейн', start: at(d, '07:00'), end: at(d, '08:00'), recurrence: ['RRULE:FREQ=WEEKLY', `EXDATE;TZID=Europe/Moscow:${addDays(d, 21).replace(/-/g, '')}T070000`] });
  g.put('primary', { id: 'swim_7', recurringEventId: 'swim', originalStartTime: at(addDays(d, 7), '07:00'), summary: 'Бассейн (вечером)', start: at(addDays(d, 7), '19:00'), end: at(addDays(d, 7), '20:00') });
  g.put('primary', { id: 'swim_14', recurringEventId: 'swim', originalStartTime: at(addDays(d, 14), '07:00'), status: 'cancelled' });
  g.put('primary', { id: 'old', summary: 'Давнее', start: { date: addDays(d, -40) }, end: { date: addDays(d, -39) } });
  g.put(WORK, { id: 'review', summary: 'Ревью', start: at(addDays(d, 2), '12:00'), end: at(addDays(d, 2), '13:00') });
  g.put(HOLIDAYS, { id: 'holiday', summary: 'День народного единства', start: { date: addDays(d, 1) }, end: { date: addDays(d, 2) } });
}

/** Человек с делом «Стоматолог» на завтра 15:30, подключил Google и подтвердил выбор календарей. */
async function connected(g = gcal()) {
  const u = await user({ timezone: TZ });
  const d = logicalDay(TZ, 4);
  phone(g, d);
  const dentist = await create(u, { title: 'Стоматолог', day: addDays(d, 1), time: '15:30', duration_min: 45, location: 'Клиника на Тверской' });
  expect(await callback(u)).toBe(200);
  const acc = await account(u);
  expect(await u.call('POST', `/calendars/${acc.id}/confirm`)).toMatchObject({ status: 200, body: { ok: true } });
  g.requests.length = 0;
  return { u, d, g, dentist, acc };
}

describe.skipIf(!ready)('Google: подключение', () => {
  it('после входа ждём выбора календарей; выбрали — забираем события и выгружаем наши дела', async () => {
    const u = await user({ timezone: TZ });
    const d = logicalDay(TZ, 4);
    const g = gcal();
    phone(g, d);
    const dentist = await create(u, { title: 'Стоматолог', day: addDays(d, 1), time: '15:30', duration_min: 45, location: 'Клиника на Тверской' });

    expect(await callback(u)).toBe(200);
    expect(g.sent('GET', `${gcalUrl(GMAIL)}/events`)).toEqual([]);
    const acc = await account(u);
    // Свои календари — с галочкой, подписка на праздники — без (и писать туда нельзя), «только занятость» — не видна.
    expect((await u.call('GET', '/calendars')).body).toEqual([
      {
        id: acc.id,
        provider: 'google',
        login: GMAIL,
        status: 'setup',
        last_sync_at: null,
        default_url: gcalUrl(GMAIL),
        collections: [
          { url: gcalUrl(GMAIL), name: GMAIL, color: '#0b8043', enabled: true, writable: true },
          { url: gcalUrl(HOLIDAYS), name: 'Праздники', color: null, enabled: false, writable: false },
          { url: gcalUrl(WORK), name: 'Работа', color: '#3f51b5', enabled: true, writable: true },
        ],
      },
    ]);
    // Список календарей — постранично.
    expect(g.sent('GET', `${'https://www.googleapis.com/calendar/v3'}/users/me/calendarList`)).toHaveLength(2);

    // До выбора: «Обновить» ничего не забирает, новое дело в календарь не уходит.
    expect(await u.call('POST', '/calendars/sync')).toMatchObject({ body: { ok: true } });
    const call = await create(u, { title: 'Позвонить маме', day: addDays(d, 1), time: '20:00' });
    expect(g.sent('GET', `${gcalUrl(GMAIL)}/events`)).toEqual([]);
    expect(g.sent('POST')).toEqual([]);

    // Включили праздники и подтвердили.
    expect((await u.call('PATCH', `/calendars/${acc.id}/collections`, { url: gcalUrl(HOLIDAYS), enabled: true })).status).toBe(200);
    expect(await u.call('POST', `/calendars/${acc.id}/confirm`)).toMatchObject({ status: 200, body: { ok: true } });
    expect(await account(u)).toMatchObject({ status: 'ok', default_url: gcalUrl(GMAIL) });

    const got = await byUid(u);
    expect(got['g:plan']).toMatchObject({
      source: 'google',
      title: 'Планёрка',
      day: d,
      time: '10:00:00',
      duration_min: 30,
      calendar_url: gcalUrl(GMAIL),
      external_href: geventUrl(GMAIL, 'plan'),
      // переговорка — не участник; сама Даша — тоже
      details: { location: 'Переговорка 5', link: 'https://meet.google.com/xyz-abcd-efg', people_count: 2, people: ['Маша'], open_url: 'https://calendar.google.com/event?eid=plan' },
    });
    expect(got['g:vacation']).toMatchObject({ day: addDays(d, 5), time: null, duration_min: null });
    expect(got['g:swim']).toMatchObject({ rrule: 'FREQ=WEEKLY', exdates: [addDays(d, 7), addDays(d, 14), addDays(d, 21)], time: '07:00:00', duration_min: 60 });
    expect(got[`g:swim#${addDays(d, 7)}`]).toMatchObject({ title: 'Бассейн (вечером)', day: addDays(d, 7), time: '19:00:00', rrule: null, exdates: [] });
    expect(got[`g:swim#${addDays(d, 14)}`]).toBeUndefined();
    expect(got['g:old']).toBeUndefined();
    expect(got['g:review']).toMatchObject({ calendar_url: gcalUrl(WORK) });
    expect(got['g:holiday']).toMatchObject({ title: 'День народного единства', calendar_url: gcalUrl(HOLIDAYS) });
    // события основного календаря — двумя страницами
    expect(eventsOf(g, GMAIL)).toHaveLength(2);

    // Наши дела со временем — в основной календарь, с меткой lifecommit.
    const posted = g.sent('POST');
    expect(posted.map((p) => p.url)).toEqual([`${gcalUrl(GMAIL)}/events`, `${gcalUrl(GMAIL)}/events`]);
    expect(posted.map((p) => p.body).find((b) => b.summary === 'Стоматолог')).toEqual({
      summary: 'Стоматолог',
      location: 'Клиника на Тверской',
      start: local(addDays(d, 1), '15:30'),
      end: local(addDays(d, 1), '16:15'),
      extendedProperties: { private: { lifecommit: String(dentist) } },
    });
    const ev = ownEvent(g, GMAIL, dentist)!;
    expect(await row(dentist)).toMatchObject({ external_uid: `lifecommit-${dentist}`, external_href: geventUrl(GMAIL, ev.id), external_etag: ev.etag, calendar_url: gcalUrl(GMAIL) });
    expect(ownEvent(g, GMAIL, call)).toMatchObject({ summary: 'Позвонить маме' });

    // Подтвердить ещё раз — уже подключён, ничего не делаем; чужое подключение — 404.
    g.requests.length = 0;
    expect(await u.call('POST', `/calendars/${acc.id}/confirm`)).toMatchObject({ status: 200, body: { ok: true } });
    expect(g.requests).toEqual([]);
    expect(await (await user()).call('POST', `/calendars/${acc.id}/confirm`)).toMatchObject({ status: 404, body: { error: 'not_found' } });
  });

  it('пока человек не выбрал сам, наши дела пишем в свой календарь, где больше всего событий (не в подписку)', async () => {
    const u = await user({ timezone: TZ });
    const d = logicalDay(TZ, 4);
    const g = gcal();
    g.put('primary', { id: 'one', summary: 'Одно', start: at(d, '09:00'), end: at(d, '10:00') });
    for (const i of [1, 2, 3]) g.put(WORK, { id: `w${i}`, summary: `Работа ${i}`, start: at(d, `1${i}:00`), end: at(d, `1${i}:30`) });
    for (const i of [1, 2, 3, 4, 5]) g.put(HOLIDAYS, { id: `h${i}`, summary: `Праздник ${i}`, start: { date: addDays(d, i) }, end: { date: addDays(d, i + 1) } });
    const id = await create(u, { title: 'Отчёт', day: d, time: '18:00' });
    await callback(u);
    const acc = await account(u);
    await u.call('PATCH', `/calendars/${acc.id}/collections`, { url: gcalUrl(HOLIDAYS), enabled: true });
    await u.call('POST', `/calendars/${acc.id}/confirm`);
    expect(await account(u)).toMatchObject({ default_url: gcalUrl(WORK), default_manual: false });
    expect(g.sent('POST').map((p) => p.url)).toEqual([`${gcalUrl(WORK)}/events`]);
    expect(ownEvent(g, WORK, id)).toBeDefined();
  });

  it('Google не ответил при подтверждении — 502, подключение «ошибка»', async () => {
    const u = await user();
    const g = gcal();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await callback(u);
    const acc = await account(u);
    g.down = 500;
    expect(await u.call('POST', `/calendars/${acc.id}/confirm`)).toMatchObject({ status: 502, body: { error: 'google_unreachable' } });
    expect((await account(u)).status).toBe('error');
  });

  it('адрес входа Google подписан человеком; без настроек Google — 503; без refresh token — «не получилось»', async () => {
    const u = await user();
    const res = await u.call('GET', '/calendars/google/url');
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'test-google-client',
      redirect_uri: 'https://lifecommit.test/google/callback',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });
    expect(await readState(env.CALENDAR_KEY, url.searchParams.get('state')!)).toBe(u.id);
    expect(await callWith(u, { GOOGLE_CLIENT_ID: '' }, 'GET', '/calendars/google/url')).toMatchObject({ status: 503, body: { error: 'calendar_unavailable' } });
    expect(await callWith(u, { CALENDAR_KEY: '' }, 'GET', '/calendars/google/url')).toMatchObject({ status: 503 });

    // Google не отдал refresh token — без него синхронизировать нечем.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    gcal();
    net.on('https://oauth2.googleapis.com/token', () => Response.json({ access_token: 'access-0', scope: GOOGLE_SCOPES.join(' ') }));
    expect(await callback(u)).toBe(502);
    expect((await sb.from('calendar_accounts').select('id').eq('user_id', u.id)).data).toEqual([]);
  });
});

describe.skipIf(!ready)('Google: из календаря к нам', () => {
  it('«Обновить» по жетону: перенесённый раз повтора, поправленное и удалённое событие; удалили весь повтор', async () => {
    const { u, d, g } = await connected();
    g.put('primary', { id: 'swim_28', recurringEventId: 'swim', originalStartTime: at(addDays(d, 28), '07:00'), summary: 'Бассейн с тренером', start: at(addDays(d, 28), '08:00'), end: at(addDays(d, 28), '09:00') });
    g.put('primary', { ...plan(d), summary: 'Планёрка (перенесли)', start: at(d, '12:00'), end: at(d, '12:30') });
    g.cancel(WORK, 'review');

    expect(await sync(u)).toMatchObject({ status: 200, body: { ok: true } });
    const got = await byUid(u);
    expect(got[`g:swim#${addDays(d, 28)}`]).toMatchObject({ title: 'Бассейн с тренером', time: '08:00:00' });
    // сам повтор не менялся, а исключённый день дописался к уже известным
    expect(got['g:swim']!.exdates).toEqual([addDays(d, 7), addDays(d, 14), addDays(d, 21), addDays(d, 28)]);
    expect(got['g:plan']).toMatchObject({ title: 'Планёрка (перенесли)', time: '12:00:00' });
    expect(got['g:review']).toBeUndefined();
    expect(g.sent('GET', `${gcalUrl(GMAIL)}/events?`).every((r) => new URL(r.url).searchParams.get('syncToken'))).toBe(true);

    g.cancel('primary', 'swim');
    await sync(u);
    expect(Object.keys(await byUid(u)).filter((k) => k.startsWith('g:swim'))).toEqual([]);
  });

  it('наше событие поправили в Google — меняется наше дело', async () => {
    const { u, d, g, dentist } = await connected();
    const ev = ownEvent(g, GMAIL, dentist)!;
    g.put('primary', { ...ev, summary: 'Стоматолог (перенесли)', start: at(addDays(d, 2), '09:00'), end: at(addDays(d, 2), '09:45') });
    await sync(u);
    expect(await row(dentist)).toMatchObject({ title: 'Стоматолог (перенесли)', day: addDays(d, 2), time: '09:00:00', duration_min: 45, source: null });
  });

  it('жетон устарел (410) — перечитываем целиком и убираем пропавшее', async () => {
    const { u, g } = await connected();
    g.cancel(WORK, 'review');
    g.expireTokens();
    expect(await sync(u)).toMatchObject({ body: { ok: true } });
    expect((await byUid(u))['g:review']).toBeUndefined();
    expect((await byUid(u))['g:plan']).toBeDefined();
    expect(eventsOf(g, WORK).map((r) => Boolean(new URL(r.url).searchParams.get('syncToken')))).toEqual([true, false]);
  });
});

describe.skipIf(!ready)('Google: от нас в календарь', () => {
  it('своё дело: создали, поправили, событие удалили в Google — создаём заново; убрали время; удалили', async () => {
    const { u, d, g } = await connected();
    const id = await create(u, { title: 'Встреча', day: addDays(d, 1), time: '23:45' });
    // конец — уже следующего дня
    expect(g.sent('POST')[0]!.body).toMatchObject({ start: local(addDays(d, 1), '23:45'), end: local(addDays(d, 2), '00:15') });
    const href = (await row(id)).external_href!;
    expect(href).toBe(geventUrl(GMAIL, ownEvent(g, GMAIL, id)!.id));

    await u.call('PATCH', `/todos/${id}`, { title: 'Встреча с Машей' });
    expect(g.sent('PATCH').map((r) => [r.url, r.body.summary, r.body.status])).toEqual([[href, 'Встреча с Машей', 'confirmed']]);
    expect((await row(id)).external_etag).toBe(ownEvent(g, GMAIL, id)!.etag);

    // Событие удалили в Google между синхронизациями — правка создаёт его заново.
    g.cancel('primary', ownEvent(g, GMAIL, id)!.id);
    g.requests.length = 0;
    await u.call('PATCH', `/todos/${id}`, { time: '09:00' });
    expect(g.requests.filter((r) => r.url.startsWith('https://www.googleapis.com')).map((r) => r.method)).toEqual(['PATCH', 'POST']);
    const again = ownEvent(g, GMAIL, id)!;
    expect(again).toMatchObject({ summary: 'Встреча с Машей', start: local(addDays(d, 1), '09:00') });
    expect((await row(id)).external_href).toBe(geventUrl(GMAIL, again.id));

    // Убрали время — событие удаляется, связь забыта.
    g.requests.length = 0;
    await u.call('PATCH', `/todos/${id}`, { time: null });
    expect(g.sent('DELETE').map((r) => r.url)).toEqual([geventUrl(GMAIL, again.id)]);
    expect(ownEvent(g, GMAIL, id)).toBeUndefined();
    expect(await row(id)).toMatchObject({ external_uid: null, external_href: null });

    // Вернули время и удалили дело — событие тоже удаляется.
    await u.call('PATCH', `/todos/${id}`, { time: '10:00' });
    const last = ownEvent(g, GMAIL, id)!;
    await u.call('DELETE', `/todos/${id}`);
    expect(g.sent('DELETE').at(-1)!.url).toBe(geventUrl(GMAIL, last.id));
    expect(ownEvent(g, GMAIL, id)).toBeUndefined();

    // Событие уже удалили в Google — удаление дела проходит молча.
    const gone = await create(u, { title: 'Уже нет', day: d, time: '22:00' });
    g.cancel('primary', ownEvent(g, GMAIL, gone)!.id);
    expect((await u.call('DELETE', `/todos/${gone}`)).status).toBe(200);
    expect((await account(u)).status).toBe('ok');
  });

  it('событие из Google поправили у нас — меняются только название и время; на несколько дней — не сжимается', async () => {
    const { u, d, g } = await connected();
    const got = await byUid(u);

    await u.call('PATCH', `/todos/${got['g:plan']!.id}`, { title: 'Планёрка (перенесли)', time: '11:00' });
    expect(g.sent('PATCH').map((r) => [r.url, r.body])).toEqual([[geventUrl(GMAIL, 'plan'), { summary: 'Планёрка (перенесли)', start: local(d, '11:00'), end: local(d, '11:30') }]]);
    // участники и место остались
    expect(g.event('primary', 'plan')).toMatchObject({ location: 'Переговорка 5', attendees: plan(d).attendees });
    expect((await row(got['g:plan']!.id)).external_etag).toBe(g.event('primary', 'plan')!.etag);

    // Повтор: день начала серии остаётся, правило — тоже.
    await u.call('PATCH', `/todos/${got['g:swim']!.id}`, { title: 'Бассейн утром' });
    expect(g.event('primary', 'swim')).toMatchObject({ summary: 'Бассейн утром', start: local(d, '07:00'), recurrence: ['RRULE:FREQ=WEEKLY', expect.stringContaining('EXDATE')] });

    // Отпуск на неделю: правка названия оставляет все дни.
    await u.call('PATCH', `/todos/${got['g:vacation']!.id}`, { title: 'Отпуск в Сочи' });
    expect(g.event('primary', 'vacation')).toMatchObject({ summary: 'Отпуск в Сочи', start: { date: addDays(d, 5) }, end: { date: addDays(d, 12) } });
  });
});

describe.skipIf(!ready)('Google: сбои', () => {
  it('доступ отозвали — «нужно подключить заново»; правка дела тоже это замечает; Google упал — «ошибка»', async () => {
    const { u, g, acc, dentist } = await connected();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    g.revoked = true;
    expect(await sync(u)).toMatchObject({ body: { ok: false } });
    expect(await account(u)).toMatchObject({ status: 'auth_failed', last_error: expect.stringContaining('invalid_grant') });

    await sb.from('calendar_accounts').update({ status: 'ok' }).eq('id', acc.id);
    await u.call('PATCH', `/todos/${dentist}`, { title: 'Стоматолог, кабинет 3' });
    expect((await account(u)).status).toBe('auth_failed');
    expect(g.sent('PATCH')).toEqual([]);

    await sb.from('calendar_accounts').update({ status: 'ok' }).eq('id', acc.id);
    g.revoked = false;
    g.down = 500;
    expect(await sync(u)).toMatchObject({ body: { ok: false } });
    expect((await account(u)).status).toBe('error');
  });
});

describe.skipIf(!ready)('Apple и Google вместе', () => {
  it('новые дела — в подключённый последним, старые правятся там, где лежат; отключили Google — доступ отозван, Apple не тронут', async () => {
    const u = await user({ timezone: TZ });
    const d = logicalDay(TZ, 4);
    const cloud = icloud();
    const first = await create(u, { title: 'В айклауде', day: addDays(d, 1), time: '09:00' });
    expect((await u.call('POST', '/calendars/apple', { login: APPLE_ID, password: cloud.password })).status).toBe(201);
    const appleHref = (await row(first)).external_href!;
    expect(appleHref).toBe(`${cloud.url('home')}lifecommit-${first}.ics`);

    const g = gcal();
    g.put('primary', plan(d));
    await callback(u);
    await u.call('POST', `/calendars/${(await account(u)).id}/confirm`);
    // уже выгруженное в iCloud в Google не дублируем
    expect(g.sent('POST')).toEqual([]);

    const second = await create(u, { title: 'В гугле', day: addDays(d, 1), time: '11:00' });
    expect(ownEvent(g, GMAIL, second)).toBeDefined();
    expect(cloud.event(`${cloud.url('home')}lifecommit-${second}.ics`)).toBeUndefined();

    cloud.requests.length = 0;
    g.requests.length = 0;
    await u.call('PATCH', `/todos/${first}`, { title: 'В айклауде (правка)' });
    expect(cloud.sent('PUT').map((r) => r.url)).toEqual([appleHref]);
    expect(g.requests).toEqual([]);

    // «Обновить» по обоим: Apple своё больше не выгружает — пишем сейчас в Google.
    await sync(u);
    expect(cloud.sent('PUT')).toHaveLength(1);

    expect(await u.call('DELETE', '/calendars/google')).toMatchObject({ status: 200, body: { ok: true } });
    expect(g.revokedTokens).toEqual(['refresh-1']);
    expect((await byUid(u))['g:plan']).toBeUndefined();
    expect(await row(second)).toMatchObject({ external_href: null, external_uid: null });
    expect((await row(first)).external_href).toBe(appleHref);
    expect((await account(u, 'apple')).status).toBe('ok');

    await u.call('DELETE', '/calendars/apple');
    expect((await row(first)).external_href).toBeNull();
    expect((await rows(u)).map((r) => r.title).sort()).toEqual(['В айклауде (правка)', 'В гугле']);
  });
});
