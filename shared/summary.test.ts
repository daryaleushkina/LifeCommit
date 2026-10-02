import { describe, expect, it } from 'vitest';
import { summarize, type SummaryLog, type SummaryTask } from './summary';

const tasks: SummaryTask[] = [
  { id: 1, title: 'Испанский', kind: 'count', unit: 'слов' },
  { id: 2, title: 'Зарядка', kind: 'check', unit: null },
  { id: 3, title: 'Не пить алкоголь', kind: 'abstain', unit: null },
  { id: 4, title: 'Медитация', kind: 'check', unit: null },
  { id: 5, title: 'Старый лимит', kind: 'limit', unit: null },
];
const log = (task_id: number, day: string, value: number, status: SummaryLog['status'] = null): SummaryLog => ({ task_id, day, value, status });

describe('итог по привычкам за период', () => {
  const items = summarize(tasks, [
    log(1, '2026-10-01', 20), log(1, '2026-10-02', 15), log(1, '2026-09-30', 5),
    log(2, '2026-10-01', 1), log(2, '2026-10-02', 0), log(2, '2026-10-03', 1),
    log(3, '2026-10-01', 0, 'clean'), log(3, '2026-10-02', 0, 'slip'), log(3, '2026-10-03', 0, 'clean'),
    log(5, '2026-10-01', 3),
  ]);

  it('«Считать» — сумма, «Делать» — сделанные дни, «Бросить» — дни, когда получилось', () => {
    expect(items.map((i) => [i.title, i.total])).toEqual([['Испанский', 40], ['Зарядка', 2], ['Не пить алкоголь', 2]]);
  });

  it('по месяцам — для столбиков года', () => {
    expect(items[0]!.months[8]).toBe(5);
    expect(items[0]!.months[9]).toBe(35);
  });

  it('без отметок и «лимит» на картинку не попадают, порядок — как у привычек', () => {
    expect(items.some((i) => i.title === 'Медитация' || i.title === 'Старый лимит')).toBe(false);
    expect(summarize(tasks, [])).toEqual([]);
  });
});
