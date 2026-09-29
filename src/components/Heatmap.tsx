import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { heatLevel, type HeatDay } from '../../shared/types';
import { useT } from '../i18n';

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekdayIndex = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

interface Props {
  days: HeatDay[];
  today: string;
  weeks: number;
  /** Подписи «меньше … больше» и число активных дней. */
  legend?: boolean;
}

/** Карта активности как в GitHub: колонка — неделя (пн сверху), клетка — день. */
export function Heatmap({ days, today, weeks, legend }: Props): ReactNode {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);

  const start = addDays(today, -weekdayIndex(today) - (weeks - 1) * 7);
  const cells: ReactNode[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i);
    const d = byDay.get(day);
    const future = day > today;
    const cls = future ? 'future' : d?.mode === 'pause' ? 'pause' : `l${heatLevel(d?.score ?? 0)}`;
    cells.push(
      <i
        key={day}
        className={`cell ${cls}${day === today ? ' today' : ''}`}
        title={`${day}${d ? ` · ${Math.round(d.score * 10) / 10}` : ''}`}
      />,
    );
  }

  // Годовая карта шире экрана — показываем её с конца, где «сегодня».
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks, days.length]);

  const active = days.filter((d) => d.day <= today && d.score > 0).length;

  return (
    <div className="heatmap">
      <div className="heatmap-scroll" ref={scroller}>
        <div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${weeks}, var(--cell))` }}>
          {cells}
        </div>
      </div>
      {legend && (
        <div className="heatmap-legend">
          <span>{t.activeDays(active)}</span>
          <span className="scale">
            {t.less}
            <i className="cell l0" />
            <i className="cell l1" />
            <i className="cell l2" />
            <i className="cell l3" />
            <i className="cell l4" />
            {t.more}
          </span>
        </div>
      )}
    </div>
  );
}
