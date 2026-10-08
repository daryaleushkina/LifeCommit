// Кэш «Календаря»: день из уже загруженного месяца, правка во все промежутки с этим днём, правки с «Сегодня».
import { describe, expect, it } from 'vitest';
import type { GroupDayBlock } from '../shared/groups';
import type { Todo } from '../shared/types';
import { patchDay, patchTodos, rangeFrom, storeRange, syncToday, type DaysEntry } from './calendarDays';

const todo = (patch: Partial<Todo>): Todo => ({
  id: 1, title: 'Дело', day: '2026-10-03', done: false, time: null, duration_min: null, recurring: false, source: null, details: null, ...patch,
});
const block = (day: string, id = 10): GroupDayBlock => ({ day, group: { id, title: 'Семья', kind: 'family', members: [] }, items: [] });
const map = (entries: Record<string, DaysEntry>) => new Map(Object.entries(entries));

describe('rangeFrom: что показать для промежутка', () => {
  const month: DaysEntry = {
    todos: [todo({ id: 1, day: '2026-10-03' }), todo({ id: 2, day: '2026-10-04' }), todo({ id: 3, day: '2026-09-30' })],
    groups: [block('2026-10-03'), block('2026-10-04')],
  };

  it('точный промежуток — как есть', () => {
    const day: DaysEntry = { todos: [todo({ id: 9 })], groups: [] };
    expect(rangeFrom(map({ '2026-10-03:2026-10-03': day, '2026-09-28:2026-11-01': month }), '2026-10-03', '2026-10-03')).toBe(day);
  });

  it('нет точного — вырезает день из месяца, который его покрывает', () => {
    const v = rangeFrom(map({ '2026-09-28:2026-11-01': month }), '2026-10-04', '2026-10-04');
    expect(v?.todos.map((d) => d.id)).toEqual([2]);
    expect(v?.groups.map((b) => b.day)).toEqual(['2026-10-04']);
  });

  it('ничего не покрывает — нет данных', () => {
    expect(rangeFrom(map({ '2026-09-28:2026-11-01': month }), '2026-11-02', '2026-11-02')).toBeUndefined();
    expect(rangeFrom(map({ '2026-10-03:2026-10-03': month }), '2026-09-28', '2026-11-01')).toBeUndefined();
  });
});

describe('patchDay: правка дня — во все закэшированные промежутки с этим днём', () => {
  it('день и месяц правятся, чужой день — нет', () => {
    const days = map({
      '2026-10-03:2026-10-03': { todos: [todo({ id: 1 })], groups: [] },
      '2026-09-28:2026-11-01': { todos: [todo({ id: 1 }), todo({ id: 2, day: '2026-10-05' })], groups: [] },
      '2026-10-04:2026-10-04': { todos: [], groups: [] },
    });
    patchDay(days, '2026-10-03', (e) => ({ ...e, todos: e.todos.map((d) => (d.id === 1 ? { ...d, done: true } : d)) }));
    expect(days.get('2026-10-03:2026-10-03')!.todos[0]!.done).toBe(true);
    expect(days.get('2026-09-28:2026-11-01')!.todos.map((d) => d.done)).toEqual([true, false]);
    expect(days.get('2026-10-04:2026-10-04')!.todos).toEqual([]);
  });
});

it('перечитка дня заменяет общие дела в месяце, включая удалённые; чужие дни и промежутки сохраняются', () => {
  const day = '2026-10-03';
  const other = block('2026-10-04');
  const outside: DaysEntry = { todos: [todo({ day: '2026-11-05' })], groups: [block('2026-11-05')] };
  const days = map({
    '2026-10-01:2026-10-31': { todos: [], groups: [block(day), other] },
    '2026-11-05:2026-11-05': outside,
  });
  storeRange(days, day, day, { todos: [], groups: [block(day, 20)] });
  expect(days.get('2026-10-01:2026-10-31')?.groups).toEqual([other, block(day, 20)]);
  expect(days.get('2026-11-05:2026-11-05')).toBe(outside);
  storeRange(days, day, day, { todos: [], groups: [] });
  expect(days.get('2026-10-01:2026-10-31')?.groups).toEqual([other]);
});

it('новое дело попадает только в промежутки своего дня; правка и удаление повтора — во все его дни', () => {
  const first = todo({ recurring: true });
  const second = { ...first, day: '2026-10-04' };
  const days = map({
    '2026-10-03:2026-10-03': { todos: [first], groups: [] },
    '2026-10-04:2026-10-04': { todos: [second], groups: [] },
    '2026-10-01:2026-10-31': { todos: [first, second], groups: [block(first.day)] },
  });
  const added = todo({ id: 2 });
  patchTodos(days, (list) => [...list, added]);
  expect(days.get('2026-10-03:2026-10-03')?.todos).toEqual([first, added]);
  expect(days.get('2026-10-04:2026-10-04')?.todos).toEqual([second]);
  patchTodos(days, (list) => list.map((d) => d.id === 1 ? { ...d, title: 'Повтор!' } : d));
  expect(days.get('2026-10-04:2026-10-04')?.todos[0]?.title).toBe('Повтор!');
  patchTodos(days, (list) => list.filter((d) => d.id !== 1));
  expect(days.get('2026-10-04:2026-10-04')?.todos).toEqual([]);
  expect(days.get('2026-10-01:2026-10-31')).toEqual({ todos: [added], groups: [block(first.day)] });
});

describe('syncToday: что поменялось на «Сегодня» — в кэш «Календаря»', () => {
  const T = '2026-10-03';
  const setup = () =>
    map({
      [`${T}:${T}`]: { todos: [todo({ id: 1, title: 'Хлеб' }), todo({ id: 2, title: 'Молоко' })], groups: [block(T)] },
      '2026-09-28:2026-11-01': { todos: [todo({ id: 1, title: 'Хлеб' }), todo({ id: 2, title: 'Молоко' }), todo({ id: 5, day: '2026-10-10' })], groups: [] },
      '2026-10-04:2026-10-04': { todos: [todo({ id: 7, day: '2026-10-04' })], groups: [] },
    });

  it('отметили, добавили, удалили — то же в каждом промежутке с этим днём; другие дни и группы не трогаются', () => {
    const days = setup();
    const prev = [todo({ id: 1, title: 'Хлеб' }), todo({ id: 2, title: 'Молоко' })];
    const next = [todo({ id: 1, title: 'Хлеб', done: true }), todo({ id: 3, title: 'Новое' })];
    syncToday(days, { day: T, todos: prev }, { day: T, todos: next });
    for (const key of [`${T}:${T}`, '2026-09-28:2026-11-01']) {
      const ofDay = days.get(key)!.todos.filter((d) => d.day === T);
      expect(ofDay.map((d) => [d.id, d.done])).toEqual([[1, true], [3, false]]);
    }
    expect(days.get('2026-09-28:2026-11-01')!.todos.some((d) => d.id === 5)).toBe(true);
    expect(days.get(`${T}:${T}`)!.groups).toHaveLength(1);
    expect(days.get('2026-10-04:2026-10-04')!.todos.map((d) => d.id)).toEqual([7]);
  });

  it('не изменившееся не трогает: свежая правка в «Календаре» не затирается старым с «Сегодня»', () => {
    const days = setup();
    patchDay(days, T, (e) => ({ ...e, todos: e.todos.map((d) => (d.id === 2 ? { ...d, done: true } : d)) }));
    const prev = [todo({ id: 1, title: 'Хлеб' }), todo({ id: 2, title: 'Молоко' })];
    syncToday(days, { day: T, todos: prev }, { day: T, todos: [todo({ id: 1, title: 'Хлеб', done: true }), todo({ id: 2, title: 'Молоко' })] });
    expect(days.get(`${T}:${T}`)!.todos.map((d) => [d.id, d.done])).toEqual([[1, true], [2, true]]);
  });

  it('дела не на сегодня («со вчера») в «Сегодня» — в чужие дни не попадают', () => {
    const days = setup();
    syncToday(days, { day: T, todos: [] }, { day: T, todos: [todo({ id: 8, day: '2026-10-02', title: 'Со вчера' })] });
    expect([...days.values()].flatMap((e) => e.todos).some((d) => d.id === 8)).toBe(false);
  });

  it('сменился день или «Сегодня» ещё не загружено — ничего не делает', () => {
    const days = setup();
    const before = JSON.stringify([...days]);
    syncToday(days, { day: '', todos: [] }, { day: T, todos: [todo({ id: 9 })] });
    syncToday(days, { day: '2026-10-02', todos: [todo({ id: 1, day: '2026-10-02' })] }, { day: T, todos: [] });
    // Тот же список заново (перечитали «Сегодня», ничего не поменялось).
    syncToday(days, { day: T, todos: [todo({ id: 1, title: 'Хлеб' })] }, { day: T, todos: [todo({ id: 1, title: 'Хлеб' })] });
    expect(JSON.stringify([...days])).toBe(before);
  });
});
