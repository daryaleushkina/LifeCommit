import { describe, expect, it } from 'vitest';
import { habitIcon } from './habitIcon';

describe('habitIcon', () => {
  it('узнаёт привычку по названию', () => {
    expect(habitIcon('Сходить в спортзал')).toBe('gym');
    expect(habitIcon('Читать')).toBe('read');
    expect(habitIcon('Выпить воды')).toBe('water');
    expect(habitIcon('Не курить')).toBe('smoke');
    expect(habitIcon('Без сладкого')).toBe('sweets');
    expect(habitIcon('Зарядка')).toBe('exercise');
    expect(habitIcon('Лечь до полуночи')).toBe('sleep');
    expect(habitIcon('Учить английский')).toBe('study');
    expect(habitIcon('Morning run')).toBe('run');
  });
  it('смотрит на начало слова, а не на любую часть', () => {
    expect(habitIcon('Съездить на завод')).toBeNull();
    expect(habitIcon('Курсы вождения')).toBe('study');
    expect(habitIcon('Курица на ужин')).toBe('food');
  });
  it('буква ё и регистр не мешают', () => {
    expect(habitIcon('ПОДЪЁМ в 7')).toBe('sleep');
  });
  it('незнакомое название — без значка', () => {
    expect(habitIcon('Что-то своё')).toBeNull();
    expect(habitIcon('')).toBeNull();
  });
});
