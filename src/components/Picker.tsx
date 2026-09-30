import { useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LangContext, useT } from '../i18n';
import { monthCells, monthOf, shiftMonth } from './Heatmap';

const Chevron = () => (
  <svg className="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9.5 6l6 6-6 6" />
  </svg>
);

const Tick = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/** Шторка снизу — вместо системных выпадающих списков, в стиле приложения. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export interface Option<T> {
  value: T;
  label: string;
}

interface SelectRowProps<T> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /** Короткие значения (время) — плитками в четыре колонки, а не списком. */
  grid?: boolean;
}

/** Строка настройки: тап открывает шторку с вариантами. */
export function SelectRow<T extends string | number>({ label, value, options, onChange, grid }: SelectRowProps<T>): ReactNode {
  const [open, setOpen] = useState(false);
  const pick = (next: T) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };
  return (
    <>
      <button className="row" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="label">{label}</span>
        <span className="value">{options.find((o) => o.value === value)?.label ?? ''}</span>
        <Chevron />
      </button>
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)}>
          <div className={grid ? 'options grid' : 'options'} role="listbox" aria-label={label}>
            {options.map((o) => (
              <button key={o.value} role="option" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => pick(o.value)}>
                {o.label}
                {!grid && o.value === value && <Tick />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

interface DateRowProps {
  label: string;
  /** YYYY-MM-DD или пустая строка. */
  value: string;
  /** Позже этого дня выбрать нельзя. */
  max: string;
  onChange: (value: string) => void;
}

/** Строка с датой: тап открывает шторку-календарь. */
export function DateRow({ label, value, max, onChange }: DateRowProps): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(value || max));
  const { lead, days } = monthCells(month);

  const shown = value
    ? new Date(`${value}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long', ...(value.slice(0, 4) !== max.slice(0, 4) && { year: 'numeric' }) })
    : t.notSet;
  const monthLabel = `${new Date(`${month}-15T12:00:00`).toLocaleDateString(locale, { month: 'long' })} ${month.slice(0, 4)}`;
  const atEnd = month >= monthOf(max);
  const pick = (day: string) => {
    setOpen(false);
    onChange(day);
  };

  return (
    <>
      <button
        className="row"
        aria-haspopup="dialog"
        onClick={() => {
          setMonth(monthOf(value || max));
          setOpen(true);
        }}
      >
        <span className="label">{label}</span>
        <span className="value">{shown}</span>
        <Chevron />
      </button>
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)}>
          <div className="month-nav">
            <button aria-label={t.prevYear} onClick={() => setMonth(shiftMonth(month, -12))}>
              «
            </button>
            <button aria-label={t.prevMonth} onClick={() => setMonth(shiftMonth(month, -1))}>
              ‹
            </button>
            <span>{monthLabel}</span>
            <button aria-label={t.nextMonth} disabled={atEnd} onClick={() => setMonth(shiftMonth(month, 1))}>
              ›
            </button>
            <button aria-label={t.nextYear} disabled={atEnd} onClick={() => setMonth(shiftMonth(month, 12) > monthOf(max) ? monthOf(max) : shiftMonth(month, 12))}>
              »
            </button>
          </div>
          <div className="date-grid">
            {t.weekdaysShort.map((d) => (
              <span key={d}>{d}</span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <i key={`b${i}`} />
            ))}
            {days.map((day, i) => (
              <button key={day} disabled={day > max} className={day === value ? 'on' : ''} aria-pressed={day === value} onClick={() => pick(day)}>
                {i + 1}
              </button>
            ))}
          </div>
          {value && (
            <button className="quiet-link" onClick={() => pick('')}>
              {t.clearDate}
            </button>
          )}
        </Sheet>
      )}
    </>
  );
}
