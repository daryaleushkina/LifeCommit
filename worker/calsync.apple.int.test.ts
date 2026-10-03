// Синхронизация с Apple (iCloud CalDAV) через API, как это делает человек: подключил календарь паролем приложения,
// события пришли делами, свои дела со временем ушли в календарь, правки идут в обе стороны. iCloud — поддельный
// сервер с памятью (worker/test/calendars.ts): переадресация на свой узел, жетоны синхронизации, ETag и 412.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, logicalDay } from './day';
import type { Env } from './env';
import worker from './index';
import { APPLE_ID, ICLOUD_ENTRY, ICLOUD_NODE, icloud, ics, stamp, vevent, type Icloud } from './test/calendars';
import { ctx, dbReady, env, sb, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('тесты календаря Apple пропущены: нет локальной Supabase (pnpm db:start)');

afterEach(() => void vi.restoreAllMocks());

const TZ = 'Europe/Moscow';
const MSK = (day: string, hm: string) => `TZID=Europe/Moscow:${stamp(day, hm)}`;
const COLS = 'id, title, day, time, duration_min, rrule, exdates, source, external_uid, external_href, external_etag, calendar_url, details, done_on';

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
  done_on: string | null;
}

async function rows(u: TestUser): Promise<Row[]> {
  return (await sb.from('todos').select(COLS).eq('user_id', u.id).order('id')).data as Row[];
}
const byUid = async (u: TestUser) => Object.fromEntries((await rows(u)).filter((r) => r.external_uid).map((r) => [r.external_uid!, r])) as Record<string, Row>;
const row = async (id: number) => (await sb.from('todos').select(COLS).eq('id', id).single()).data as Row;
const account = async (u: TestUser) => (await sb.from('calendar_accounts').select('*').eq('user_id', u.id).eq('provider', 'apple').single()).data!;

const connect = (u: TestUser, cloud: Icloud) => u.call('POST', '/calendars/apple', { login: APPLE_ID, password: cloud.password });

/** «Обновить». Чаще раза в минуту синхронизация не ходит — делаем вид, что прошлая была давно. */
async function sync(u: TestUser) {
  await sb.from('calendar_accounts').update({ last_sync_at: '2000-01-01T00:00:00Z' }).eq('user_id', u.id).eq('status', 'ok');
  return u.call('POST', '/calendars/sync');
}

/** Запрос к API с другими настройками Worker'а (например, без ключа календарей). */
async function callWith(u: TestUser, patch: Partial<Env>, method: string, path: string, body?: unknown) {
  const c = ctx();
  const res = await worker.fetch(
    new Request(`https://lifecommit.test/api${path}`, { method, headers: { Authorization: `tma ${u.initData}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ...env, ...patch },
    c as unknown as ExecutionContext,
  );
  await c.settle();
  return { status: res.status, body: await res.json() };
}

const create = async (u: TestUser, todo: Record<string, unknown>) => (await u.call('POST', '/todos', todo)).body.id as number;
const ownHref = (cloud: Icloud, slug: string, id: number) => `${cloud.url(slug)}lifecommit-${id}.ics`;

/** Что лежит в календаре человека на телефоне. */
function phone(cloud: Icloud, d: string) {
  return {
    meet: cloud.put(
      'home',
      'meet.ics',
      ics(
        vevent('meet-1', [
          'SUMMARY:Созвон с командой',
          `DTSTART;${MSK(d, '11:00')}`,
          `DTEND;${MSK(d, '12:00')}`,
          'LOCATION:https://meet.google.com/abc-defg-hij',
          'ATTENDEE;CN=Маша:mailto:masha@example.com',
          `ATTENDEE;CN=Даша:mailto:${APPLE_ID}`,
          'BEGIN:VALARM',
          'TRIGGER:-PT15M',
          'ACTION:DISPLAY',
          'END:VALARM',
        ]),
      ),
    ),
    bday: cloud.put('home', 'bday.ics', ics(vevent('bday-1', ['SUMMARY:ДР Маши', 'DTSTART;VALUE=DATE:19950310', 'RRULE:FREQ=YEARLY']))),
    // Йога по неделям: один раз перенесли на вечер, сегодняшнюю отменили.
    yoga: cloud.put(
      'home',
      'yoga.ics',
      ics(
        vevent('yoga', ['SUMMARY:Йога', `DTSTART;${MSK(addDays(d, -14), '08:00')}`, 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY']),
        vevent('yoga', [`RECURRENCE-ID;${MSK(addDays(d, -7), '08:00')}`, 'SUMMARY:Йога (позже)', `DTSTART;${MSK(addDays(d, -7), '19:00')}`, 'DURATION:PT1H']),
        vevent('yoga', [`RECURRENCE-ID;${MSK(d, '08:00')}`, 'STATUS:CANCELLED', `DTSTART;${MSK(d, '08:00')}`]),
      ),
    ),
    // Разовое событие давнее месяца — уже не дело.
    old: cloud.put('home', 'old.ics', ics(vevent('old-1', ['SUMMARY:Давнее', `DTSTART;VALUE=DATE:${stamp(addDays(d, -40))}`]))),
    review: cloud.put('work', 'review.ics', ics(vevent('review-1', ['SUMMARY:Ревью', `DTSTART;${MSK(addDays(d, 2), '10:00')}`, `DTEND;${MSK(addDays(d, 2), '11:00')}`]))),
  };
}

/** Человек с делом «Стоматолог» на завтра 15:30 и подключённым iCloud. */
async function connected(cloud = icloud()) {
  const u = await user({ timezone: TZ });
  const d = logicalDay(TZ, 4);
  const hrefs = phone(cloud, d);
  const dentist = await create(u, { title: 'Стоматолог', day: addDays(d, 1), time: '15:30', duration_min: 45, location: 'Клиника на Тверской' });
  expect((await connect(u, cloud)).status).toBe(201);
  cloud.requests.length = 0;
  return { u, d, cloud, hrefs, dentist, acc: await account(u) };
}

const syncBodies = (cloud: Icloud) => cloud.sent('REPORT').filter((r) => r.body.includes('sync-collection'));

describe.skipIf(!ready)('Apple: подключение', () => {
  it('находит календари, забирает события делами и выгружает наши дела со временем', async () => {
    const u = await user({ timezone: TZ });
    const d = logicalDay(TZ, 4);
    const cloud = icloud();
    phone(cloud, d);
    const dentist = await create(u, { title: 'Стоматолог', day: addDays(d, 1), time: '15:30', duration_min: 45, location: 'Клиника на Тверской' });
    const milk = await create(u, { title: 'Купить молоко' });
    const gym = await create(u, { title: 'Зарядка', time: '07:00' });
    await u.call('PATCH', `/todos/${gym}`, { done: true });
    const past = (await sb.from('todos').insert({ user_id: u.id, title: 'Прошедшее', day: addDays(d, -2), time: '10:00' }).select('id').single()).data!.id as number;

    expect(await connect(u, cloud)).toMatchObject({ status: 201, body: { ok: true } });

    // iCloud отправил на свой узел — дальше все запросы туда.
    expect(cloud.requests[0]).toMatchObject({ method: 'PROPFIND', url: ICLOUD_ENTRY });
    expect(cloud.requests.slice(1).every((r) => r.url.startsWith(ICLOUD_NODE))).toBe(true);

    const acc = await account(u);
    expect(acc).toMatchObject({ login: APPLE_ID, status: 'ok', home_url: `${ICLOUD_NODE}/1234/calendars/`, default_url: cloud.url('home'), default_manual: false });
    expect(acc.last_sync_at).not.toBeNull();
    // пароль приложения — только зашифрованным
    expect(acc.secret).not.toContain(cloud.password);

    // Напоминания (только VTODO) и служебные «входящие» — не календари.
    expect((await u.call('GET', '/calendars')).body).toEqual([
      {
        id: acc.id,
        provider: 'apple',
        login: APPLE_ID,
        status: 'ok',
        last_sync_at: expect.any(String),
        default_url: cloud.url('home'),
        collections: [
          { url: cloud.url('home'), name: 'Дом', color: '#1BADF8', enabled: true, writable: true },
          { url: cloud.url('work'), name: 'Работа', color: '#1BADF8', enabled: true, writable: true },
        ],
      },
    ]);

    const got = await byUid(u);
    expect(Object.keys(got).sort()).toEqual(['bday-1', `lifecommit-${dentist}`, 'meet-1', 'review-1', 'yoga', `yoga#${addDays(d, -7)}`].sort());
    expect(got['meet-1']).toMatchObject({
      source: 'apple',
      title: 'Созвон с командой',
      day: d,
      time: '11:00:00',
      duration_min: 60,
      rrule: null,
      calendar_url: cloud.url('home'),
      // ссылка в месте — это созвон; сама Даша среди участников не считается
      details: { link: 'https://meet.google.com/abc-defg-hij', people_count: 2, people: ['Маша'] },
    });
    expect(got['bday-1']).toMatchObject({ day: '1995-03-10', time: null, rrule: 'FREQ=YEARLY' });
    expect(got.yoga).toMatchObject({ rrule: 'FREQ=WEEKLY', exdates: [addDays(d, -7), d], time: '08:00:00', duration_min: 60 });
    expect(got[`yoga#${addDays(d, -7)}`]).toMatchObject({ title: 'Йога (позже)', day: addDays(d, -7), time: '19:00:00', rrule: null });
    expect(got['review-1']).toMatchObject({ calendar_url: cloud.url('work'), day: addDays(d, 2) });

    // В календарь ушло одно дело: со временем, не сделанное, не в прошлом.
    const puts = cloud.sent('PUT');
    expect(puts.map((p) => p.url)).toEqual([ownHref(cloud, 'home', dentist)]);
    expect(puts[0]!.headers.get('If-None-Match')).toBe('*');
    expect(puts[0]!.body).toContain(`UID:lifecommit-${dentist}`);
    expect(puts[0]!.body).toContain('SUMMARY:Стоматолог');
    expect(puts[0]!.body).toContain('LOCATION:Клиника на Тверской');
    expect(puts[0]!.body).toContain(`DTSTART:${stamp(addDays(d, 1), '12:30')}Z`);
    expect(puts[0]!.body).toContain('DURATION:PT45M');
    expect(await row(dentist)).toMatchObject({ source: null, external_href: ownHref(cloud, 'home', dentist), calendar_url: cloud.url('home'), external_etag: cloud.event(ownHref(cloud, 'home', dentist))!.etag });
    for (const id of [milk, gym, past]) expect((await row(id)).external_href).toBeNull();

    // Вкладка «Календарь»: события рядом с делами, отменённой сегодня йоги нет.
    const cal = (await u.call('GET', `/calendar?from=${addDays(d, -7)}&to=${addDays(d, 2)}`)).body.todos as { title: string; day: string; source: string | null }[];
    expect(cal).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Созвон с командой', day: d, source: 'apple', time: '11:00', duration_min: 60, recurring: false }),
        expect.objectContaining({ title: 'Йога (позже)', day: addDays(d, -7), source: 'apple' }),
        expect.objectContaining({ title: 'Ревью', day: addDays(d, 2), source: 'apple' }),
        expect.objectContaining({ title: 'Стоматолог', day: addDays(d, 1), source: null }),
      ]),
    );
    expect(cal.filter((t) => t.title === 'Йога')).toEqual([]);
  });

  it('событий больше сотни — тексты забираем пачками по 100', async () => {
    const u = await user({ timezone: TZ });
    const d = logicalDay(TZ, 4);
    const cloud = icloud({ home: 'Дом' });
    for (let i = 0; i < 101; i++) cloud.put('home', `e${i}.ics`, ics(vevent(`e${i}`, [`SUMMARY:Событие ${i}`, `DTSTART;VALUE=DATE:${stamp(d)}`])));
    expect((await connect(u, cloud)).status).toBe(201);
    expect(cloud.sent('REPORT').filter((r) => r.body.includes('calendar-multiget'))).toHaveLength(2);
    expect((await rows(u)).filter((r) => r.source === 'apple')).toHaveLength(101);
  });

  it('неверный ввод — 400, без ключа календарей — 503; в iCloud не ходим', async () => {
    const u = await user();
    const cloud = icloud();
    expect(await u.call('POST', '/calendars/apple', { login: 'dasha', password: cloud.password })).toMatchObject({ status: 400, body: { error: 'apple_bad_input' } });
    expect(await u.call('POST', '/calendars/apple', { login: APPLE_ID, password: 'abcd-efgh' })).toMatchObject({ status: 400, body: { error: 'apple_bad_input' } });
    expect(await u.call('POST', '/calendars/apple', {})).toMatchObject({ status: 400, body: { error: 'apple_bad_input' } });
    expect(await callWith(u, { CALENDAR_KEY: '' }, 'POST', '/calendars/apple', { login: APPLE_ID, password: cloud.password })).toMatchObject({ status: 503, body: { error: 'calendar_unavailable' } });
    expect(cloud.requests).toEqual([]);
  });

  it('пароль не подошёл — 401, сервер упал или недоступен — 502; ничего не сохраняем', async () => {
    const u = await user();
    const cloud = icloud();
    expect(await u.call('POST', '/calendars/apple', { login: APPLE_ID, password: 'wrong-pass-word' })).toMatchObject({ status: 401, body: { error: 'apple_auth' } });
    cloud.down = 500;
    expect(await connect(u, cloud)).toMatchObject({ status: 502, body: { error: 'apple_unreachable' } });
    cloud.down = null;
    cloud.unreachable = true;
    expect(await connect(u, cloud)).toMatchObject({ status: 502, body: { error: 'apple_unreachable' } });
    expect((await sb.from('calendar_accounts').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('основной календарь сервер не назвал — выбираем по названию', async () => {
    const u = await user({ timezone: TZ });
    const cloud = icloud({ trips: 'Поездки', home: 'Дом' });
    cloud.defaultSlug = null;
    expect((await connect(u, cloud)).status).toBe(201);
    expect((await account(u)).default_url).toBe(cloud.url('home'));
  });

  it('пока человек не выбрал сам, наши дела пишем туда, где больше всего его событий', async () => {
    const u = await user({ timezone: TZ });
    const d = logicalDay(TZ, 4);
    const cloud = icloud();
    cloud.put('home', 'one.ics', ics(vevent('one', ['SUMMARY:Одно', `DTSTART;${MSK(d, '09:00')}`])));
    for (const i of [1, 2, 3]) cloud.put('work', `w${i}.ics`, ics(vevent(`w${i}`, [`SUMMARY:Работа ${i}`, `DTSTART;${MSK(d, `1${i}:00`)}`])));
    const id = await create(u, { title: 'Отчёт', day: d, time: '18:00' });
    expect((await connect(u, cloud)).status).toBe(201);
    expect(await account(u)).toMatchObject({ default_url: cloud.url('work'), default_manual: false });
    expect(cloud.sent('PUT').map((p) => p.url)).toEqual([ownHref(cloud, 'work', id)]);
    expect(cloud.sent('DELETE')).toEqual([]);
  });
});

describe.skipIf(!ready)('Apple: из календаря к нам', () => {
  it('«Обновить» забирает только изменившееся: поправленное, новое, удалённое; наше дело, поправленное на телефоне', async () => {
    const { u, d, cloud, hrefs, dentist } = await connected();
    cloud.put('home', 'meet.ics', ics(vevent('meet-1', ['SUMMARY:Созвон перенесли', `DTSTART;${MSK(d, '16:00')}`, 'DURATION:PT30M'])));
    cloud.put('work', 'new.ics', ics(vevent('new-1', ['SUMMARY:Новое', `DTSTART;VALUE=DATE:${stamp(addDays(d, 3))}`])));
    cloud.remove(hrefs.review);
    const own = ownHref(cloud, 'home', dentist);
    cloud.put(
      'home',
      `lifecommit-${dentist}.ics`,
      cloud.event(own)!.ics.replace('SUMMARY:Стоматолог', 'SUMMARY:Стоматолог (перенесли)').replace(/DTSTART:\d{8}T\d{6}Z/, `DTSTART:${stamp(addDays(d, 2), '09:00')}Z`),
    );

    expect(await sync(u)).toMatchObject({ status: 200, body: { ok: true } });

    const got = await byUid(u);
    expect(got['meet-1']).toMatchObject({ title: 'Созвон перенесли', time: '16:00:00', duration_min: 30, details: null });
    expect(got['new-1']).toMatchObject({ title: 'Новое', day: addDays(d, 3), time: null, calendar_url: cloud.url('work') });
    expect(got['review-1']).toBeUndefined();
    expect(await row(dentist)).toMatchObject({ title: 'Стоматолог (перенесли)', day: addDays(d, 2), time: '12:00:00', duration_min: 45, details: { location: 'Клиника на Тверской' } });

    // По жетонам — только новое: тексты не изменившихся событий не запрашивали.
    expect(syncBodies(cloud).every((r) => /<d:sync-token>tok-\d+<\/d:sync-token>/.test(r.body))).toBe(true);
    const asked = cloud
      .sent('REPORT')
      .filter((r) => r.body.includes('calendar-multiget'))
      .map((r) => r.body)
      .join('');
    expect(asked).toContain('meet.ics');
    expect(asked).not.toContain('bday.ics');
    expect(cloud.sent('PUT')).toEqual([]);

    // Только что обновляли — второй раз за минуту не ходим.
    cloud.requests.length = 0;
    expect(await u.call('POST', '/calendars/sync')).toMatchObject({ body: { ok: true } });
    expect(cloud.requests).toEqual([]);
  });

  it('жетоны устарели — календарь перечитываем целиком и убираем всё, чего в нём больше нет', async () => {
    const { u, cloud, hrefs } = await connected();
    cloud.remove(hrefs.review);
    cloud.expireTokens();
    expect(await sync(u)).toMatchObject({ body: { ok: true } });
    expect((await byUid(u))['review-1']).toBeUndefined();
    expect((await byUid(u))['meet-1']).toBeDefined();
    // оба календаря: сперва с жетоном (отказ), потом целиком
    const bodies = syncBodies(cloud).map((r) => r.body);
    expect(bodies.filter((b) => b.includes('<d:sync-token></d:sync-token>'))).toHaveLength(2);
    expect(bodies.filter((b) => /<d:sync-token>tok-/.test(b))).toHaveLength(2);
  });

  it('календарь, заведённый после подключения, тоже забираем; основной не выбран — выбираем и выгружаем наши дела', async () => {
    const { u, d, cloud, acc } = await connected();
    cloud.addCalendar('trips', 'Поездки');
    cloud.put('trips', 'flight.ics', ics(vevent('flight', ['SUMMARY:Рейс в Казань', `DTSTART;${MSK(addDays(d, 4), '06:40')}`])));
    expect(await sync(u)).toMatchObject({ body: { ok: true } });
    expect((await sb.from('calendar_collections').select('name, enabled').eq('account_id', acc.id).eq('url', cloud.url('trips')).single()).data).toEqual({ name: 'Поездки', enabled: true });
    expect((await byUid(u)).flight).toMatchObject({ title: 'Рейс в Казань', calendar_url: cloud.url('trips') });

    // Старое подключение, где основной календарь не нашли: новое дело ждёт, пока календарь не выберем.
    await sb.from('calendar_accounts').update({ default_url: null }).eq('id', acc.id);
    const late = await create(u, { title: 'Позвонить маме', day: addDays(d, 1), time: '20:00' });
    expect(cloud.sent('PUT')).toEqual([]);
    expect(await sync(u)).toMatchObject({ body: { ok: true } });
    expect((await account(u)).default_url).toBe(cloud.url('home'));
    expect(cloud.sent('PUT').map((p) => p.url)).toEqual([ownHref(cloud, 'home', late)]);

    // Подключение без адреса календарей (самые первые) — новые календари не ищем, известные синхронизируем.
    await sb.from('calendar_accounts').update({ home_url: null }).eq('id', acc.id);
    cloud.addCalendar('later', 'Потом');
    cloud.requests.length = 0;
    expect(await sync(u)).toMatchObject({ body: { ok: true } });
    expect(cloud.sent('PROPFIND')).toEqual([]);
    expect(syncBodies(cloud).length).toBeGreaterThan(0);
  });

  it('выключили календарь — его события убираем; включили — забираем заново', async () => {
    const { u, cloud, acc, dentist } = await connected();
    const other = await user();
    expect(await other.call('PATCH', `/calendars/${acc.id}/collections`, { url: cloud.url('work'), enabled: false })).toMatchObject({ status: 404, body: { error: 'not_found' } });

    expect(await u.call('PATCH', `/calendars/${acc.id}/collections`, { url: cloud.url('work'), enabled: false })).toMatchObject({ status: 200, body: { ok: true } });
    expect((await byUid(u))['review-1']).toBeUndefined();
    expect((await row(dentist)).external_href).not.toBeNull();
    await sync(u);
    expect(syncBodies(cloud).some((r) => r.url === cloud.url('work'))).toBe(false);

    await u.call('PATCH', `/calendars/${acc.id}/collections`, { url: cloud.url('work'), enabled: true });
    await sync(u);
    expect((await byUid(u))['review-1']).toMatchObject({ title: 'Ревью' });
    expect(syncBodies(cloud).find((r) => r.url === cloud.url('work'))!.body).toContain('<d:sync-token></d:sync-token>');
  });

  it('сменился часовой пояс — календарь перечитываем в новом поясе, наши дела со временем перезаписываем', async () => {
    const { u, d, cloud, acc, dentist } = await connected();
    expect((await u.call('POST', '/session', { timezone: 'Asia/Dubai' })).status).toBe(200);
    expect((await account(u)).retime).toBe(true);

    expect(await u.call('POST', '/calendars/sync')).toMatchObject({ body: { ok: true } });
    // «15:30» значит 15:30 там, где человек сейчас: в Дубае это 11:30 UTC.
    expect(cloud.event(ownHref(cloud, 'home', dentist))!.ics).toContain(`DTSTART:${stamp(addDays(d, 1), '11:30')}Z`);
    expect(await row(dentist)).toMatchObject({ time: '15:30:00', day: addDays(d, 1) });
    // чужое событие — в новом поясе: 11:00 Москвы = 12:00 Дубая
    expect((await byUid(u))['meet-1']).toMatchObject({ time: '12:00:00' });
    expect((await sb.from('calendar_accounts').select('retime').eq('id', acc.id).single()).data?.retime).toBe(false);
  });

  it('наше дело без времени, выгруженное раньше, убираем из календаря — а дело остаётся', async () => {
    const { u, d, cloud } = await connected();
    // Так было, пока выгружали все дела: дело без времени лежало в календаре событием на весь день.
    const milk = await create(u, { title: 'Купить молоко' });
    const href = cloud.put('home', `lifecommit-${milk}.ics`, ics(vevent(`lifecommit-${milk}`, ['SUMMARY:Купить молоко', `DTSTART;VALUE=DATE:${stamp(d)}`])));
    await sb.from('todos').update({ external_uid: `lifecommit-${milk}`, external_href: href, calendar_url: cloud.url('home') }).eq('id', milk);

    expect(await sync(u)).toMatchObject({ body: { ok: true } });
    expect(cloud.sent('DELETE').map((r) => r.url)).toEqual([href]);
    expect(cloud.event(href)).toBeUndefined();
    expect(await row(milk)).toMatchObject({ title: 'Купить молоко', external_uid: null, external_href: null, external_etag: null, calendar_url: null });

    // Следующая синхронизация увидит удаление события — но связь уже забыта, дело не трогаем.
    expect(await sync(u)).toMatchObject({ body: { ok: true } });
    expect((await row(milk)).title).toBe('Купить молоко');
  });
});

describe.skipIf(!ready)('Apple: от нас в календарь', () => {
  it('своё дело: создали, поправили по ETag, конфликт с телефоном, «сделано» не уходит, убрали время, удалили', async () => {
    const { u, d, cloud } = await connected();
    const id = await create(u, { title: 'Встреча', day: addDays(d, 1), time: '18:00' });
    const href = ownHref(cloud, 'home', id);
    expect(cloud.sent('PUT').map((p) => [p.url, p.headers.get('If-None-Match')])).toEqual([[href, '*']]);
    expect(cloud.event(href)!.ics).toContain(`DTSTART:${stamp(addDays(d, 1), '15:00')}Z`);
    expect(cloud.event(href)!.ics).toContain('DURATION:PT30M');

    // Правка — «только если никто не менял».
    const etag = cloud.event(href)!.etag;
    await u.call('PATCH', `/todos/${id}`, { title: 'Встреча с Машей' });
    expect(cloud.sent('PUT').at(-1)!.headers.get('If-Match')).toBe(etag);
    expect(cloud.event(href)!.ics).toContain('SUMMARY:Встреча с Машей');
    expect((await row(id)).external_etag).toBe(cloud.event(href)!.etag);

    // На телефоне успели поменять: 412 → перечитали и записали поверх (наша правка новее).
    cloud.conflictNext(href);
    cloud.requests.length = 0;
    await u.call('PATCH', `/todos/${id}`, { time: '19:30' });
    expect(cloud.requests.map((r) => r.method)).toEqual(['PUT', 'GET', 'PUT']);
    expect(cloud.event(href)!.ics).toContain(`DTSTART:${stamp(addDays(d, 1), '16:30')}Z`);

    // «Сделано» в календарь не уходит: у событий нет галочки.
    cloud.requests.length = 0;
    await u.call('PATCH', `/todos/${id}`, { done: true });
    expect(cloud.requests).toEqual([]);

    // Убрали время — событие удаляется, связь забыта.
    await u.call('PATCH', `/todos/${id}`, { time: null });
    expect(cloud.sent('DELETE').map((r) => r.url)).toEqual([href]);
    expect(cloud.event(href)).toBeUndefined();
    expect(await row(id)).toMatchObject({ external_uid: null, external_href: null });

    // Вернули время — событие снова создаётся.
    await u.call('PATCH', `/todos/${id}`, { time: '10:00' });
    expect(cloud.sent('PUT').at(-1)!.headers.get('If-None-Match')).toBe('*');
    expect(cloud.event(href)).toBeDefined();

    // Удалили дело — удаляется и событие.
    cloud.requests.length = 0;
    expect((await u.call('DELETE', `/todos/${id}`)).status).toBe(200);
    expect(cloud.requests.map((r) => [r.method, r.url])).toEqual([['DELETE', href]]);
    expect(cloud.event(href)).toBeUndefined();
  });

  it('событие из календаря поправили у нас — в самом событии меняются только название и время', async () => {
    const { u, d, cloud, hrefs } = await connected();
    const got = await byUid(u);

    await u.call('PATCH', `/todos/${got['meet-1']!.id}`, { title: 'Созвон (важный)', time: '13:00' });
    expect(cloud.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect(cloud.sent('PUT')[0]!.headers.get('If-Match')).toBe('"e1"');
    const meet = cloud.event(hrefs.meet)!.ics;
    expect(meet).toContain('UID:meet-1');
    expect(meet).toContain('SUMMARY:Созвон (важный)');
    expect(meet).toContain(`DTSTART:${stamp(d, '10:00')}Z`);
    expect(meet).toContain('DURATION:PT60M');
    // участники, место и напоминание остались
    expect(meet).toContain('ATTENDEE;CN=Маша:mailto:masha@example.com');
    expect(meet).toContain('LOCATION:https://meet.google.com/abc-defg-hij');
    expect(meet).toContain('TRIGGER:-PT15M');
    expect((await row(got['meet-1']!.id)).external_etag).toBe(cloud.event(hrefs.meet)!.etag);

    // Повторяющееся: день начала серии не двигаем, повтор и перенесённый раз остаются.
    await u.call('PATCH', `/todos/${got.yoga!.id}`, { title: 'Йога утром', time: '07:30', day: d });
    const yoga = cloud.event(hrefs.yoga)!.ics;
    expect(yoga).toContain('SUMMARY:Йога утром');
    expect(yoga).toContain(`DTSTART:${stamp(addDays(d, -14), '04:30')}Z`);
    expect(yoga).toContain('RRULE:FREQ=WEEKLY');
    expect(yoga).toContain('SUMMARY:Йога (позже)');

    // Скрыть — только у нас.
    cloud.requests.length = 0;
    await u.call('PATCH', `/todos/${got['review-1']!.id}`, { hidden: true });
    expect(cloud.requests).toEqual([]);
  });

  it('событие на несколько дней: правка названия не сжимает его до одного дня', async () => {
    const { u, d, cloud } = await connected();
    const href = cloud.put('home', 'vacation.ics', ics(vevent('vacation', ['SUMMARY:Отпуск', `DTSTART;VALUE=DATE:${stamp(addDays(d, 5))}`, `DTEND;VALUE=DATE:${stamp(addDays(d, 12))}`])));
    await sync(u);
    await u.call('PATCH', `/todos/${(await byUid(u)).vacation!.id}`, { title: 'Отпуск в Сочи' });
    const text = cloud.event(href)!.ics;
    expect(text).toContain('SUMMARY:Отпуск в Сочи');
    expect(text).toContain(`DTSTART;VALUE=DATE:${stamp(addDays(d, 5))}`);
    expect(text).toContain(`DTEND;VALUE=DATE:${stamp(addDays(d, 12))}`);
  });

  it('событие дважды поменяли на телефоне, пока мы писали, — сдаёмся, у нас правка остаётся', async () => {
    const { u, cloud, hrefs } = await connected();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const meet = (await byUid(u))['meet-1']!;
    cloud.conflictNext(hrefs.meet, 2);
    expect((await u.call('PATCH', `/todos/${meet.id}`, { title: 'Не дойдёт' })).status).toBe(200);
    expect(cloud.requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'GET', 'PUT']);
    expect(cloud.event(hrefs.meet)!.ics).toContain('SUMMARY:Созвон с командой');
    expect((await row(meet.id)).title).toBe('Не дойдёт');
    expect(errors.mock.calls.some(([m]) => m === 'calendar push failed')).toBe(true);
    // не пароль — подключение не ломаем
    expect((await account(u)).status).toBe('ok');
  });

  it('удалили у нас событие из календаря — удаляется и в календаре', async () => {
    const { u, cloud, hrefs } = await connected();
    expect((await u.call('DELETE', `/todos/${(await byUid(u))['meet-1']!.id}`)).status).toBe(200);
    expect(cloud.sent('DELETE').map((r) => r.url)).toEqual([hrefs.meet]);
    expect(cloud.event(hrefs.meet)).toBeUndefined();
  });

  it('человек сам выбрал календарь для наших дел — выгруженные переезжают, дальше сами не двигаем', async () => {
    const { u, d, cloud, acc, dentist } = await connected();
    const other = await user();
    expect(await other.call('PATCH', `/calendars/${acc.id}/default`, { url: cloud.url('work') })).toMatchObject({ status: 404 });
    expect(await u.call('PATCH', `/calendars/${acc.id}/default`, { url: `${ICLOUD_NODE}/1234/calendars/nope/` })).toMatchObject({ status: 400, body: { error: 'unknown_calendar' } });

    expect(await u.call('PATCH', `/calendars/${acc.id}/default`, { url: cloud.url('work') })).toMatchObject({ status: 200, body: { ok: true } });
    expect(cloud.requests.map((r) => [r.method, r.url])).toEqual([
      ['DELETE', ownHref(cloud, 'home', dentist)],
      ['PUT', ownHref(cloud, 'work', dentist)],
    ]);
    expect(await row(dentist)).toMatchObject({ calendar_url: cloud.url('work'), external_href: ownHref(cloud, 'work', dentist) });
    expect(await account(u)).toMatchObject({ default_url: cloud.url('work'), default_manual: true });

    // Событий больше в «Доме», но выбор человека главнее.
    expect(await sync(u)).toMatchObject({ body: { ok: true } });
    expect((await account(u)).default_url).toBe(cloud.url('work'));
    const fresh = await create(u, { title: 'Новое', day: d, time: '21:00' });
    expect(cloud.event(ownHref(cloud, 'work', fresh))).toBeDefined();

    // Тот же календарь ещё раз — переносить нечего.
    cloud.requests.length = 0;
    await u.call('PATCH', `/calendars/${acc.id}/default`, { url: cloud.url('work') });
    expect(cloud.requests).toEqual([]);
  });
});

describe.skipIf(!ready)('Apple: сбои и отключение', () => {
  it('пароль отозвали — подключение «нужен новый пароль»; правка и удаление дела тоже это замечают; новый пароль всё чинит', async () => {
    const { u, d, cloud, acc, dentist } = await connected();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    cloud.password = 'qrst-uvwx-yzab-cdef';

    expect(await sync(u)).toMatchObject({ status: 200, body: { ok: false } });
    const failed = await account(u);
    expect(failed.status).toBe('auth_failed');
    expect(failed.last_error).toContain('401');
    expect((await u.call('GET', '/calendars')).body[0].status).toBe('auth_failed');

    // Пока подключение сломано, новые дела в календарь не пишем и не стучимся.
    cloud.requests.length = 0;
    await create(u, { title: 'Не уйдёт', day: d, time: '12:00' });
    expect(cloud.requests).toEqual([]);

    // Правка уже выгруженного дела — 401 → подключение помечается.
    await sb.from('calendar_accounts').update({ status: 'ok' }).eq('id', acc.id);
    await u.call('PATCH', `/todos/${dentist}`, { title: 'Стоматолог, кабинет 3' });
    expect((await account(u)).status).toBe('auth_failed');
    // Удаление — тоже.
    await sb.from('calendar_accounts').update({ status: 'ok' }).eq('id', acc.id);
    await u.call('DELETE', `/todos/${(await byUid(u))['meet-1']!.id}`);
    expect((await account(u)).status).toBe('auth_failed');
    expect(errors).toHaveBeenCalled();

    // Новый пароль приложения — снова работает, дела на месте.
    expect((await connect(u, cloud)).status).toBe(201);
    expect(await account(u)).toMatchObject({ id: acc.id, status: 'ok', last_error: null });
    expect((await row(dentist)).external_href).toBe(ownHref(cloud, 'home', dentist));
    expect((await byUid(u))['review-1']).toBeDefined();
  });

  it('сервер календаря упал — «ошибка», ответ ok: false', async () => {
    const { u, cloud } = await connected();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    cloud.down = 500;
    expect(await sync(u)).toMatchObject({ body: { ok: false } });
    expect((await account(u)).status).toBe('error');
  });

  it('отключили — события из календаря уходят, наши дела остаются без связи; в iCloud не ходим', async () => {
    const { u, cloud, dentist } = await connected();
    expect(await u.call('DELETE', '/calendars/outlook')).toMatchObject({ status: 400, body: { error: 'bad_provider' } });
    expect(await u.call('DELETE', '/calendars/apple')).toMatchObject({ status: 200, body: { ok: true } });
    expect((await rows(u)).map((r) => [r.title, r.source, r.external_href])).toEqual([['Стоматолог', null, null]]);
    expect(await row(dentist)).toMatchObject({ external_uid: null, external_etag: null, calendar_url: null });
    expect((await sb.from('calendar_accounts').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect((await u.call('GET', '/calendars')).body).toEqual([]);
    expect(cloud.requests).toEqual([]);
  });
});
