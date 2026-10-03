// Карта «Месяц · Год» — в своём профиле и на экране друга (25L): один и тот же блок, высота не прыгает.
import { useContext, type ReactNode } from 'react';
import type { HeatDay } from '../../shared/types';
import { LangContext, useT } from '../i18n';
import { MonthCalendar, YearMap, monthOf, shiftMonth, yearStart } from './Heatmap';

/** Сколько месяцев назад можно листать: столько истории загружено для карты года. */
export const MONTHS_BACK = 11;

interface Props {
  days: HeatDay[];
  today: string;
  view: 'month' | 'year';
  onView: (view: 'month' | 'year') => void;
  /** Сдвиг от текущего месяца: 0 — этот, -1 — прошлый. */
  offset: number;
  onOffset: (offset: number) => void;
}

/** Название месяца сами: в русской локали «long + numeric» даёт «сентябрь 2026 г.». */
export function useMonthName() {
  const locale = useContext(LangContext) === 'ru' ? 'ru-RU' : 'en-US';
  return (m: string, width: 'long' | 'short') => new Date(`${m}-15T12:00:00`).toLocaleDateString(locale, { month: width }).replace('.', '');
}

export function HeatCard({ days, today, view, onView, offset, onOffset }: Props): ReactNode {
  const t = useT();
  const monthName = useMonthName();
  const month = shiftMonth(monthOf(today), offset);
  const shown = view === 'year' ? days : days.filter((d) => d.day.startsWith(month));
  const active = shown.filter((d) => d.score > 0).length;
  const monthLabel = `${monthName(month, 'long')} ${month.slice(0, 4)}`;
  const from = monthOf(yearStart(today));
  const yearLabel = `${monthName(from, 'short')} ${from.slice(0, 4)} — ${monthName(monthOf(today), 'short')} ${today.slice(0, 4)}`;
  return (
    <section className="card pad heat-card">
      <div className="segmented two">
        <button className={view === 'month' ? 'on' : ''} onClick={() => onView('month')}>
          {t.month}
        </button>
        <button className={view === 'year' ? 'on' : ''} onClick={() => onView('year')}>
          {t.year}
        </button>
      </div>
      {/* Строка с периодом есть в обоих видах — блок не прыгает при переключении. */}
      <div className="month-nav">
        <button aria-label={t.prevMonth} hidden={view === 'year'} disabled={offset <= -MONTHS_BACK} onClick={() => onOffset(offset - 1)}>
          ‹
        </button>
        <span className="period">
          <b>{view === 'month' ? monthLabel : yearLabel}</b>
          <small>{t.activeDays(active)}</small>
        </span>
        <button aria-label={t.nextMonth} hidden={view === 'year'} disabled={offset >= 0} onClick={() => onOffset(offset + 1)}>
          ›
        </button>
      </div>
      {/* Оба вида лежат в одной клетке сетки: высота блока всегда по большему из них. */}
      <div className="views">
        <div className={view === 'month' ? '' : 'off'}>
          <MonthCalendar days={days} today={today} month={month} />
        </div>
        <div className={view === 'year' ? '' : 'off'}>
          <YearMap days={days} today={today} monthName={(m) => monthName(m, 'short')} />
        </div>
      </div>
    </section>
  );
}
