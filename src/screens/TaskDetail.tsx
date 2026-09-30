import { useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { cleanRuns, lastDays, targetOn, type TaskHistory } from '../../shared/stats';
import type { TodayTask } from '../../shared/types';
import { api } from '../api';
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
  const [history, setHistory] = useState<TaskHistory | null>(null);
  const [month, setMonth] = useState(monthOf(today));

  useBackButton(onClose);

  useEffect(() => {
    api.history(task.id).then(setHistory, () => {});
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
    // Считаем с дня после «последнего раза», а если его не указывали — с первого дня привычки.
    sub = t.since(date(task.last_slip_on ? addDays(task.last_slip_on, 1) : start));
    const runs = cleanRuns(logs, start, task.last_slip_on, today);
    stats = [
      [runs.current, t.statRunNow],
      [runs.longest, t.statRunBest],
      [inMonth.filter((l) => l.status === 'slip').length, t.statSlipsIn(monthName)],
    ];
    cellClass = (day) => {
      const s = byDay.get(day)?.status;
      return s === 'clean' ? 'clean' : s === 'slip' ? 'slip' : 'off';
    };
  }

  return (
    <main className="app-shell">
      <header className="detail-head">
        <KindTile kind={task.kind} size="lg" />
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
          <b>{cleanDaysOf(task)}</b>
          <span>{t.cleanDaysWord(cleanDaysOf(task))}</span>
        </section>
      )}

      <section className="card pad stat-grid" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
        {stats.map(([value, label], i) => (
          <div key={label} className={i === 0 ? `first k-${task.kind}` : undefined}>
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="card pad">
        <div className="month-nav flat">
          <button aria-label={t.prevMonth} disabled={month <= monthOf(start)} onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <span>{monthLabel}</span>
          <button aria-label={t.nextMonth} disabled={month >= monthOf(today)} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </div>
        <div className="hcal" aria-hidden>
          {t.weekdaysShort.map((d) => (
            <span key={d}>{d}</span>
          ))}
          {Array.from({ length: cells.lead }, (_, i) => (
            <i key={`b${i}`} className="blank" />
          ))}
          {cells.days.map((day, i) => (
            <i key={day} className={`${cellClass(day)}${day === today ? ' today' : ''}`}>
              {i + 1}
            </i>
          ))}
        </div>
      </section>

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
