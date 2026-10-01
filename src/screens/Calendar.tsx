import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { sortTodos, type Todo } from '../../shared/types';
import { api } from '../api';
import { addDays, monthOf, shiftMonth } from '../components/Heatmap';
import { TodoList } from '../components/TodoList';
import { LangContext, useT } from '../i18n';
import { useTodoActions } from '../useTodos';

type Mode = 'week' | 'month';

const weekdayIndex = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
const weekStartOf = (day: string) => addDays(day, -weekdayIndex(day));

/** Дни на экране: неделя с понедельника или месяц целыми неделями (до 6 строк). */
function rangeOf(mode: Mode, anchor: string): string[] {
  if (mode === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStartOf(anchor), i));
  const first = `${monthOf(anchor)}-01`;
  const last = addDays(`${shiftMonth(monthOf(anchor), 1)}-01`, -1);
  const days: string[] = [];
  for (let d = weekStartOf(first); d <= last || weekdayIndex(d) !== 0; d = addDays(d, 1)) days.push(d);
  return days;
}

interface Props {
  /** Сегодняшний логический день. */
  today: string;
  /** Дела поменялись — «Сегодня» перечитает себя в фоне. */
  onChanged: () => void;
}

/**
 * Вкладка «Календарь»: неделя или месяц, точки — сколько дел в дне, ниже — дела выбранного дня.
 * Повторяющиеся дела (из календаря телефона) стоят в каждом своём дне со своей отметкой.
 */
export function Calendar({ today, onChanged }: Props): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const [mode, setMode] = useState<Mode>('week');
  const [selected, setSelected] = useState(today);
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const days = rangeOf(mode, selected);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  // Ответ на старый промежуток (быстро листали) не должен затереть новый.
  const asked = useRef('');

  const load = useCallback(async () => {
    const key = `${from}:${to}`;
    asked.current = key;
    const res = await api.calendar(from, to).catch(() => null);
    if (res && asked.current === key) setTodos(res.todos);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useTodoActions({
    patchList: (fn) => setTodos((list) => (list ? fn(list) : list)),
    reload: async () => {
      await load();
      onChanged();
    },
    errorText: t.error,
  });

  const shift = (n: number) => setSelected(mode === 'week' ? addDays(selected, 7 * n) : `${shiftMonth(monthOf(selected), n)}-01`);
  const ofDay = (day: string) => (todos ?? []).filter((d) => d.day === day);
  const dayTodos = sortTodos(ofDay(selected));
  const monthTitle = new Date(`${monthOf(selected)}-15T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' }).replace(' г.', '');
  const dayTitle = new Date(`${selected}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <header className="page-head">
        <h1>{t.calendar}</h1>
      </header>

      <div className="segmented two cal-mode" role="radiogroup" aria-label={t.calendar}>
        {(['week', 'month'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {m === 'week' ? t.week : t.month}
          </button>
        ))}
      </div>

      <div className="month-nav flat">
        <button aria-label={t.prevMonth} onClick={() => shift(-1)}>
          ‹
        </button>
        <span>{monthTitle}</span>
        <button aria-label={t.nextMonth} onClick={() => shift(1)}>
          ›
        </button>
      </div>

      <div className={`cal-grid ${mode}`} role="grid" aria-label={monthTitle}>
        {t.weekdaysShort.map((w) => (
          <span key={w} className="cal-wd" aria-hidden>
            {w}
          </span>
        ))}
        {days.map((day) => {
          const list = ofDay(day);
          const open = list.filter((d) => !d.done);
          const out = mode === 'month' && monthOf(day) !== monthOf(selected);
          return (
            <button
              key={day}
              role="gridcell"
              aria-selected={day === selected}
              className={['cal-day', day === selected && 'on', day === today && 'today', out && 'out'].filter(Boolean).join(' ')}
              onClick={() => setSelected(day)}
            >
              <b>{Number(day.slice(8))}</b>
              {/* Точки: до трёх несделанных дел; синие — пришли из календаря телефона. */}
              <span className="cal-dots" aria-hidden>
                {open.slice(0, 3).map((d) => (
                  <i key={`${d.id}:${d.day}`} className={d.source ? 'ext' : undefined} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {actions.error && (
        <p className="error" onClick={actions.clearError}>
          {actions.error}
        </p>
      )}

      {todos !== null && (
        <TodoList
          todos={dayTodos}
          today={today}
          heading={dayTitle}
          addLabel={t.calAdd}
          showCarry={false}
          canAdd={selected >= today}
          onToggle={(d) => void actions.toggle(d)}
          onAdd={(title) => void actions.add(title, selected)}
          onUpdate={actions.update}
          onRemove={actions.remove}
        />
      )}
    </>
  );
}
