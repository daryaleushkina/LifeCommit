import { describe, expect, it } from 'vitest';
import { buildEvent, parseEvents, patchEvent, utcToZoned, zonedToUtc } from './ics';

const wrap = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

describe('часовые пояса', () => {
  it('местное время → UTC и обратно', () => {
    const ms = zonedToUtc('2026-10-01', '10:00', 'Europe/Moscow');
    expect(new Date(ms).toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(utcToZoned(ms, 'Asia/Ho_Chi_Minh')).toEqual({ day: '2026-10-01', time: '14:00' });
  });
  it('переход на летнее время', () => {
    // В Берлине 29.03.2026 в 02:00 часы переводят на 03:00
    expect(new Date(zonedToUtc('2026-03-29', '12:00', 'Europe/Berlin')).toISOString()).toBe('2026-03-29T10:00:00.000Z');
    expect(new Date(zonedToUtc('2026-03-28', '12:00', 'Europe/Berlin')).toISOString()).toBe('2026-03-28T11:00:00.000Z');
  });
});

describe('parseEvents', () => {
  it('событие со временем в своём поясе переводится в пояс человека', () => {
    const [e] = parseEvents(
      wrap('BEGIN:VEVENT', 'UID:a1', 'SUMMARY:Созвон\\, команда', 'DTSTART;TZID=Europe/Moscow:20261001T100000', 'DTEND;TZID=Europe/Moscow:20261001T110000', 'END:VEVENT'),
      'Asia/Ho_Chi_Minh',
    );
    expect(e).toEqual({ uid: 'a1', title: 'Созвон, команда', day: '2026-10-01', time: '14:00', durationMin: 60, rrule: null, exdates: [] });
  });
  it('событие на весь день и день рождения с повтором', () => {
    const [e] = parseEvents(wrap('BEGIN:VEVENT', 'UID:b1', 'SUMMARY:ДР Маши', 'DTSTART;VALUE=DATE:19951003', 'RRULE:FREQ=YEARLY', 'END:VEVENT'), 'Europe/Moscow');
    expect(e).toMatchObject({ day: '1995-10-03', time: null, rrule: 'FREQ=YEARLY' });
  });
  it('время в UTC, длительность через DURATION, длинная строка свёрнута', () => {
    const [e] = parseEvents(wrap('BEGIN:VEVENT', 'UID:c1', 'SUMMARY:Очень длинное название встречи, кото', ' рое свернули', 'DTSTART:20261001T060000Z', 'DURATION:PT45M', 'END:VEVENT'), 'Europe/Moscow');
    expect(e).toMatchObject({ title: 'Очень длинное название встречи, которое свернули', time: '09:00', durationMin: 45 });
  });
  it('изменённый раз — отдельное дело, у повтора этот день исключён; отменённый — только исключён', () => {
    const events = parseEvents(
      wrap(
        'BEGIN:VEVENT', 'UID:w1', 'SUMMARY:Йога', 'DTSTART;TZID=Europe/Moscow:20261005T080000', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Europe/Moscow:20261012T080000', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:w1', 'RECURRENCE-ID;TZID=Europe/Moscow:20261019T080000', 'SUMMARY:Йога (позже)', 'DTSTART;TZID=Europe/Moscow:20261019T190000', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:w1', 'RECURRENCE-ID;TZID=Europe/Moscow:20261026T080000', 'STATUS:CANCELLED', 'DTSTART;TZID=Europe/Moscow:20261026T080000', 'END:VEVENT',
      ),
      'Europe/Moscow',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ uid: 'w1', rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: ['2026-10-12', '2026-10-19', '2026-10-26'] });
    expect(events[1]).toMatchObject({ uid: 'w1#2026-10-19', title: 'Йога (позже)', day: '2026-10-19', time: '19:00', rrule: null });
  });
  it('напоминания внутри события не мешают', () => {
    const [e] = parseEvents(wrap('BEGIN:VEVENT', 'UID:d1', 'SUMMARY:Врач', 'DTSTART;VALUE=DATE:20261002', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'DESCRIPTION:Напомнить', 'END:VALARM', 'END:VEVENT'), 'Europe/Moscow');
    expect(e).toMatchObject({ title: 'Врач', day: '2026-10-02' });
  });
});

describe('buildEvent и patchEvent', () => {
  it('наше дело со временем — момент UTC, без времени — даты', () => {
    const timed = buildEvent({ uid: 'lifecommit-7', title: 'Позвонить; врачу', day: '2026-10-01', time: '15:00', durationMin: null, tz: 'Europe/Moscow' }, 0);
    expect(timed).toContain('SUMMARY:Позвонить\\; врачу');
    expect(timed).toContain('DTSTART:20261001T120000Z');
    expect(timed).toContain('DURATION:PT30M');
    const allDay = buildEvent({ uid: 'lifecommit-8', title: 'Молоко', day: '2026-10-31', time: null, durationMin: null, tz: 'Europe/Moscow' }, 0);
    expect(allDay).toContain('DTSTART;VALUE=DATE:20261031');
    expect(allDay).toContain('DTEND;VALUE=DATE:20261101');
    // Что собрали — то и читается обратно.
    expect(parseEvents(timed, 'Europe/Moscow')[0]).toMatchObject({ title: 'Позвонить; врачу', day: '2026-10-01', time: '15:00', durationMin: 30 });
  });
  it('правка чужого события меняет название и время, повтор и напоминание остаются', () => {
    const src = wrap('BEGIN:VEVENT', 'UID:w1', 'SUMMARY:Йога', 'DTSTART;TZID=Europe/Moscow:20261005T080000', 'DTEND;TZID=Europe/Moscow:20261005T090000', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT');
    const out = patchEvent(src, { title: 'Йога дома', day: '2026-10-12', time: '09:30', durationMin: 60, tz: 'Europe/Moscow', recurring: true }, 0);
    const [e] = parseEvents(out, 'Europe/Moscow');
    expect(e).toMatchObject({ title: 'Йога дома', day: '2026-10-05', time: '09:30', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(out).toContain('TRIGGER:-PT15M');
  });
});
