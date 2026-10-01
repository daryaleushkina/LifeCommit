import { describe, expect, it } from 'vitest';
import { occurrences, occursOn, parseRRule } from './rrule';

const rule = (s: string) => {
  const r = parseRRule(s);
  if (!r) throw new Error(`не разобрали ${s}`);
  return r;
};

describe('parseRRule', () => {
  it('понимает частоту, интервал, дни, конец', () => {
    expect(parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261231T235959Z')).toEqual({
      freq: 'WEEKLY',
      interval: 2,
      byDay: [{ wd: 0 }, { wd: 3 }],
      until: '2026-12-31',
    });
    expect(parseRRule('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3')).toEqual({ freq: 'MONTHLY', interval: 1, byDay: [{ wd: 4, n: -1 }], count: 3 });
  });
  it('повторы чаще раза в день и непонятное — null', () => {
    expect(parseRRule('FREQ=HOURLY')).toBeNull();
    expect(parseRRule('FREQ=DAILY;BYHOUR=9,18')).toBeNull();
    expect(parseRRule('FREQ=WEEKLY;BYDAY=XX')).toBeNull();
  });
});

describe('occurrences', () => {
  it('каждую неделю в день начала', () => {
    // 2026-10-05 — понедельник
    expect(occurrences(rule('FREQ=WEEKLY'), '2026-10-05', '2026-10-01', '2026-10-31')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  });
  it('раз в две недели по пн и чт', () => {
    expect(occurrences(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH'), '2026-10-05', '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-05',
      '2026-10-08',
      '2026-10-19',
      '2026-10-22',
    ]);
  });
  it('день рождения — каждый год, «навсегда»', () => {
    const r = rule('FREQ=YEARLY');
    expect(occursOn(r, '1990-03-14', '2031-03-14')).toBe(true);
    expect(occursOn(r, '1990-03-14', '2031-03-15')).toBe(false);
    expect(occursOn(r, '1990-03-14', '1989-03-14')).toBe(false);
  });
  it('29 февраля — только в високосные годы', () => {
    expect(occurrences(rule('FREQ=YEARLY'), '2024-02-29', '2025-01-01', '2028-12-31')).toEqual(['2028-02-29']);
  });
  it('каждый месяц 31-го пропускает короткие месяцы, −1 — последний день', () => {
    expect(occurrences(rule('FREQ=MONTHLY'), '2026-01-31', '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
    expect(occurrences(rule('FREQ=MONTHLY;BYMONTHDAY=-1'), '2026-01-31', '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('«второй вторник» и «последняя пятница» месяца', () => {
    expect(occurrences(rule('FREQ=MONTHLY;BYDAY=2TU'), '2026-10-13', '2026-10-01', '2026-12-31')).toEqual(['2026-10-13', '2026-11-10', '2026-12-08']);
    expect(occurrences(rule('FREQ=MONTHLY;BYDAY=-1FR'), '2026-10-30', '2026-10-01', '2026-12-31')).toEqual(['2026-10-30', '2026-11-27', '2026-12-25']);
  });
  it('COUNT считается с начала, UNTIL включительно, EXDATE выкидывает день', () => {
    expect(occurrences(rule('FREQ=DAILY;COUNT=3'), '2026-10-01', '2026-10-02', '2026-10-10')).toEqual(['2026-10-02', '2026-10-03']);
    expect(occurrences(rule('FREQ=DAILY;UNTIL=20261003'), '2026-10-01', '2026-10-01', '2026-10-10')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(occurrences(rule('FREQ=DAILY'), '2026-10-01', '2026-10-01', '2026-10-03', ['2026-10-02'])).toEqual(['2026-10-01', '2026-10-03']);
  });
  it('годовой «День благодарения»: четвёртый четверг ноября', () => {
    expect(occurrences(rule('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH'), '2025-11-27', '2026-01-01', '2027-12-31')).toEqual(['2026-11-26', '2027-11-25']);
  });
});
