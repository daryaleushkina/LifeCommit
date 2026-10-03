import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
}

/** Строка настройки: тап открывает шторку с вариантами. */
export function SelectRow<T extends string | number>({ label, value, options, onChange }: SelectRowProps<T>): ReactNode {
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
          <div className="options" role="listbox" aria-label={label}>
            {options.map((o) => (
              <button key={o.value} role="option" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => pick(o.value)}>
                {o.label}
                {o.value === value && <Tick />}
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
  max?: string;
  /** Раньше этого дня выбрать нельзя (дела — не раньше сегодня). */
  min?: string;
  /** Можно ли стереть дату («Последний раз» — можно, у дела дата есть всегда). */
  clearable?: boolean;
  /** Что писать, пока дата не выбрана. */
  placeholder?: string;
  onChange: (value: string) => void;
}

/** Строка с датой: тап открывает шторку-календарь. */
export function DateRow({ label, value, max, min, clearable = true, placeholder, onChange }: DateRowProps): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const [open, setOpen] = useState(false);
  const anchor = value || max || min || new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(monthOf(anchor));
  const { lead, days } = monthCells(month);

  const shown = value
    ? new Date(`${value}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long', ...(value.slice(0, 4) !== (max ?? min ?? value).slice(0, 4) && { year: 'numeric' }) })
    : (placeholder ?? t.notSet);
  const monthLabel = `${new Date(`${month}-15T12:00:00`).toLocaleDateString(locale, { month: 'long' })} ${month.slice(0, 4)}`;
  const atEnd = max !== undefined && month >= monthOf(max);
  const atStart = min !== undefined && month <= monthOf(min);
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
          setMonth(monthOf(anchor));
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
            <button aria-label={t.prevYear} disabled={atStart} onClick={() => setMonth(min && shiftMonth(month, -12) < monthOf(min) ? monthOf(min) : shiftMonth(month, -12))}>
              «
            </button>
            <button aria-label={t.prevMonth} disabled={atStart} onClick={() => setMonth(shiftMonth(month, -1))}>
              ‹
            </button>
            <span>{monthLabel}</span>
            <button aria-label={t.nextMonth} disabled={atEnd} onClick={() => setMonth(shiftMonth(month, 1))}>
              ›
            </button>
            <button aria-label={t.nextYear} disabled={atEnd} onClick={() => setMonth(max && shiftMonth(month, 12) > monthOf(max) ? monthOf(max) : shiftMonth(month, 12))}>
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
              <button key={day} disabled={(max !== undefined && day > max) || (min !== undefined && day < min)} className={day === value ? 'on' : ''} aria-pressed={day === value} onClick={() => pick(day)}>
                {i + 1}
              </button>
            ))}
          </div>
          {clearable && value && (
            <button className="quiet-link" onClick={() => pick('')}>
              {t.clearDate}
            </button>
          )}
        </Sheet>
      )}
    </>
  );
}

const WHEEL_ROW = 44;

/** Барабан: список с прокруткой, выбранное значение — то, что остановилось по центру. */
function Wheel({ items, index, onChange, label }: { items: string[]; index: number; onChange: (index: number) => void; label: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  // Ставим начальное положение до первой отрисовки, без анимации.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = index * WHEEL_ROW;
    // Только при открытии: дальше положением управляет сама прокрутка (с index в зависимостях барабан дёргался бы к строке).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- намеренно один раз, см. выше
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onScroll = () => {
    window.clearTimeout(timer.current);
    // Прокрутка остановилась — берём ближайшую строку.
    timer.current = window.setTimeout(() => {
      if (!ref.current) return;
      const next = Math.min(items.length - 1, Math.max(0, Math.round(ref.current.scrollTop / WHEEL_ROW)));
      if (next !== index) onChange(next);
    }, 80);
  };

  return (
    <div className="wheel" ref={ref} onScroll={onScroll} role="listbox" aria-label={label} tabIndex={0}>
      {items.map((item, i) => (
        <button
          key={item}
          role="option"
          aria-selected={i === index}
          className={i === index ? 'on' : ''}
          onClick={() => ref.current?.scrollTo({ top: i * WHEEL_ROW, behavior: 'smooth' })}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

interface TimeRowProps {
  label: string;
  /** «HH:MM» или null — выключено. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Шаг минут; 60 — выбираются только часы. */
  minuteStep?: number;
  /** Последний доступный час. */
  maxHour?: number;
  /** Показывать «Выключить». */
  allowOff?: boolean;
  /** Что писать, пока время не выбрано (по умолчанию «Выкл»). */
  offLabel?: string;
  /** Как назвать кнопку «выключить» (у дела — «Без времени»). */
  offAction?: string;
  /** С какого времени открывать барабаны, если его ещё нет. */
  initial?: string;
}

/** Строка со временем: тап открывает шторку с барабанами часов и минут. */
export function TimeRow({ label, value, onChange, minuteStep = 5, maxHour = 23, allowOff, offLabel, offAction, initial = '21:00' }: TimeRowProps): ReactNode {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const hours = Array.from({ length: maxHour + 1 }, (_, i) => pad(i));
  const minutes = minuteStep >= 60 ? ['00'] : Array.from({ length: 60 / minuteStep }, (_, i) => pad(i * minuteStep));

  const show = () => {
    const [h = 21, m = 0] = (value ?? initial).split(':').map(Number);
    setHour(Math.min(maxHour, h));
    setMinute(Math.min(minutes.length - 1, Math.round(m / minuteStep)));
    setOpen(true);
  };
  const done = (next: string | null) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  return (
    <>
      <button className="row" aria-haspopup="dialog" onClick={show}>
        <span className="label">{label}</span>
        <span className="value">{value ?? offLabel ?? t.off}</span>
        <Chevron />
      </button>
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)}>
          <div className="wheels">
            <Wheel items={hours} index={hour} onChange={setHour} label={t.hours} />
            <span aria-hidden>:</span>
            {minutes.length > 1 ? <Wheel items={minutes} index={minute} onChange={setMinute} label={t.minutes} /> : <span className="fixed">00</span>}
          </div>
          <button className="act primary wide" onClick={() => done(`${hours[hour]}:${minutes[minute]}`)}>
            {t.done}
          </button>
          {allowOff && value !== null && (
            <button className="quiet-link" onClick={() => done(null)}>
              {offAction ?? t.turnOff}
            </button>
          )}
        </Sheet>
      )}
    </>
  );
}
