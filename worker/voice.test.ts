import { describe, expect, it } from 'vitest';
import { toTaskInputs } from './voice';

describe('toTaskInputs', () => {
  it('принимает три вида привычек', () => {
    const got = toTaskInputs({
      habits: [
        { title: 'Читать', kind: 'count', target: 20, unit: 'страниц', schedule: 'daily' },
        { title: 'Спортзал', kind: 'check', schedule: 'per_week', per_week: 3 },
        { title: 'Не курить', kind: 'abstain', schedule: 'weekdays', weekdays: [1, 2] },
      ],
    });
    expect(got).toEqual([
      { title: 'Читать', kind: 'count', target: 20, unit: 'страниц', schedule: 'daily', weekdays: 127, per_week: null },
      { title: 'Спортзал', kind: 'check', target: 1, unit: null, schedule: 'per_week', weekdays: 127, per_week: 3 },
      // «бросить» — всегда каждый день, что бы ни сказала модель
      { title: 'Не курить', kind: 'abstain', target: 1, unit: null, schedule: 'daily', weekdays: 127, per_week: null },
    ]);
  });
  it('дни недели превращает в маску: пн = 1', () => {
    const [h] = toTaskInputs({ habits: [{ title: 'Бег', kind: 'check', schedule: 'weekdays', weekdays: [1, 3, 5] }] });
    expect(h).toMatchObject({ schedule: 'weekdays', weekdays: 0b0010101 });
  });
  it('«считать» без числа становится галочкой', () => {
    const [h] = toTaskInputs({ habits: [{ title: 'Вода', kind: 'count' }] });
    expect(h).toMatchObject({ kind: 'check', target: 1, unit: null });
  });
  it('мусор от модели не роняет разбор', () => {
    expect(toTaskInputs(null)).toEqual([]);
    expect(toTaskInputs({ habits: 'нет' })).toEqual([]);
    expect(toTaskInputs({ habits: [{ kind: 'check' }, { title: '  ' }, { title: 'Йога', kind: 'что-то', per_week: 99, schedule: 'per_week' }] })).toEqual([
      { title: 'Йога', kind: 'check', target: 1, unit: null, schedule: 'daily', weekdays: 127, per_week: null },
    ]);
  });
  it('не больше восьми за раз', () => {
    const many = { habits: Array.from({ length: 20 }, (_, i) => ({ title: `Дело ${i}`, kind: 'check' })) };
    expect(toTaskInputs(many)).toHaveLength(8);
  });
});
