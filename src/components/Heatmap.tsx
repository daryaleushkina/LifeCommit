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
export function Heatmap({ days, today, weeks, gap }: { days: HeatDay[]; today: string; weeks: number; gap: number }): ReactNode {
  const levels = useLevels(days);
  const start = addDays(today, -weekdayIndex(today) - (weeks - 1) * 7);
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

/** Один месяц календарём: пн слева, в клетке — число, цвет — уровень дня. */
export function MonthCalendar({ days, today, month, weekdays }: { days: HeatDay[]; today: string; month: string; weekdays: string[] }): ReactNode {
  const levels = useLevels(days);
  const first = `${month}-01`;
  const count = Math.round((Date.parse(`${shiftMonth(month, 1)}-01T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
  return (
    <div className="cal" aria-hidden>
      {weekdays.map((d) => (
        <span key={d}>{d}</span>
      ))}
      {Array.from({ length: weekdayIndex(first) }, (_, i) => (
        <i key={`b${i}`} className="blank" />
      ))}
      {Array.from({ length: count }, (_, i) => {
        const day = addDays(first, i);
        const cls = day > today ? 'future' : `l${levels.get(day) ?? 0}${day === today ? ' today' : ''}`;
        return (
          <i key={day} className={cls}>
            {i + 1}
          </i>
        );
      })}
    </div>
  );
}
