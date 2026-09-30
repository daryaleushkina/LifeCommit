import { describe, expect, it } from 'vitest';
import { autoStep, cleanDaysBeforeStart, heatLevel } from './types';

describe('heatLevel', () => {
  it('уровни по абсолютной сумме выполненного', () => {
    expect([0, 0.5, 1, 2.9, 3, 4.9, 5, 12].map(heatLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('cleanDaysBeforeStart', () => {
  it('дата не указана — счёт с нуля', () => {
    expect(cleanDaysBeforeStart('2026-09-30', null)).toBe(0);
  });
  it('считает полные дни между последним разом и первым днём дела', () => {
    expect(cleanDaysBeforeStart('2026-09-30', '2026-09-30')).toBe(0);
    expect(cleanDaysBeforeStart('2026-09-30', '2026-09-29')).toBe(0);
    expect(cleanDaysBeforeStart('2026-09-30', '2026-09-23')).toBe(6);
    expect(cleanDaysBeforeStart('2026-09-30', '2025-09-30')).toBe(364);
  });
  it('дата позже начала не даёт отрицательный счёт', () => {
    expect(cleanDaysBeforeStart('2026-09-30', '2026-10-05')).toBe(0);
  });
});

describe('autoStep', () => {
  it('шаг подбирается по цели', () => {
    expect([1, 10, 11, 40, 41, 100, 101, 10000].map(autoStep)).toEqual([1, 1, 5, 5, 10, 10, 10, 1000]);
  });
});
