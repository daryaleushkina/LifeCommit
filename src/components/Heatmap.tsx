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

/** 12 мини-календарей: последние 12 месяцев, текущий — последний. */
export function MonthGrid({ days, today, monthNames }: { days: HeatDay[]; today: string; monthNames: string[] }): ReactNode {
  const levels = useLevels(days);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });
  return (
    <div className="months" aria-hidden>
      {months.map(({ year, month }) => {
        const first = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
        const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const lead = weekdayIndex(first);
        return (
          <div key={`${year}-${month}`} className="month">
            <span>{monthNames[month]}</span>
            <div className="month-grid">
              {Array.from({ length: lead }, (_, i) => (
                <i key={`b${i}`} className="blank" />
              ))}
              {Array.from({ length: count }, (_, i) => {
                const day = addDays(first, i);
                const cls = day > today ? 'future' : `l${levels.get(day) ?? 0}${day === today ? ' today' : ''}`;
                return <i key={day} className={cls} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
