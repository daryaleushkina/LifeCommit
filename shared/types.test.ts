import { describe, expect, it } from 'vitest';
import { autoStep, heatLevel } from './types';

describe('heatLevel', () => {
  it('уровни по абсолютной сумме выполненного', () => {
    expect([0, 0.5, 1, 2.9, 3, 4.9, 5, 12].map(heatLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('autoStep', () => {
  it('шаг подбирается по цели', () => {
    expect([1, 10, 11, 40, 41, 100, 101, 10000].map(autoStep)).toEqual([1, 1, 5, 5, 10, 10, 10, 1000]);
  });
});
