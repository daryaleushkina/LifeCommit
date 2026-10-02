import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { sortTodos, type Todo } from '../../shared/types';
import { api, type CalendarAccount } from '../api';
import { caches, load as fetchInto, warm } from '../caches';
import { CalendarsSheet, syncedLabel } from '../components/CalendarsSheet';
import { addDays, monthOf, shiftMonth } from '../components/Heatmap';
import { AvatarStack, GroupItemRow } from '../components/groupUi';
import { TodoList } from '../components/TodoList';
import { LangContext, useT } from '../i18n';
import { useTodoActions } from '../useTodos';

type Mode = 'day' | 'month';
const BANNER_KEY = 'lc-cal-banner-hidden';

const weekdayIndex = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
const weekStartOf = (day: string) => addDays(day, -weekdayIndex(day));

/** Дни на экране: один день или месяц целыми неделями (до 6 строк). */
function rangeOf(mode: Mode, anchor: string): string[] {
  if (mode === 'day') return [anchor];
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
  /** Сразу открыть шторку «Календари». */
  openSheet?: boolean;
  /** Мой id — чьи групповые дела и очередь. */
  me: number;
  onOpenGroup: (id: number) => void;
}

/**
 * Вкладка «Календарь»: день или месяц (точки — сколько дел в дне), ниже — дела выбранного дня.
 * Повторяющиеся дела (из календаря телефона) стоят в каждом своём дне со своей отметкой.
 */
/** Промежуток дней на экране: день или месяц целыми неделями. */
const keyOf = (mode: Mode, anchor: string) => {
  const days = rangeOf(mode, anchor);
  return [days[0]!, days[days.length - 1]!] as const;
};

export function Calendar({ today, onChanged, openSheet = false, me, onOpenGroup }: Props): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const [mode, setMode] = useState<Mode>('day');
  const [selected, setSelected] = useState(today);
  const days = rangeOf(mode, selected);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const key = `${from}:${to}`;
  // Что на экране — прямо из кэша, ещё до первой отрисовки: уже виденный (или подтянутый заранее) день открывается сразу.
  // Правки «на месте» (отметили — галочка сразу, сервер догоняет) пишутся в тот же кэш.
  const [, rerender] = useState(0);
  const shown = caches.days.get(key);
  const todos = shown?.todos ?? null;
  // Дела групп, которые касаются меня, по дням.
  const groupDays = shown?.groups ?? [];
  const setTodos = (fn: (list: Todo[] | null) => Todo[] | null) => {
    // Берём текущее из кэша, а не из отрисовки: правку могут применить после ожидания сервера.
    const cur = caches.days.get(key);
    if (!cur) return;
    caches.days.set(key, { todos: fn(cur.todos) ?? [], groups: cur.groups });
    rerender((n) => n + 1);
  };

  const load = useCallback(async () => {
    if (await fetchInto.range(from, to).catch(() => null)) rerender((n) => n + 1);
  }, [from, to]);

  useEffect(() => {
    void load();
    // Соседние дни (или месяцы) — заранее: листать стрелками без пустых кадров.
    for (const n of [1, -1]) {
      const next = mode === 'day' ? addDays(selected, n) : `${shiftMonth(monthOf(selected), n)}-01`;
      const [a, b] = keyOf(mode, next);
      if (!caches.days.has(`${a}:${b}`)) warm(fetchInto.range(a, b));
    }
    // И месяц — чтобы «Месяц» открылся сразу.
    if (mode === 'day') {
      const [a, b] = keyOf('month', selected);
      if (!caches.days.has(`${a}:${b}`)) warm(fetchInto.range(a, b));
    }
  }, [load]);

  // Подключённые календари. Синхронизация — при запуске приложения и по кнопке «Обновить» (решение владелицы 02.10.2026),
  // при открытии вкладки — нет: вкладка должна открываться сразу.
  const [accounts, setAccounts] = useState<CalendarAccount[] | null>(caches.accounts);
  const [sheet, setSheet] = useState(openSheet);
  const [bannerHidden, setBannerHidden] = useState(() => {
    try {
      return localStorage.getItem(BANNER_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [syncing, setSyncing] = useState(false);
  const syncNow = useCallback(async () => {
    setSyncing(true);
    await api.syncCalendars().catch(() => null);
    setAccounts(await fetchInto.accounts().catch(() => caches.accounts ?? []));
    // Синхронизация могла поменять любые дни — уже виденное перечитаем по мере открытия.
    caches.days.clear();
    await load();
    setSyncing(false);
    onChanged();
  }, [load, onChanged]);
  useEffect(() => {
    fetchInto.accounts().then(setAccounts, () => setAccounts((cur) => cur ?? []));
    // Нет Google — заранее берём ссылку входа: шторка календарей откроется уже с кнопкой.
    if (!caches.accounts?.some((a) => a.provider === 'google')) warm(fetchInto.googleUrl());
  }, []);

  const actions = useTodoActions({
    patchList: (fn) => setTodos((list) => (list ? fn(list) : list)),
    reload: async () => {
      await load();
      onChanged();
    },
    errorText: t.error,
  });

  const shift = (n: number) => setSelected(mode === 'day' ? addDays(selected, n) : `${shiftMonth(monthOf(selected), n)}-01`);
  const ofDay = (day: string) => (todos ?? []).filter((d) => d.day === day);
  const dayTodos = sortTodos(ofDay(selected));
  const monthTitle = new Date(`${monthOf(selected)}-15T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' }).replace(' г.', '');
  const dayTitle = new Date(`${selected}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <header className="page-head with-action">
        <h1>{t.calendar}</h1>
        <span className="head-actions">
          {/* Обновить — просто обновляет, крутится, пока идёт; настройки календарей — отдельная кнопка. */}
          {accounts && accounts.length > 0 && (
            <button className={`icon-btn${syncing ? ' spinning' : ''}`} aria-label={t.cal.refresh} disabled={syncing} onClick={() => void syncNow()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" />
                <path d="M18 3v4h-4M6 21v-4h4" />
              </svg>
            </button>
          )}
          <button className="icon-btn" aria-label={t.cal.sheetTitle} onClick={() => setSheet(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
        </span>
      </header>

      {accounts && accounts.length === 0 && !bannerHidden && (
        <div className="cal-banner">
          <span className="cal-banner-text">
            <b>{t.cal.connectTitle}</b>
            {t.cal.connectHint}
          </span>
          <button className="act primary" onClick={() => setSheet(true)}>
            {t.cal.connect}
          </button>
          <button
            className="cal-banner-x"
            aria-label={t.voice.cancel}
            onClick={() => {
              setBannerHidden(true);
              try {
                localStorage.setItem(BANNER_KEY, '1');
              } catch {
                // не запомнили — покажем в следующий раз
              }
            }}
          >
            ×
          </button>
        </div>
      )}
      {accounts && accounts.length > 0 && (
        <div className="cal-chips">
          {accounts.map((a) => (
            <button key={a.id} className={`cal-chip${a.status === 'auth_failed' || a.status === 'error' ? ' bad' : ''}`} onClick={() => (a.status === 'ok' ? void syncNow() : setSheet(true))}>
              <span className={`src-mark ${a.provider}`}>{a.provider === 'apple' ? 'A' : 'G'}</span>
              {a.status === 'ok' ? syncedLabel(t, a.last_sync_at) : a.status === 'setup' ? t.cal.googleSetup : a.provider === 'apple' ? t.cal.newPassword : t.cal.reconnect}
            </button>
          ))}
        </div>
      )}
      {sheet && (
        <CalendarsSheet
          onClose={() => setSheet(false)}
          onChanged={() => {
            void syncNow();
          }}
        />
      )}

      <div className="segmented two cal-mode" role="radiogroup" aria-label={t.calendar}>
        {(['day', 'month'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {m === 'day' ? t.day : t.month}
          </button>
        ))}
      </div>

      <div className="month-nav flat">
        <button aria-label={mode === 'day' ? t.prevDay : t.prevMonth} onClick={() => shift(-1)}>
          ‹
        </button>
        <span>{mode === 'day' ? dayTitle : monthTitle}</span>
        <button aria-label={mode === 'day' ? t.nextDay : t.nextMonth} onClick={() => shift(1)}>
          ›
        </button>
      </div>
      {/* Место под «К сегодня» есть всегда: появилась ссылка — список не съезжает. */}
      {mode === 'day' && (
        <button className="link-btn today-link" style={selected === today ? { visibility: 'hidden' } : undefined} aria-hidden={selected === today} tabIndex={selected === today ? -1 : 0} onClick={() => setSelected(today)}>
          {t.backToToday}
        </button>
      )}

      {mode === 'month' && (
      <div className={`cal-grid ${mode}`} role="grid" aria-label={monthTitle}>
        {t.weekdaysShort.map((w) => (
          <span key={w} className="cal-wd" aria-hidden>
            {w}
          </span>
        ))}
        {days.map((day) => {
          const list = ofDay(day);
          const groupOpen = groupDays.filter((b) => b.day === day).flatMap((b) => b.items).filter((it) => !it.done && it.mode !== 'event');
          const open = [...list.filter((d) => !d.done), ...groupOpen.map((it) => ({ id: -it.id, day, source: null }))];
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
      )}

      {actions.error && (
        <p className="error" onClick={actions.clearError}>
          {actions.error}
        </p>
      )}

      {todos !== null && (
        <TodoList
          todos={dayTodos}
          today={today}
          heading={mode === 'day' ? undefined : dayTitle}
          addLabel={t.calAdd}
          showCarry={false}
          canAdd={selected >= today}
          onToggle={(d) => void actions.toggle(d)}
          onAdd={(title) => void actions.add(title, selected)}
          onUpdate={actions.update}
          onRemove={actions.remove}
          onHide={actions.hide}
        />
      )}

      {/* Дела групп в этот день: отметить можно сегодня и в прошлые дни, будущие — только посмотреть. */}
      {groupDays
        .filter((b) => b.day === selected)
        .map((b) => (
          <section key={b.group.id} className="group-block">
            <button className="group-block-head" onClick={() => onOpenGroup(b.group.id)}>
              <b>{b.group.title}</b>
              <AvatarStack members={b.group.members} size={22} />
              <span className="spacer" />
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <ul className="card todo-list">
              {b.items.map((it) => (
                <GroupItemRow
                  key={it.id}
                  item={selected > today ? { ...it, can_mark: false } : it}
                  members={b.group.members}
                  me={me}
                  onToggle={async () => {
                    await api.markItem(b.group.id, it.id, !it.done, selected).catch(() => null);
                    await load();
                    onChanged();
                  }}
                  onOpen={() => onOpenGroup(b.group.id)}
                  swipe={{
                    groupId: b.group.id,
                    day: selected,
                    after: async () => {
                      caches.groups.delete(b.group.id);
                      await load();
                      onChanged();
                    },
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}
