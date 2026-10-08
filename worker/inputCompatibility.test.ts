import { describe, expect, it } from 'vitest';
// Маршруты инициализируются от api: groupBot уже ссылается на него через существующий цикл модулей.
import './api';
import { cleanItem } from './groups';
import { inputBody, jsonNumber, normalizeTaskInput, normalizeTodoInput } from './input';

describe('совместимость HTTP-ввода добавления с прежним контрактом', () => {
  it('не JSON сохраняет SyntaxError для общего обработчика bad_json; не объект — bad_json', async () => {
    await expect(inputBody({ json: async () => JSON.parse('не JSON') })).rejects.toBeInstanceOf(SyntaxError);
    for (const raw of [null, [], 'текст', 42, true]) {
      await expect(inputBody({ json: async () => raw })).rejects.toMatchObject({ status: 400, message: 'bad_json' });
    }
    expect(await inputBody({ json: async () => ({ title: 'Дело' }) })).toEqual({ title: 'Дело' });
  });

  it('нестроковое место игнорируется, неверная дата и длительность получают прежние запасные значения', () => {
    for (const location of [42, {}, [], true, null]) {
      expect(normalizeTodoInput({ title: 'Дело', location }).location).toBeUndefined();
    }
    expect(normalizeTodoInput({ title: 42, day: {}, duration_min: '90.4', location: 'Кафе' })).toMatchObject({ title: '42', day: undefined, duration_min: 90.4, location: 'Кафе' });
    for (const duration_min of ['не число', 'Infinity', {}, []]) {
      expect(normalizeTodoInput({ title: 'Дело', duration_min }).duration_min).toBeNull();
    }
  });

  it('привычки: числовые строки приводятся, границы расписания сохраняются, неиспользуемые поля игнорируются', () => {
    expect(normalizeTaskInput({ title: 42, kind: 'count', target: '10', schedule: 'weekdays', weekdays: '500', per_week: [] })).toMatchObject({ title: '42', target: 10, weekdays: 127, per_week: undefined });
    expect(normalizeTaskInput({ title: 'Читать', kind: 'check', weekdays: {}, per_week: 'не число', last_slip_on: false })).toMatchObject({ weekdays: undefined, per_week: undefined, last_slip_on: null });
    expect(normalizeTaskInput({ title: 'Читать', kind: 'check', schedule: 'per_week', per_week: '9' }).per_week).toBe(7);
    expect(normalizeTaskInput({ title: 'Читать', kind: 'check', schedule: 'per_week' }).per_week).toBe(3);
  });

  it('числа из JSON: примитивы приводятся, объекты не исполняют toString/valueOf', () => {
    expect(jsonNumber('10')).toBe(10);
    expect(jsonNumber(true)).toBe(1);
    expect(jsonNumber(null)).toBe(0);
    for (const raw of [undefined, [], {}, { toString: null }]) expect(jsonNumber(raw)).toBeNaN();
  });

  it('назначенные: числовые строки, повторы и чужие id фильтруются в прежнем порядке', () => {
    const fields = cleanItem({ title: 'Посуда', mode: 'assign', assignees: [20, 20, 99, '7', '10', {}, null], all_members: 1, rotate: 1 }, '2026-10-08', [10, 20], false);
    expect(fields).toMatchObject({ assignees: [20, 10], all_members: true, rotate: true });
    expect(cleanItem({ assignees: null, all_members: 0, rotate: null }, '2026-10-08', [10, 20], true)).toEqual({ assignees: [], all_members: false, rotate: false });
    expect(() => cleanItem({ assignees: 'все' }, '2026-10-08', [10, 20], true)).toThrowError(expect.objectContaining({ status: 400, message: 'bad_input' }));
  });

  it('групповые числа приводятся, длительность ограничивается, повреждённые поля не дают 500', () => {
    expect(cleanItem({ title: 'Цель', mode: 'goal', target: '10' }, '2026-10-08', [10], false)).toMatchObject({ target: 10 });
    for (const [raw, value] of [['90', 90], [0, 1], ['не число', 1], ['Infinity', 20160], [null, null]]) {
      expect(cleanItem({ duration_min: raw }, '2026-10-08', [10], true)).toEqual({ duration_min: value });
    }
    for (const input of [{ title: 42 }, { rrule: {} }, { target: {} }]) {
      expect(() => cleanItem(input, '2026-10-08', [10], true)).toThrowError(expect.objectContaining({ status: 400 }));
    }
  });
});
