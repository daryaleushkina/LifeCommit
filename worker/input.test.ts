import { describe, expect, it } from 'vitest';
import { inputObject, optionalBoolean, optionalNumber, optionalText } from './input';

describe('проверка JSON перед добавлением', () => {
  it('объект проверяем, остальные формы отклоняем с 400', () => {
    expect(inputObject({ title: 'Молоко' })).toEqual({ title: 'Молоко' });
    for (const value of [null, undefined, [], 'текст', 1, true]) {
      expect(() => inputObject(value)).toThrowError(expect.objectContaining({ status: 400, message: 'bad_input' }));
    }
  });

  it('необязательный текст допускает null и отсутствие, отклоняет другой тип', () => {
    for (const value of ['текст', '', null, undefined]) expect(optionalText(value)).toBe(value);
    for (const value of [42, false, [], {}]) {
      expect(() => optionalText(value, 'bad_time')).toThrowError(expect.objectContaining({ status: 400, message: 'bad_time' }));
    }
  });

  it('число должно быть конечным, без преобразования объектов и строк', () => {
    for (const value of [0, 10.5, null, undefined]) expect(optionalNumber(value)).toBe(value);
    for (const value of [NaN, Infinity, -Infinity, '10', false, {}, []]) {
      expect(() => optionalNumber(value, 'bad_target')).toThrowError(expect.objectContaining({ status: 400, message: 'bad_target' }));
    }
  });

  it('флаги допускают только boolean или отсутствие', () => {
    for (const value of [true, false, undefined]) expect(optionalBoolean(value)).toBe(value);
    for (const value of [null, 'true', 1, {}, []]) {
      expect(() => optionalBoolean(value)).toThrowError(expect.objectContaining({ status: 400, message: 'bad_input' }));
    }
  });
});
