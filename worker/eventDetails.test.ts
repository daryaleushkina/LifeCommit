import { describe, expect, it } from 'vitest';
import { buildDetails, plainText } from './eventDetails';
import { toCalEvent } from './gcal';
import { buildEvent, parseEvents } from './ics';

describe('buildDetails', () => {
  it('ссылка на созвон из описания, описание без неё — пусто', () => {
    expect(buildDetails({ description: 'https://zoom.us/j/123?pwd=x' })).toEqual({ link: 'https://zoom.us/j/123?pwd=x' });
  });
  it('место-ссылка — это ссылка, не место', () => {
    expect(buildDetails({ location: 'https://telemost.yandex.ru/j/777' })).toEqual({ link: 'https://telemost.yandex.ru/j/777' });
  });
  it('участники: я не в списке имён, но в числе', () => {
    const d = buildDetails({ attendees: [{ name: 'Я', self: true }, { name: 'Лиза' }, { name: 'masha' }] });
    expect(d).toEqual({ people_count: 3, people: ['Лиза', 'masha'] });
  });
  it('один я — не участники', () => {
    expect(buildDetails({ attendees: [{ name: 'Я', self: true }] })).toBeNull();
  });
  it('HTML описания Google → текст', () => {
    expect(plainText('Привет<br>план:&nbsp;<b>кофе</b> &amp; разговор')).toBe('Привет\nплан: кофе & разговор');
  });
});

describe('подробности из календарей', () => {
  it('Google: Meet, место, участники, ссылка на событие', () => {
    const ev = toCalEvent(
      {
        id: 'x',
        summary: 'Созвон',
        start: { dateTime: '2026-10-02T10:00:00Z' },
        end: { dateTime: '2026-10-02T11:00:00Z' },
        location: 'Кафе Снежинка',
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
        htmlLink: 'https://www.google.com/calendar/event?eid=1',
        attendees: [{ email: 'me@x.com', self: true }, { email: 'liza@x.com', displayName: 'Лиза' }, { email: 'room@x.com', resource: true }],
      },
      'g:x',
      'UTC',
    );
    expect(ev?.details).toEqual({
      location: 'Кафе Снежинка',
      link: 'https://meet.google.com/abc-defg-hij',
      people_count: 2,
      people: ['Лиза'],
      open_url: 'https://www.google.com/calendar/event?eid=1',
    });
  });

  it('Apple: LOCATION, URL, ATTENDEE с CN', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:1',
      'DTSTART:20261002T100000Z',
      'SUMMARY:Встреча',
      'LOCATION:Кафе Снежинка\\, Ленина 5',
      'URL:https://zoom.us/j/1',
      'ATTENDEE;CN=Лиза:mailto:liza@x.com',
      'ATTENDEE;CN=Даша:mailto:me@icloud.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseEvents(ics, 'UTC', 'me@icloud.com');
    expect(ev?.details).toEqual({ location: 'Кафе Снежинка, Ленина 5', link: 'https://zoom.us/j/1', people_count: 2, people: ['Лиза'] });
  });

  it('наше дело уходит в календарь с местом', () => {
    const ics = buildEvent({ uid: 'lifecommit-1', title: 'Встреча с Лизой', day: '2026-10-02', time: '18:00', durationMin: 180, tz: 'UTC', location: 'Кафе Снежинка' });
    expect(ics).toContain('LOCATION:Кафе Снежинка');
    expect(ics).toContain('DURATION:PT180M');
  });
});
