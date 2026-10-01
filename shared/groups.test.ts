import { describe, expect, it } from 'vitest';
import { dayCount, dayItem, occursOn, plural, type GroupItemRow } from './groups';

const base: GroupItemRow = {
  id: 1, title: 'Дело', mode: 'one', day: '2026-10-01', time: null, duration_min: null, rrule: null, exdates: [], due_day: null,
  assignees: [], all_members: false, rotate: false, target: null, unit: null, goal_until: null, total: null, marks: [],
};
const members = [10, 20, 30];

describe('кто-то один', () => {
  it('видно всем, закрывается первой отметкой, снять может только сделавший', () => {
    const it = { ...base, marks: [{ user_id: 20, at: '' }] };
    const forMe = dayItem(it, members, 10, '2026-10-01')!;
    expect(forMe).toMatchObject({ for_me: true, done: true, can_mark: false, done_by: [20] });
    expect(dayItem(it, members, 20, '2026-10-01')!.can_mark).toBe(true);
    expect(dayCount(forMe)).toEqual({ planned: 1, done: 1 });
  });
  it('разовое несделанное переезжает на следующие дни', () => {
    expect(dayItem(base, members, 10, '2026-10-03')).toMatchObject({ carried: true, done: false });
    expect(dayItem(base, members, 10, '2026-09-30')).toBeNull();
  });
});

describe('назначить', () => {
  it('одному: только ему на «Сегодня»', () => {
    const it = { ...base, mode: 'assign' as const, assignees: [20] };
    expect(dayItem(it, members, 10, '2026-10-01')!.for_me).toBe(false);
    expect(dayItem(it, members, 20, '2026-10-01')).toMatchObject({ for_me: true, can_mark: true });
  });
  it('«Все»: каждому своё, считаются отдельно', () => {
    const it = { ...base, mode: 'assign' as const, all_members: true, rrule: 'FREQ=DAILY', marks: [{ user_id: 10, at: '' }] };
    const mine = dayItem(it, members, 10, '2026-10-05')!;
    expect(mine).toMatchObject({ done: true, people: members });
    expect(dayItem(it, members, 30, '2026-10-05')!.done).toBe(false);
    expect(dayCount(mine)).toEqual({ planned: 3, done: 1 });
  });
  it('по очереди: в будни сменяются, пропуск очередь не сдвигает', () => {
    const it = { ...base, mode: 'assign' as const, assignees: [20, 10], rotate: true, day: '2026-10-05', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' };
    expect(dayItem(it, members, 10, '2026-10-05')!.turn).toBe(20); // пн — первый раз
    expect(dayItem(it, members, 10, '2026-10-06')!.turn).toBe(10); // вт
    expect(dayItem(it, members, 10, '2026-10-12')!.turn).toBe(10); // пн следующей недели — шестой раз (индекс 5)
    expect(dayItem(it, members, 10, '2026-10-11')).toBeNull(); // вс — не бывает
    expect(dayItem(it, members, 20, '2026-10-06')).toMatchObject({ for_me: false, can_mark: false });
  });
  it('ушедший из группы выпадает из назначенных', () => {
    const it = { ...base, mode: 'assign' as const, assignees: [20, 99] };
    expect(dayItem(it, members, 20, '2026-10-01')!.people).toEqual([20]);
  });
});

describe('мероприятие и цель', () => {
  it('мероприятие без галочки и только в свой день', () => {
    const ev = { ...base, mode: 'event' as const, time: '19:00' };
    expect(dayItem(ev, members, 10, '2026-10-01')).toMatchObject({ can_mark: false, done: false });
    expect(dayItem(ev, members, 10, '2026-10-02')).toBeNull();
    expect(dayCount(dayItem(ev, members, 10, '2026-10-01')!)).toEqual({ planned: 0, done: 0 });
  });
  it('цель видна всегда', () => {
    expect(occursOn({ ...base, mode: 'goal', day: '2026-12-01' }, '2026-10-01')).toBe(true);
  });
});

describe('формы слов', () => {
  const f: [string, string, string] = ['книга', 'книги', 'книг'];
  it('1, 2, 5, 11, 21, 1,5', () => {
    expect([1, 2, 5, 11, 21, 104, 1.5].map((n) => plural(n, f))).toEqual(['книга', 'книги', 'книг', 'книг', 'книга', 'книги', 'книги']);
  });
});
