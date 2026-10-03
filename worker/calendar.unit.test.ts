// Календари: края разбора и сборки (CalDAV, iCalendar, Google, подробности, шифр) — то, до чего
// сквозные тесты worker/calsync.int.test.ts не дотягиваются через API.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discover, listCollections, multiget, syncCollection } from './caldav';
import type { Env } from './env';
import { buildDetails, personName, plainText } from './eventDetails';
import { accessToken, authUrl, calendarUrl, deleteGoogleEvent, exchangeCode, listCalendars, listEvents, patchForeignEvent, putOwnEvent, revoke, toCalEvent } from './gcal';
import { buildEvent, parseEvents, parseRecurrence, patchEvent } from './ics';
import { open, seal } from './secret';

const wrap = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

afterEach(() => vi.unstubAllGlobals());

/** Сервер отвечает по очереди: строка — multistatus с этим содержимым, Response — как есть. */
function serve(...replies: (string | Response)[]) {
  const queue = [...replies];
  const fn = vi.fn(async () => {
    const r = queue.shift()!;
    return typeof r === 'string' ? new Response(`<multistatus xmlns="DAV:">${r}</multistatus>`, { status: 207 }) : r;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('CalDAV: необычные ответы', () => {
  const auth = { login: 'a@b.c', password: 'x' };

  it('список календарей: без адреса и без типа — мимо; без имени — «Календарь»; числовые сущности в имени', async () => {
    serve(
      '<response><propstat><prop><resourcetype><calendar/></resourcetype></prop></propstat></response>' +
        '<response><href>/c/plain/</href><propstat><prop><displayname>Папка</displayname></prop></propstat></response>' +
        '<response><href>/c/a/</href><propstat><prop><resourcetype><collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop></propstat></response>' +
        '<response><href>/c/b/</href><propstat><prop><resourcetype><calendar/></resourcetype><displayname>&#1056;&#x430;бота &amp; учёба</displayname><supported-calendar-component-set> </supported-calendar-component-set></prop></propstat></response>',
    );
    expect(await listCollections('https://cal.test/c/', auth)).toEqual([
      { url: 'https://cal.test/c/a/', name: 'Календарь', color: null, syncToken: null },
      { url: 'https://cal.test/c/b/', name: 'Работа & учёба', color: null, syncToken: null },
    ]);
  });

  it('изменения: без адреса — мимо, не .ics с версией — изменено, папка без версии — мимо; нет жетона — прежний', async () => {
    serve(
      '<response><propstat><prop><getetag>"x"</getetag></prop></propstat></response>' +
        '<response><href>/c/home/note</href><propstat><prop><getetag>"e2"</getetag></prop></propstat></response>' +
        '<response><href>/c/home/folder/</href><propstat><prop/></propstat></response>',
      '',
    );
    expect(await syncCollection('https://cal.test/c/home/', auth, 'tok-1')).toEqual({ token: 'tok-1', changed: [{ href: 'https://cal.test/c/home/note', etag: '"e2"' }], removed: [] });
    expect(await syncCollection('https://cal.test/c/home/', auth, null)).toEqual({ token: '', changed: [], removed: [] });
  });

  it('тексты событий: пустой список — без запроса; без текста события — мимо', async () => {
    const fetch = serve('<response><href>/c/home/a.ics</href><propstat><prop><getetag>"1"</getetag></prop></propstat></response><response><href>/c/home/b.ics</href><status>HTTP/1.1 404 Not Found</status></response>');
    expect(await multiget('https://cal.test/c/home/', auth, [])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await multiget('https://cal.test/c/home/', auth, ['https://cal.test/c/home/a.ics', 'https://cal.test/c/home/b.ics'])).toEqual([]);
  });

  it('сервер без «входящих» — основной календарь по названию', async () => {
    serve(
      '<response><href>/</href><propstat><prop><current-user-principal><href>/p/</href></current-user-principal></prop></propstat></response>',
      '<response><href>/p/</href><propstat><prop><C:calendar-home-set xmlns:C="urn:ietf:params:xml:ns:caldav"><href>/c/</href></C:calendar-home-set></prop></propstat></response>',
      '<response><href>/c/w/</href><propstat><prop><resourcetype><calendar/></resourcetype><displayname>Работа</displayname></prop></propstat></response>' +
        '<response><href>/c/h/</href><propstat><prop><resourcetype><calendar/></resourcetype><displayname>Personal</displayname></prop></propstat></response>',
    );
    expect(await discover('https://cal.test/', auth)).toMatchObject({ principalUrl: 'https://cal.test/p/', homeUrl: 'https://cal.test/c/', defaultUrl: 'https://cal.test/c/h/' });
  });
});

describe('iCalendar: разбор необычного', () => {
  it('«плавающее» время и неизвестный пояс — время как есть, в поясе человека', () => {
    const [a, b] = parseEvents(wrap('BEGIN:VEVENT', 'UID:f1', 'DTSTART:20261005T100000', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:f2', 'DTSTART;TZID=Mars/Olympus:20261005T110000', 'END:VEVENT'), 'Asia/Ho_Chi_Minh');
    expect(a).toMatchObject({ day: '2026-10-05', time: '10:00' });
    expect(b).toMatchObject({ day: '2026-10-05', time: '11:00' });
  });

  it('двоеточие в кавычках параметра, пустой параметр, строка без значения', () => {
    const [e] = parseEvents(
      wrap('NOT A PROPERTY', 'BEGIN:VEVENT', 'UID:p1', 'GARBAGE', 'DTSTART;;VALUE=DATE:20261005', 'ATTENDEE;CN="Лиза: дизайн":mailto:liza@x.com', 'ATTENDEE;CN=Я:mailto:me@x.com', 'END:VEVENT'),
      'UTC',
      'me@x.com',
    );
    expect(e).toMatchObject({ day: '2026-10-05', time: null, details: { people_count: 2, people: ['Лиза: дизайн'] } });
  });

  it('длительность: нулевая и отрицательная — нет; конец датой у события со временем и конец = начало — нет', () => {
    const one = (...lines: string[]) => parseEvents(wrap('BEGIN:VEVENT', 'UID:d', 'DTSTART:20261005T100000Z', ...lines, 'END:VEVENT'), 'UTC')[0]!.durationMin;
    expect(one('DURATION:PT0S')).toBeNull();
    expect(one('DURATION:-PT1H')).toBeNull();
    expect(one('DTEND;VALUE=DATE:20261006')).toBeNull();
    expect(one('DTEND:20261005T100000Z')).toBeNull();
  });

  it('пропускаются: без UID, с непонятным началом, отменённое целиком, раз повтора с непонятным днём', () => {
    const events = parseEvents(
      wrap(
        'BEGIN:VEVENT', 'SUMMARY:Без UID', 'DTSTART:20261005T100000Z', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:x1', 'DTSTART:завтра', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:x2', 'STATUS:CANCELLED', 'DTSTART:20261005T100000Z', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:x3', 'RECURRENCE-ID:потом', 'DTSTART:20261005T100000Z', 'END:VEVENT',
      ),
      'UTC',
    );
    expect(events).toEqual([]);
  });

  it('изменённый раз без самого повтора — просто дело; день уже исключён — не дублируется; непонятный EXDATE — мимо', () => {
    const events = parseEvents(
      wrap(
        'BEGIN:VEVENT', 'UID:r1', 'DTSTART;VALUE=DATE:20261005', 'RRULE:FREQ=DAILY', 'EXDATE;VALUE=DATE:20261006,когда-то', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:r1', 'RECURRENCE-ID;VALUE=DATE:20261006', 'SUMMARY:Перенесли', 'DTSTART;VALUE=DATE:20261007', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:lonely', 'RECURRENCE-ID;VALUE=DATE:20261010', 'SUMMARY:Один раз', 'DTSTART;VALUE=DATE:20261011', 'END:VEVENT',
      ),
      'UTC',
    );
    expect(events.map((e) => [e.uid, e.exdates])).toEqual([
      ['r1', ['2026-10-06']],
      ['r1#2026-10-06', []],
      ['lonely#2026-10-10', []],
    ]);
  });

  it('повтор Google без RRULE — не повтор', () => {
    expect(parseRecurrence(['EXDATE;VALUE=DATE:20261003'], 'UTC')).toEqual({ rrule: null, exdates: ['2026-10-03'] });
  });

  it('длинное название сворачивается по 75 байт и читается обратно', () => {
    const title = 'Очень длинное название встречи с командой дизайна, бэкенда и всех, кто захочет прийти';
    const ics = buildEvent({ uid: 'lifecommit-1', title, day: '2026-10-05', time: '10:00', durationMin: null, tz: 'UTC' }, 0);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).toContain('\r\n ');
    expect(parseEvents(ics, 'UTC')[0]!.title).toBe(title);
  });
});

describe('patchEvent: день начала повтора', () => {
  it('у события в чужом поясе день начала берётся в поясе человека — серия не съезжает на день', () => {
    // 22:00 UTC понедельника — это 05:00 вторника во Вьетнаме; в деле — вторник, 05:00.
    const src = wrap('BEGIN:VEVENT', 'UID:s1', 'SUMMARY:Созвон', 'DTSTART:20261005T220000Z', 'DURATION:PT30M', 'RRULE:FREQ=WEEKLY', 'END:VEVENT');
    const [before] = parseEvents(src, 'Asia/Ho_Chi_Minh');
    expect(before).toMatchObject({ day: '2026-10-06', time: '05:00' });
    const out = patchEvent(src, { title: 'Созвон команды', day: before!.day, time: '06:00', durationMin: 30, tz: 'Asia/Ho_Chi_Minh', recurring: true }, 0);
    expect(parseEvents(out, 'Asia/Ho_Chi_Minh')[0]).toMatchObject({ title: 'Созвон команды', day: '2026-10-06', time: '06:00', rrule: 'FREQ=WEEKLY' });
  });

  it('начала нет или оно непонятное — берётся день дела', () => {
    const change = { title: 'Х', day: '2026-10-09', time: '10:00', durationMin: null, tz: 'UTC', recurring: true };
    expect(patchEvent(wrap('BEGIN:VEVENT', 'UID:n1', 'RRULE:FREQ=DAILY', 'END:VEVENT'), change, 0)).toContain('DTSTART:20261009T100000Z');
    expect(patchEvent(wrap('BEGIN:VEVENT', 'UID:n2', 'DTSTART:вчера', 'RRULE:FREQ=DAILY', 'END:VEVENT'), change, 0)).toContain('DTSTART:20261009T100000Z');
  });
});

describe('Google: необычные ответы', () => {
  const json = (body: unknown, status = 200) => Response.json(body, { status });

  it('нет ключей клиента — пустые поля, а не undefined', async () => {
    expect(new URL(authUrl({} as Env, 'https://x.test/cb', 'st')).searchParams.get('client_id')).toBe('');
    const fetch = serve(json({ access_token: 'a', refresh_token: 'r' }));
    expect(await exchangeCode({} as Env, 'code', 'https://x.test/cb')).toEqual({ access_token: 'a', refresh_token: 'r' });
    const body = new URLSearchParams(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect([body.get('client_id'), body.get('client_secret'), body.get('grant_type')]).toEqual(['', '', 'authorization_code']);
  });

  it('ответ на токен не JSON — ошибка с кодом; отзыв доступа без сети — молча', async () => {
    serve(new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(accessToken({} as Env, 'r')).rejects.toMatchObject({ status: 502, message: 'token: 502' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(revoke('r')).resolves.toBeUndefined();
  });

  it('пустые ответы: удаление 200 без тела, страницы без items, календарь без названия', async () => {
    serve(new Response('', { status: 200 }));
    await expect(deleteGoogleEvent('t', `${calendarUrl('a@b.c')}/events/e1`)).resolves.toBeUndefined();
    serve(json({ items: [{ id: 'x@y.z', accessRole: 'reader' }], nextPageToken: 'p2' }), json({}));
    expect(await listCalendars('t')).toEqual([{ url: calendarUrl('x@y.z'), name: 'x@y.z', color: null, owned: false, writable: false, primary: false }]);
    serve(json({}));
    expect(await listEvents('t', calendarUrl('a@b.c'), null)).toEqual({ items: [], syncToken: null });
  });

  it('события: непонятное начало — нет; без конца — без длительности; созвон из conferenceData; слишком длинное — без длительности', () => {
    expect(toCalEvent({ id: 'a', start: { dateTime: 'потом' } }, 'g:a', 'UTC')).toBeNull();
    expect(toCalEvent({ id: 'b', start: { dateTime: '2026-10-05T10:00:00Z' } }, 'g:b', 'UTC')!.durationMin).toBeNull();
    expect(toCalEvent({ id: 'b0', start: { dateTime: '2026-10-05T10:00:00Z' }, end: { dateTime: '2026-10-05T10:00:00Z' } }, 'g:b0', 'UTC')!.durationMin).toBeNull();
    const c = toCalEvent(
      {
        id: 'c',
        start: { dateTime: '2026-10-05T10:00:00Z' },
        end: { dateTime: '2026-10-25T10:00:00Z' },
        hangoutLink: 'https://meet.google.com/old',
        conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://zoom.us/j/9' }] },
      },
      'g:c',
      'UTC',
    )!;
    expect(c.durationMin).toBeNull();
    expect(c.details).toEqual({ link: 'https://zoom.us/j/9' });
  });

  it('ответы записи без etag — etag пустой; у события на весь день без конца — один день', async () => {
    const cal = calendarUrl('a@b.c');
    const own = { todoId: 1, title: 'Встреча', day: '2026-10-05', time: '10:00', durationMin: null, tz: 'UTC' };
    serve(json({ id: 'e1' }));
    expect(await putOwnEvent('t', cal, `${cal}/events/e1`, own)).toEqual({ href: `${cal}/events/e1`, etag: null });
    serve(json({ error: { code: 404 } }, 404), json({ id: 'n 1' }));
    expect(await putOwnEvent('t', cal, `${cal}/events/gone`, own)).toEqual({ href: `${cal}/events/n%201`, etag: null });
    const fetch = serve(json({ id: 'd', start: { date: '2026-10-05' } }), json({ id: 'd' }));
    expect(await patchForeignEvent('t', `${cal}/events/d`, { title: 'ДР', day: '2026-10-05', time: null, durationMin: null, tz: 'UTC' })).toBeNull();
    expect(JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toMatchObject({ start: { date: '2026-10-05' }, end: { date: '2026-10-06' } });
  });
});

describe('подробности: края', () => {
  it('сущности: неизвестная остаётся, числовая — символ, нулевая — пробел', () => {
    expect(plainText('a &copy; b &#8212; c&#0;d')).toBe('a &copy; b — c d');
  });
  it('длинное описание режется до 600 знаков с многоточием; короткое — как есть', () => {
    const notes = buildDetails({ description: 'слово '.repeat(150) })!.notes!;
    expect(notes).toHaveLength(600);
    expect(notes.endsWith('…')).toBe(true);
    expect(buildDetails({ description: 'Повестка: бюджет' })).toEqual({ notes: 'Повестка: бюджет' });
  });
  it('участники без имён — только число', () => {
    expect(buildDetails({ attendees: [{ name: '' }, { name: '  ' }] })).toEqual({ people_count: 2 });
  });
  it('имя участника: подпись, иначе почта до «@», иначе пусто', () => {
    expect(personName('  ', 'mailto:LIZA@x.com')).toBe('LIZA');
    expect(personName(null, null)).toBe('');
  });
});

describe('шифр паролей', () => {
  it('зашифрованное открывается тем же ключом; ключ не 32 байта — ошибка', async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));
    const sealed = await seal(key, 'abcd-efgh-ijkl-mnop');
    expect(sealed).not.toContain('abcd');
    expect(await open(key, sealed)).toBe('abcd-efgh-ijkl-mnop');
    await expect(seal(btoa('short'), 'x')).rejects.toThrow('CALENDAR_KEY: нужно 32 байта в base64');
  });
});
