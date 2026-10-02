import { useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { cleanRuns, lastDays, targetOn, type TaskHistory } from '../../shared/stats';
import type { TodayTask } from '../../shared/types';
import { api } from '../api';
import { caches, load as fetchInto } from '../caches';
import { Sheet } from '../components/Picker';
import { addDays, monthCells, monthOf, shiftMonth } from '../components/Heatmap';
import { KindTile } from '../components/KindIcon';
import { cleanDaysOf, DoneButton, Progress, QuitButtons, RoundBtn, useCountValue, type LogChange } from '../components/TaskCard';
import { LangContext, useT } from '../i18n';
import { repeatLabel } from '../repeat';
import { useBackButton } from '../telegram/hooks';
import { useTaskLog, type Cache } from '../useTaskLog';

interface Props {
  task: TodayTask;
  /** Сегодняшний логический день. */
  today: string;
  setCache: Dispatch<SetStateAction<Cache>>;
  onEdit: () => void;
  onClose: () => void;
}

/** Экран привычки: отметка за сегодня, ключевые числа и календарь месяца. */
export function TaskDetail({ task, today, setCache, onEdit, onClose }: Props): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const { log, error, clearError } = useTaskLog(setCache, t.error);
  const onLog = (change: LogChange) => void log(task, change);
  // История подтянута в фоне после запуска — числа и календарь сразу настоящие.
  const [history, setHistory] = useState<TaskHistory | null>(caches.history.get(task.id) ?? null);
  const [month, setMonth] = useState(monthOf(today));
  // День, который отмечают задним числом («вспомнила, что месяц назад было»).
  const [marking, setMarking] = useState<string | null>(null);

  useBackButton(onClose);

  useEffect(() => {
    fetchInto.history(task.id).then(setHistory, () => {});
  }, [task.id]);

  // Сегодняшняя отметка уже на экране — подставляем её в историю, не дожидаясь сервера.
  const logs = [
    ...(history?.logs ?? []).filter((l) => l.day !== today),
    ...(task.logged ? [{ day: today, value: task.kind === 'abstain' ? (task.status === 'clean' ? 1 : 0) : task.value, status: task.status }] : []),
  ];
  const goals = history?.goals ?? [{ effective_from: today, target: task.target }];
  const start = history?.start ?? today;
  const byDay = new Map(logs.map((l) => [l.day, l]));
  const inMonth = logs.filter((l) => l.day.startsWith(month));
  const monthName = new Date(`${month}-15T12:00:00`).toLocaleDateString(locale, { month: 'long' });
  const monthLabel = `${monthName} ${month.slice(0, 4)}`;
  const date = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const cells = monthCells(month);
  // Дни месяца, когда привычка уже существовала и которые уже наступили.
  const lived = cells.days.filter((d) => d >= start && d <= today);
  // Листать назад можно всегда на год (и дальше — до «последнего раза» у отказа): там тоже можно отметить.
  const oldest = [monthOf(start), shiftMonth(monthOf(today), -11), ...(task.kind === 'abstain' && task.last_slip_on ? [monthOf(task.last_slip_on)] : [])].sort()[0]!;
  // Отмечать задним числом — да/нет у галочки и отказа; у счётчика нужно число, его отмечают только сегодня.
  const markable = task.kind !== 'count';

  /** Отметка за прошлый день: на экране сразу, потом свежие «Сегодня» (числа) и карта. */
  const markDay = async (day: string, yes: boolean | null) => {
    setMarking(null);
    if (day === today) {
      onLog(task.kind === 'abstain' ? { value: null, status: yes === null ? null : yes ? 'clean' : 'slip' } : { value: yes ? task.target : null });
      return;
    }
    const status: 'clean' | 'slip' | null = task.kind === 'abstain' && yes !== null ? (yes ? 'clean' : 'slip') : null;
    const value = yes === null ? null : task.kind === 'abstain' ? (yes ? 1 : 0) : yes ? task.target : null;
    // До приложения после «последнего раза» день и так чистый — «получилось» там просто убирает отметку.
    const implicit = task.kind === 'abstain' && task.last_slip_on && day > task.last_slip_on && day < start;
    const keep = yes !== null && !(implicit && yes) && (task.kind === 'abstain' || yes);
    setHistory((h) => {
      const base = h ?? { start, goals, logs: [] };
      const rest = base.logs.filter((l) => l.day !== day);
      const next = { ...base, logs: keep ? [...rest, { day, value: value ?? 0, status }].sort((a, b) => a.day.localeCompare(b.day)) : rest };
      caches.history.set(task.id, next);
      return next;
    });
    try {
      await api.log(task.id, task.kind === 'abstain' ? null : value, status, day);
    } catch {
      setHistory(await fetchInto.history(task.id).catch(() => history));
      return;
    }
    const [fresh, heat] = await Promise.all([api.today().catch(() => null), api.heatmap(371).catch(() => null)]);
    setCache((c) => ({ ...c, ...(fresh && { today: fresh, loadedAt: Date.now() }), ...(heat && { heat: heat.days }) }));
  };

  let sub: string;
  let stats: [string | number, string][];
  let cellClass: (day: string) => string;

  if (task.kind === 'check') {
    sub = repeatLabel(t, task.schedule, task.weekdays, task.per_week);
    const done = inMonth.filter((l) => l.value >= 1).length;
    const planned = lived.filter((d) => (task.weekdays & (1 << ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))) !== 0);
    const total = logs.filter((l) => l.value >= 1).length;
    stats = [
      // «N раз в неделю» не привязано к дням — плана по дням нет, показываем просто счёт.
      task.schedule === 'per_week' ? [done, t.statTimesIn(monthName)] : [t.statOf(done, planned.length), t.statPlanIn(monthName)],
      [total, t.statTimesAll],
    ];
    const plan = new Set(task.schedule === 'per_week' ? [] : planned);
    cellClass = (day) => ((byDay.get(day)?.value ?? 0) >= 1 ? 'full' : plan.has(day) ? 'plan' : 'off');
  } else if (task.kind === 'count') {
    sub = t.goalLine(task.target, task.unit);
    const sum = inMonth.reduce((s, l) => s + l.value, 0);
    stats = [
      [Math.round(sum / Math.max(1, lived.length)), t.statAvg(task.unit)],
      [Math.max(0, ...inMonth.map((l) => l.value)), t.statBest],
      [sum, t.statSumIn(monthName)],
    ];
    cellClass = (day) => {
      const v = byDay.get(day)?.value ?? 0;
      if (v <= 0) return 'off';
      const share = v / targetOn(goals, day);
      return share >= 1 ? 'full' : share >= 0.5 ? 'half' : 'some';
    };
  } else {
    const slip = task.last_slip_on;
    // Считаем с дня после «последнего раза», а если его не указывали — с первого дня привычки.
    sub = t.since(date(task.last_slip_on ? addDays(task.last_slip_on, 1) : start));
    const runs = cleanRuns(logs, start, task.last_slip_on, today);
    stats = [
      [runs.current, t.statRunNow],
      [runs.longest, t.statRunBest],
      [inMonth.filter((l) => l.status === 'slip').length + (slip?.startsWith(month) && !byDay.has(slip) ? 1 : 0), t.statSlipsIn(monthName)],
    ];
    // Дни до приложения тоже настоящие: после «последнего раза» и до первого дня привычки — чистые,
    // сам «последний раз» — красный (решение владелицы 02.10.2026: «я 148 дней без этого, а зелёных три»).
    cellClass = (day) => {
      const s = byDay.get(day)?.status;
      if (s) return s === 'clean' ? 'clean' : 'slip';
      if (day === slip) return 'slip';
      return slip && day > slip && day < start ? 'clean' : 'off';
    };
  }

  return (
    <main className="app-shell">
      <header className="detail-head">
        <KindTile kind={task.kind} title={task.title} size="lg" />
        <div>
          <h1>{task.title}</h1>
          <p>{sub}</p>
        </div>
        <button className="icon-btn" aria-label={t.editTask} onClick={onEdit}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
            <path d="M13.5 6.5l3 3" />
          </svg>
        </button>
      </header>

      {error && (
        <p className="error" onClick={clearError}>
          {error}
        </p>
      )}

      <TodayBlock task={task} onLog={onLog} />

      {task.kind === 'abstain' && (
        <section className="card pad hero">
          <b>{t.num(cleanDaysOf(task))}</b>
          <span>{t.cleanDaysWord(cleanDaysOf(task))}</span>
        </section>
      )}

      <section className="card pad stat-grid" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
        {stats.map(([value, label], i) => (
          <div key={label} className={i === 0 ? `first k-${task.kind}` : undefined}>
            <b>{typeof value === 'number' ? t.num(value) : value}</b>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="card pad">
        <div className="month-nav flat">
          <button aria-label={t.prevMonth} disabled={month <= oldest} onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <span>{monthLabel}</span>
          <button aria-label={t.nextMonth} disabled={month >= monthOf(today)} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </div>
        <div className="hcal">
          {t.weekdaysShort.map((d) => (
            <span key={d} aria-hidden>
              {d}
            </span>
          ))}
          {Array.from({ length: cells.lead }, (_, i) => (
            <i key={`b${i}`} className="blank" />
          ))}
          {/* Прошедший день можно нажать и отметить задним числом. */}
          {cells.days.map((day, i) =>
            markable && day <= today ? (
              <button key={day} className={`hcal-day ${cellClass(day)}${day === today ? ' today' : ''}`} aria-label={date(day)} onClick={() => setMarking(day)}>
                {i + 1}
              </button>
            ) : (
              <i key={day} className={`${cellClass(day)}${day === today ? ' today' : ''}`} aria-hidden>
                {i + 1}
              </i>
            ),
          )}
        </div>
      </section>

      {marking && (
        <Sheet title={new Date(`${marking}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} onClose={() => setMarking(null)}>
          <p className="sheet-note first">{task.title}</p>
          <div className="mark-choice">
            <button className="act primary" onClick={() => void markDay(marking, true)}>
              {task.kind === 'abstain' ? t.markClean : t.markDone}
            </button>
            <button className="act soft-bad" onClick={() => void markDay(marking, false)}>
              {task.kind === 'abstain' ? t.markSlip : t.markNotDone}
            </button>
          </div>
          {byDay.has(marking) && !(task.kind === 'abstain' && marking < start) && (
            <button className="quiet-link" onClick={() => void markDay(marking, null)}>
              {t.markClear}
            </button>
          )}
        </Sheet>
      )}

      {task.kind === 'count' && <TwoWeeks days={lastDays(logs, today, 14)} goal={task.target} title={t.twoWeeks} goalWord={t.goalShort} />}
    </main>
  );
}

/** Блок «сегодня»: отметить привычку можно прямо с её экрана. */
function TodayBlock({ task, onLog }: { task: TodayTask; onLog: (change: LogChange) => void }): ReactNode {
  const t = useT();
  const count = useCountValue(task, onLog);
  if (task.kind === 'abstain') {
    return (
      <section className="card today-block">
        <b>{t.didIt}</b>
        <QuitButtons task={task} onLog={onLog} />
      </section>
    );
  }
  if (task.kind === 'check') {
    return (
      <section className="card today-block">
        <b>{t.today}</b>
        <DoneButton task={task} onLog={onLog} />
      </section>
    );
  }
  return (
    <section className="card today-block wrap">
      <div className="text">
        <b>{t.today}</b>
        {count.value}
      </div>
      <div className="rb-pair">
        <RoundBtn kind="edit" label={`${task.title}: ${t.enterValue}`} onClick={count.edit} />
        <DoneButton task={task} onLog={onLog} />
      </div>
      <Progress task={task} />
    </section>
  );
}

/** Столбики за две недели с линией цели: тёмные — цель достигнута. */
function TwoWeeks({ days, goal, title, goalWord }: { days: { day: string; value: number }[]; goal: number; title: string; goalWord: string }): ReactNode {
  const max = Math.max(goal, ...days.map((d) => d.value)) * 1.08;
  return (
    <section className="card pad">
      <h2 className="card-title">{title}</h2>
      <div className="bars k-count" aria-hidden>
        {days.map((d) => (
          <i key={d.day} className={d.value >= goal ? 'hit' : ''} style={{ height: `${Math.max(3, (d.value / max) * 100)}%` }} />
        ))}
        <span className="goal" style={{ bottom: `${(goal / max) * 100}%` }}>
          <em>
            {goalWord} {goal}
          </em>
        </span>
      </div>
      <div className="bars-axis" aria-hidden>
        <span>{Number(days[0]?.day.slice(8))}</span>
        <span>{Number(days[days.length - 1]?.day.slice(8))}</span>
      </div>
    </section>
  );
}
