import { describe, expect, it } from 'vitest';
import { calendarUrl, isGoogleHref, loginOf, originalDay, toCalEvent, type GoogleCalendar } from './gcal';
import { readState, signState } from './secret';

describe('события Google → дела', () => {
  it('событие со временем переводится в пояс человека, длительность — из конца', () => {
    const e = toCalEvent({ id: 'x1', summary: 'Созвон', start: { dateTime: '2026-10-01T10:00:00+03:00' }, end: { dateTime: '2026-10-01T11:30:00+03:00' } }, 'g:x1', 'Asia/Ho_Chi_Minh');
    expect(e).toEqual({ uid: 'g:x1', title: 'Созвон', day: '2026-10-01', time: '14:00', durationMin: 90, rrule: null, exdates: [] });
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
});
