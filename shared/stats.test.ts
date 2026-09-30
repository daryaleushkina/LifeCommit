import { describe, expect, it } from 'vitest';
import { cleanRuns, lastDays, targetOn, type HistoryLog } from './stats';

const clean = (day: string): HistoryLog => ({ day, value: 1, status: 'clean' });
const slip = (day: string): HistoryLog => ({ day, value: 0, status: 'slip' });

describe('targetOn', () => {
  const goals = [
    { effective_from: '2026-09-10', target: 30 },
    { effective_from: '2026-09-01', target: 20 },
  ];
  it('берёт цель, действовавшую в этот день', () => {
    expect(targetOn(goals, '2026-09-05')).toBe(20);
    expect(targetOn(goals, '2026-09-10')).toBe(30);
    expect(targetOn(goals, '2026-09-30')).toBe(30);
  });
});

describe('cleanRuns', () => {
  it('считает дни подряд, срыв начинает период заново', () => {
    const logs = [clean('2026-09-01'), clean('2026-09-02'), clean('2026-09-03'), slip('2026-09-04'), clean('2026-09-05'), clean('2026-09-06')];
    expect(cleanRuns(logs, '2026-09-01', null, '2026-09-06')).toEqual({ longest: 3, current: 2 });
  });
  it('сегодня без ответа текущий период не рвёт', () => {
    const logs = [clean('2026-09-01'), clean('2026-09-02')];
    expect(cleanRuns(logs, '2026-09-01', null, '2026-09-03')).toEqual({ longest: 2, current: 2 });
  });
  it('пропущенный день в прошлом период рвёт', () => {
    const logs = [clean('2026-09-01'), clean('2026-09-03')];
    expect(cleanRuns(logs, '2026-09-01', null, '2026-09-03')).toEqual({ longest: 1, current: 1 });
  });
  it('дни до появления привычки продолжают первый период', () => {
    const logs = [clean('2026-09-01'), clean('2026-09-02')];
    // последний раз 25 августа → 6 чистых дней до 1 сентября
    expect(cleanRuns(logs, '2026-09-01', '2026-08-25', '2026-09-02')).toEqual({ longest: 8, current: 8 });
  });
  it('срыв в первый же день обнуляет и дни до начала', () => {
    expect(cleanRuns([slip('2026-09-01')], '2026-09-01', '2026-08-25', '2026-09-01')).toEqual({ longest: 6, current: 0 });
  });
});

describe('lastDays', () => {
  it('отдаёт ровно n дней по порядку, без отметки — ноль', () => {
    const logs: HistoryLog[] = [{ day: '2026-09-29', value: 12, status: null }];
    expect(lastDays(logs, '2026-09-30', 3)).toEqual([
      { day: '2026-09-28', value: 0 },
      { day: '2026-09-29', value: 12 },
      { day: '2026-09-30', value: 0 },
    ]);
  });
});
