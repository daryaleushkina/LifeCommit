// Подпись дня рядом с делом: сегодня — ничего, вчера — «со вчера», дальше — дата.
import { describe, expect, it } from 'vitest';
import { dictionaries } from './i18n';
import { eventOver, todoWhen } from './todoDates';

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

// 05.10.2026: в «Осталось» висел прошедший созвон из календаря — галочки у событий нет, отметить его нельзя.
describe('eventOver — событие из календаря уже прошло', () => {
  const at = (iso: string) => new Date(iso); // местное время
  const ev = (p: { day?: string; time?: string | null; duration_min?: number | null; source?: 'apple' | 'google' | null }) => ({
    day: '2026-10-03',
    time: '10:00',
    duration_min: 45,
    source: 'google' as const,
    ...p,
  });

  it('конец — начало плюс длительность: до него идёт, с него — прошло', () => {
    expect(eventOver(ev({}), at('2026-10-03T10:44:59'))).toBe(false);
    expect(eventOver(ev({}), at('2026-10-03T10:45:00'))).toBe(true);
  });

  it('без длительности — час после начала (решение владелицы 05.10.2026)', () => {
    expect(eventOver(ev({ duration_min: null }), at('2026-10-03T10:59'))).toBe(false);
    expect(eventOver(ev({ duration_min: null }), at('2026-10-03T11:00'))).toBe(true);
  });

  it('время из базы с секундами и событие через полночь', () => {
    expect(eventOver(ev({ time: '23:30:00', duration_min: 90 }), at('2026-10-04T00:59'))).toBe(false);
    expect(eventOver(ev({ time: '23:30:00', duration_min: 90 }), at('2026-10-04T01:00'))).toBe(true);
  });

  it('вчерашнее событие ночью (логический день ещё вчерашний) — прошло', () => {
    expect(eventOver(ev({ day: '2026-10-02', time: '20:00' }), at('2026-10-03T01:30'))).toBe(true);
  });

  it('на весь день и свои дела — никогда не «прошли»', () => {
    expect(eventOver(ev({ time: null }), at('2026-10-03T23:59'))).toBe(false);
    expect(eventOver(ev({ source: null }), at('2026-10-04T12:00'))).toBe(false);
  });
});

