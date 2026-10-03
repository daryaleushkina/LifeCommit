// Подпись «как часто» у привычки.
import { describe, expect, it } from 'vitest';
import { dictionaries } from './i18n';
import { repeatLabel } from './repeat';

const ru = dictionaries.ru;
const en = dictionaries.en;

describe('repeatLabel', () => {
  it('каждый день', () => {
    expect(repeatLabel(ru, 'daily', 127, null)).toBe('Каждый день');
  });

  it('по дням недели, но отмечены все семь — тоже «Каждый день»', () => {
    expect(repeatLabel(ru, 'weekdays', 127, null)).toBe('Каждый день');
  });

  it('по дням недели: «Пн, ср, пт» — заглавная только первая', () => {
    expect(repeatLabel(ru, 'weekdays', 0b10101, null)).toBe('Пн, ср, пт');
    expect(repeatLabel(ru, 'weekdays', 0b1100000, null)).toBe('Сб, вс');
    expect(repeatLabel(en, 'weekdays', 0b10, null)).toBe('Tu');
  });

  it('несколько раз в неделю; без числа — три', () => {
    expect(repeatLabel(ru, 'per_week', 127, 2)).toBe('2 раза в неделю');
    expect(repeatLabel(ru, 'per_week', 127, null)).toBe('3 раза в неделю');
    expect(repeatLabel(en, 'per_week', 127, 1)).toBe('1 time a week');
  });
});
