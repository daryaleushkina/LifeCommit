import { describe, expect, it } from 'vitest';
import { addDays, isValidTimeZone, localTime, logicalDay, minutesOf, weekdayIndex, weekStart } from './day';

describe('logicalDay', () => {
  it('до начала дня отметка относится ко вчера', () => {
    // 00:30 по Москве 1 октября
    expect(logicalDay('Europe/Moscow', 4, new Date('2026-09-30T21:30:00Z'))).toBe('2026-09-30');
  });
  it('после начала дня — уже сегодня', () => {
    // 04:00 по Москве 1 октября
    expect(logicalDay('Europe/Moscow', 4, new Date('2026-10-01T01:00:00Z'))).toBe('2026-10-01');
  });
  it('учитывает часовой пояс пользователя', () => {
    const now = new Date('2026-10-01T03:00:00Z');
    expect(logicalDay('Asia/Vladivostok', 4, now)).toBe('2026-10-01');
    expect(logicalDay('America/New_York', 4, now)).toBe('2026-09-30');
  });
  it('начало дня в полночь', () => {
    expect(logicalDay('UTC', 0, new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01');
  });
});

describe('время и даты', () => {
  it('localTime отдаёт HH:MM в 24-часовом формате', () => {
    expect(localTime('Europe/Moscow', new Date('2026-09-30T21:05:00Z'))).toBe('00:05');
  });
  it('addDays переходит через месяц и год', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
  it('неделя начинается с понедельника', () => {
    expect(weekdayIndex('2026-09-28')).toBe(0); // пн
    expect(weekdayIndex('2026-10-04')).toBe(6); // вс
    expect(weekStart('2026-10-04')).toBe('2026-09-28');
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
  });
  it('minutesOf', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('00:00')).toBe(0);
  });
  it('isValidTimeZone', () => {
    expect(isValidTimeZone('Europe/Moscow')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
