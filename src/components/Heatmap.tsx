import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { heatLevel, type HeatDay } from '../../shared/types';

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekdayIndex = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

function useLevels(days: HeatDay[]) {
  return useMemo(() => new Map(days.map((d) => [d.day, heatLevel(d.score)])), [days]);
}

/**
 * Карта как в GitHub: колонка — неделя (пн сверху), клетка — день.
 * Растягивается на всю ширину родителя: края совпадают с краями карточек.
 */
export function Heatmap({ days, today, weeks, gap, end = today }: { days: HeatDay[]; today: string; weeks: number; gap: number; end?: string }): ReactNode {
  const levels = useLevels(days);
  // Последняя колонка — неделя, в которую попадает end (по умолчанию сегодня).
  const start = addDays(end, -weekdayIndex(end) - (weeks - 1) * 7);
  const cells: ReactNode[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i);
    const cls = day > today ? 'future' : `l${levels.get(day) ?? 0}${day === today ? ' today' : ''}`;
    cells.push(<i key={day} className={cls} />);
  }
  return (
    <div className="heat" style={{ '--weeks': weeks, '--gap': `${gap}px` } as CSSProperties} aria-hidden>
      {cells}
    </div>
  );
}

/** «2026-09» из дня «2026-09-30». */
export const monthOf = (day: string): string => day.slice(0, 7);

/** Месяц со сдвигом: shiftMonth('2026-01', -1) → '2025-12'. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Дни месяца и сколько пустых клеток перед первым числом (пн слева). */
export function monthCells(month: string): { lead: number; days: string[] } {
  const first = `${month}-01`;
  const count = Math.round((Date.parse(`${shiftMonth(month, 1)}-01T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
  return { lead: weekdayIndex(first), days: Array.from({ length: count }, (_, i) => addDays(first, i)) };
}

/** Один месяц: небольшая сетка клеток, пн слева, цвет — уровень дня. */
export function MonthCalendar({ days, today, month }: { days: HeatDay[]; today: string; month: string }): ReactNode {
  const levels = useLevels(days);
  const cells = monthCells(month);
  return (
    <div className="cal" aria-hidden>
      {Array.from({ length: cells.lead }, (_, i) => (
        <i key={`b${i}`} className="blank" />
      ))}
      {cells.days.map((day) => (
        <i key={day} className={day > today ? 'future' : `l${levels.get(day) ?? 0}${day === today ? ' today' : ''}`} />
      ))}
    </div>
  );
}

/** Сколько недель в каждой половине карты года. */
export const HALF_YEAR_WEEKS = 26;

/** Первый день карты года (понедельник 52 недели назад). */
export const yearStart = (today: string): string => addDays(today, -weekdayIndex(today) - (HALF_YEAR_WEEKS * 2 - 1) * 7);

/** Год двумя полосами по полгода: так клетки вдвое крупнее, чем в одной полосе на 53 недели. */
export function YearMap({ days, today }: { days: HeatDay[]; today: string }): ReactNode {
  return (
    <div className="year-map">
      <Heatmap days={days} today={today} end={addDays(today, -HALF_YEAR_WEEKS * 7)} weeks={HALF_YEAR_WEEKS} gap={2} />
      <Heatmap days={days} today={today} weeks={HALF_YEAR_WEEKS} gap={2} />
    </div>
  );
}
