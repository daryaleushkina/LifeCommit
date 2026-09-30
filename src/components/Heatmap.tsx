import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
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

/** Сколько недель в карте года (371 день — столько отдаёт /api/heatmap). */
export const YEAR_WEEKS = 53;

/** Первый день карты года (понедельник 52 недели назад). */
export const yearStart = (today: string): string => addDays(today, -weekdayIndex(today) - (YEAR_WEEKS - 1) * 7);

/**
 * Год одной лентой, как в GitHub: колонка — неделя, над ней название месяца, в котором он начался.
 * Клетки крупные, поэтому лента шире экрана: открывается на текущей неделе, назад листается пальцем.
 */
export function YearMap({ days, today, monthName }: { days: HeatDay[]; today: string; monthName: (month: string) => string }): ReactNode {
  const levels = useLevels(days);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const start = yearStart(today);
  const weeks: ReactNode[] = [];
  for (let w = 0; w < YEAR_WEEKS; w++) {
    const monday = addDays(start, w * 7);
    // Подпись — у недели, в которой начался месяц (у первой колонки — всегда).
    const firstOfMonth = Array.from({ length: 7 }, (_, d) => addDays(monday, d)).find((day) => day.endsWith('-01'));
    const label = firstOfMonth ? monthName(monthOf(firstOfMonth)) : w === 0 ? monthName(monthOf(monday)) : '';
    weeks.push(
      <div key={monday} className="year-week">
        <span>{label}</span>
        {Array.from({ length: 7 }, (_, d) => {
          const day = addDays(monday, d);
          return <i key={day} className={day > today ? 'future' : `l${levels.get(day) ?? 0}${day === today ? ' today' : ''}`} />;
        })}
      </div>,
    );
  }
  return (
    <div className="year-map" ref={scroller} aria-hidden>
      {weeks}
    </div>
  );
}
