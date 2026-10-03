// Подпись дня рядом с делом: сегодня — ничего, вчера — «со вчера», дальше — дата.
import { describe, expect, it } from 'vitest';
import { dictionaries } from './i18n';
import { todoWhen } from './todoDates';

const ru = dictionaries.ru;
const en = dictionaries.en;
const today = '2026-10-03';

describe('todoWhen', () => {
  it('сегодняшнее — без подписи', () => {
    expect(todoWhen(ru, today, today, 'ru-RU')).toBeNull();
  });

  it('переехало со вчера — тихое «со вчера»', () => {
    expect(todoWhen(ru, '2026-10-02', today, 'ru-RU')).toBe(ru.todo.sinceYesterday);
  });

  it('переехало раньше — «с 28 сентября», без дня недели', () => {
    expect(todoWhen(ru, '2026-09-28', today, 'ru-RU')).toBe('с 28 сентября');
    expect(todoWhen(en, '2026-09-28', today, 'en-US')).toBe('since September 28');
  });

  it('завтра — строчными', () => {
    expect(todoWhen(ru, '2026-10-04', today, 'ru-RU')).toBe('завтра');
    expect(todoWhen(en, '2026-10-04', today, 'en-US')).toBe('tomorrow');
  });

  it('позже — с днём недели', () => {
    expect(todoWhen(ru, '2026-10-09', today, 'ru-RU')).toBe('пт, 9 октября');
    expect(todoWhen(en, '2026-10-09', today, 'en-US')).toBe('Fri, October 9');
  });

  it('переход через месяц и год', () => {
    expect(todoWhen(ru, '2026-12-31', '2027-01-01', 'ru-RU')).toBe(ru.todo.sinceYesterday);
    expect(todoWhen(ru, '2027-01-01', '2026-12-31', 'ru-RU')).toBe('завтра');
  });
});
