// Крайние случаи общих функций, которых нет в основных тестах модулей: непонятные правила повтора,
// интервалы месяцев и лет, цели и пустые очереди групп, «чистые» дни до начала привычки, порядок дел.
import { describe, expect, it } from 'vitest';
import { dayCount, dayItem, occurrenceIndex, occursOn as groupOccursOn, type GroupItemRow } from './groups';
import { occurrences, parseRRule } from './rrule';
import { cleanRuns, targetOn } from './stats';
import { sortTodos } from './types';

const rule = (s: string) => {
  const r = parseRRule(s);
  if (!r) throw new Error(`не разобрали ${s}`);
  return r;
};

describe('rrule: крайние случаи', () => {
  it('INTERVAL=0 или не число — каждый раз; части без значения пропускаются', () => {
    expect(rule('FREQ=DAILY;INTERVAL=0').interval).toBe(1);
    expect(rule('FREQ=DAILY;INTERVAL=abc;WKST').interval).toBe(1);
  });

  it('каждый день, но только по указанным числам месяца', () => {
    expect(occurrences(rule('FREQ=DAILY;BYMONTHDAY=1,-1'), '2026-01-15', '2026-01-01', '2026-03-01')).toEqual(['2026-01-31', '2026-02-01', '2026-02-28', '2026-03-01']);
  });

  it('раз в два месяца: пропускает нечётные; «второй вторник, если это 8–14 число»', () => {
    expect(occurrences(rule('FREQ=MONTHLY;INTERVAL=2'), '2026-01-10', '2026-01-01', '2026-06-30')).toEqual(['2026-01-10', '2026-03-10', '2026-05-10']);
    expect(occurrences(rule('FREQ=MONTHLY;BYDAY=TU;BYMONTHDAY=8,9,10,11,12,13,14'), '2026-01-01', '2026-01-01', '2026-03-31')).toEqual(['2026-01-13', '2026-02-10', '2026-03-10']);
  });

  it('раз в два года — через год пропуск', () => {
    expect(occurrences(rule('FREQ=YEARLY;INTERVAL=2'), '2026-05-09', '2026-01-01', '2029-12-31')).toEqual(['2026-05-09', '2028-05-09']);
  });
});

describe('группы: крайние случаи', () => {
  const base: GroupItemRow = {
    id: 1, title: 'Дело', mode: 'one', day: '2026-10-01', time: null, duration_min: null, rrule: null, exdates: [], due_day: null,
    assignees: [], all_members: false, rotate: false, target: null, unit: null, goal_until: null, total: null, marks: [],
  };

  it('непонятное правило повтора — только в день начала, очередь не идёт', () => {
    const odd = { ...base, rrule: 'FREQ=HOURLY' };
    expect(groupOccursOn(odd, '2026-10-01')).toBe(true);
    expect(groupOccursOn(odd, '2026-10-02')).toBe(false);
    expect(occurrenceIndex(odd, '2026-10-05')).toBe(0);
    expect(occurrenceIndex(base, '2026-10-05')).toBe(0);
  });

  it('общая цель: числа из базы приходят строками — отдаём числами; в «сделано за день» не входит', () => {
    const goal = { ...base, mode: 'goal' as const, target: '150000' as unknown as number, total: '27500.5' as unknown as number };
    const it = dayItem(goal, [10], 10, '2026-12-01')!;
    expect(it).toMatchObject({ target: 150000, total: 27500.5, for_me: true, can_mark: false, carried: false });
    expect(dayCount(it)).toEqual({ planned: 0, done: 0 });
  });

  it('очередь, никто ещё не сделал: один раз на группу, сделано 0', () => {
    const turn = { ...base, mode: 'assign' as const, rotate: true, assignees: [10, 20], rrule: 'FREQ=DAILY' };
    const it = dayItem(turn, [10, 20], 10, '2026-10-02')!;
    expect(it.turn).toBe(20);
    expect(dayCount(it)).toEqual({ planned: 1, done: 0 });
    expect(dayCount(dayItem(base, [10, 20], 10, '2026-10-01')!)).toEqual({ planned: 1, done: 0 });
  });
});

describe('статистика привычки: крайние случаи', () => {
  it('без истории целей — цель 1', () => {
    expect(targetOn([], '2026-10-01')).toBe(1);
  });

  it('срыв, отмеченный задним числом до начала привычки, рвёт период до неё', () => {
    const logs = [{ day: '2026-09-25', value: 0, status: 'slip' as const }];
    // «последний раз» 20-го, привычка с 28-го, сегодня 30-е, отметок в приложении нет.
    expect(cleanRuns(logs, '2026-09-28', '2026-09-20', '2026-09-30')).toEqual({ longest: 4, current: 0 });
    // Тот же день отмечен «чисто» — период не рвётся.
    expect(cleanRuns([{ day: '2026-09-25', value: 1, status: 'clean' }], '2026-09-28', '2026-09-20', '2026-09-28')).toEqual({ longest: 7, current: 7 });
  });
});

describe('порядок дел', () => {
  it('несделанные со временем — по часам, потом без времени (в своём порядке), сделанные — вниз', () => {
    const list = [
      { title: 'сделано', done: true, time: '07:00' },
      { title: 'без времени 1', done: false, time: null },
      { title: 'в 18', done: false, time: '18:00' },
      { title: 'без времени 2', done: false, time: null },
      { title: 'в 9', done: false, time: '09:00' },
      { title: 'сделано без времени', done: true, time: null },
    ];
    expect(sortTodos(list).map((d) => d.title)).toEqual(['в 9', 'в 18', 'без времени 1', 'без времени 2', 'сделано', 'сделано без времени']);
  });
});
