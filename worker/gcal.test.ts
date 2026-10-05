import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import { accessToken, calendarUrl, deleteGoogleEvent, GoogleError, isGoogleAuthError, isGoogleHref, listEvents, loginOf, originalDay, putOwnEvent, toCalEvent, type GoogleCalendar } from './gcal';
import { readState, signState, verifyState } from './secret';

describe('события Google → дела', () => {
  it('событие со временем переводится в пояс человека, длительность — из конца', () => {
    const e = toCalEvent({ id: 'x1', summary: 'Созвон', start: { dateTime: '2026-10-01T10:00:00+03:00' }, end: { dateTime: '2026-10-01T11:30:00+03:00' } }, 'g:x1', 'Asia/Ho_Chi_Minh');
    expect(e).toEqual({ uid: 'g:x1', title: 'Созвон', day: '2026-10-01', time: '14:00', durationMin: 90, rrule: null, exdates: [], details: null });
  });
  it('на весь день — без времени; повтор и исключённые дни из recurrence', () => {
    const e = toCalEvent(
      { id: 'b', summary: 'ДР', start: { date: '1995-10-03' }, end: { date: '1995-10-04' }, recurrence: ['RRULE:FREQ=YEARLY', 'EXDATE;VALUE=DATE:20261003'] },
      'g:b',
      'Europe/Moscow',
    );
    expect(e).toMatchObject({ day: '1995-10-03', time: null, durationMin: null, rrule: 'FREQ=YEARLY', exdates: ['2026-10-03'] });
  });
  it('исключение со временем в чужом поясе попадает в свой день у человека', () => {
    const e = toCalEvent(
      { id: 'w', summary: 'Планёрка', start: { dateTime: '2026-10-05T09:00:00+03:00', timeZone: 'Europe/Moscow' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Europe/Moscow:20261012T090000'] },
      'g:w',
      'Asia/Ho_Chi_Minh',
    );
    expect(e?.exdates).toEqual(['2026-10-12']);
    expect(e?.time).toBe('13:00');
  });
  it('непонятный повтор — событие один раз; пустое название — прочерк', () => {
    const e = toCalEvent({ id: 'q', start: { date: '2026-10-01' }, recurrence: ['RRULE:FREQ=SECONDLY'] }, 'g:q', 'UTC');
    expect(e).toMatchObject({ title: '—', rrule: null });
  });
  it('день изменённого раза — по originalStartTime', () => {
    expect(originalDay({ id: 'w_1', originalStartTime: { dateTime: '2026-10-12T23:30:00Z' } }, 'Asia/Ho_Chi_Minh')).toBe('2026-10-13');
    expect(originalDay({ id: 'b_1', originalStartTime: { date: '2026-10-03' } }, 'Asia/Ho_Chi_Minh')).toBe('2026-10-03');
  });
});

describe('адреса', () => {
  it('календарь и событие Google узнаются по адресу API', () => {
    const url = calendarUrl('team@group.calendar.google.com');
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/team%40group.calendar.google.com');
    expect(isGoogleHref(`${url}/events/abc`)).toBe(true);
    expect(isGoogleHref('https://p42-caldav.icloud.com/1/calendars/home/x.ics')).toBe(false);
  });
  it('почта аккаунта — id основного календаря', () => {
    const list: GoogleCalendar[] = [
      { url: calendarUrl('ru.russian#holiday@group.v.calendar.google.com'), name: 'Праздники', color: null, owned: false, writable: false, primary: false },
      { url: calendarUrl('darya@example.com'), name: 'darya@example.com', color: null, owned: true, writable: true, primary: true },
    ];
    expect(loginOf(list)).toBe('darya@example.com');
  });
});

describe('state входа Google', () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  it('подписанный state читается, подделанный и просроченный — нет', async () => {
    const state = await signState(key, 42);
    expect(await readState(key, state)).toBe(42);
    expect(await readState(key, state.replace(/^42\./, '43.'))).toBeNull();
    expect(await readState(key, await signState(key, 42, -1000))).toBeNull();
    expect(await readState(key, 'мусор')).toBeNull();
  });

  it('метка «из приложения» подписана вместе с id и сроком: ни приписать, ни снять; просроченный подписанный — видно, откуда он', async () => {
    const app = await signState(key, 42, undefined, 'app');
    expect(await verifyState(key, app)).toEqual({ userId: 42, app: true, expired: false });
    expect(await readState(key, app)).toBe(42);
    const web = await signState(key, 42);
    expect(await verifyState(key, web)).toEqual({ userId: 42, app: false, expired: false });
    const [id, exp, sig] = web.split('.');
    expect(await verifyState(key, `${id}.${exp}.app.${sig}`)).toBeNull();
    const parts = app.split('.');
    expect(await verifyState(key, `${parts[0]}.${parts[1]}.${parts[3]}`)).toBeNull();
    expect(await verifyState(key, await signState(key, 42, -1000, 'app'))).toEqual({ userId: 42, app: true, expired: true });
    expect(await readState(key, await signState(key, 42, -1000, 'app'))).toBeNull();
    expect(await verifyState(key, `${id}.${exp}.web.${sig}`)).toBeNull();
    expect(await verifyState(key, 'мусор')).toBeNull();
    expect(await verifyState(key, '')).toBeNull();
  });
});

describe('запросы к Google: отказы', () => {
  const reply = (status: number, body: unknown = {}) => vi.stubGlobal('fetch', vi.fn(async () => (status === 204 ? new Response(null, { status }) : Response.json(body, { status }))));
  const change = { todoId: 1, title: 'Встреча', day: '2026-10-05', time: '10:00', durationMin: null, tz: 'Europe/Moscow' };
  const href = `${calendarUrl('a@b.c')}/events/e1`;
  afterEach(() => vi.unstubAllGlobals());

  it('чужие ошибки не глотаем: запись, удаление, список событий, токен', async () => {
    reply(500, { error: 'backend' });
    await expect(putOwnEvent('t', calendarUrl('a@b.c'), href, change)).rejects.toMatchObject({ status: 500 });
    await expect(deleteGoogleEvent('t', href)).rejects.toMatchObject({ status: 500 });
    await expect(listEvents('t', calendarUrl('a@b.c'), 'tok')).rejects.toBeInstanceOf(GoogleError);
    await expect(accessToken({ GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' } as Env, 'r')).rejects.toMatchObject({ status: 500, message: 'token: backend' });
    // 200 без access_token — тоже сбой
    reply(200, {});
    await expect(accessToken({} as Env, 'r')).rejects.toMatchObject({ status: 200 });
  });

  it('удалённое событие: удаление проходит, а 401 — это «подключить заново»', async () => {
    reply(204);
    await expect(deleteGoogleEvent('t', href)).resolves.toBeUndefined();
    reply(401, { error: { code: 401 } });
    const err = await deleteGoogleEvent('t', href).catch((e: unknown) => e);
    expect(isGoogleAuthError(err)).toBe(true);
  });
});
