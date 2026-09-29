import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { hapticFeedback } from '@tma.js/sdk-react';
import type { DayMode, HeatDay, TodayResponse, TodayTask } from '../../shared/types';
import { api } from '../api';
import { Heatmap } from '../components/Heatmap';
import { isDone, TaskCard, type LogChange } from '../components/TaskCard';
import { useT } from '../i18n';

export function Today({ onEdit }: { onEdit: (id: number | null) => void }): ReactNode {
  const t = useT();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [heat, setHeat] = useState<HeatDay[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshHeat = useCallback(() => {
    api.heatmap(17 * 7).then((h) => setHeat(h.days), () => {});
  }, []);

  useEffect(() => {
    api.today().then(setData, () => setError(t.error));
    refreshHeat();
  }, [refreshHeat, t.error]);

  if (!data) return <div className="skeleton" />;

  const patchTask = (id: number, patch: Partial<TodayTask>) =>
    setData((d) => d && { ...d, tasks: d.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  const log = async (task: TodayTask, change: LogChange) => {
    const cleared = change.value === null && !change.status;
    const next: Partial<TodayTask> = {
      value: change.value ?? (change.status === 'clean' ? 1 : 0),
      status: change.status ?? null,
      logged: !cleared,
    };
    const wasDone = isDone(task, data.mode);
    patchTask(task.id, next);
    if (!wasDone && isDone({ ...task, ...next }, data.mode)) hapticFeedback.notificationOccurred.ifAvailable('success');
    try {
      await api.log(task.id, change.value, change.status);
      refreshHeat();
    } catch {
      patchTask(task.id, task); // откат
      setError(t.error);
    }
  };

  const setMode = async (mode: DayMode) => {
    const prev = data.mode;
    setData({ ...data, mode });
    try {
      await api.setDay(mode);
      refreshHeat();
    } catch {
      setData({ ...data, mode: prev });
      setError(t.error);
    }
  };

  const due = data.tasks.filter((x) => x.due);
  const notDue = data.tasks.filter((x) => !x.due);
  const canAdd = data.limits.max_tasks === null || data.limits.active < data.limits.max_tasks;
  const dateLabel = new Date(`${data.day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <>
      <header className="page-head row">
        <div>
          <h1>{t.today}</h1>
          <p className="muted cap">{dateLabel}</p>
        </div>
      </header>

      <Heatmap days={heat} today={data.day} weeks={17} />

      {data.mode === 'pause' ? (
        <div className="banner">
          <p>{t.pausedDay}</p>
          <button className="chip" onClick={() => void setMode(null)}>
            {t.resume}
          </button>
        </div>
      ) : (
        <div className="mode-row">
          <button
            className={`chip${data.mode === 'minimum' ? ' on' : ''}`}
            aria-pressed={data.mode === 'minimum'}
            onClick={() => void setMode(data.mode === 'minimum' ? null : 'minimum')}
          >
            🌧 {t.badDay}
          </button>
          {data.mode === 'minimum' && <span className="muted small">{t.badDayOn}</span>}
        </div>
      )}

      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <section className="tasks">
        {due.length === 0 && <p className="muted center-text">{t.nothingDue}</p>}
        {due.map((task) => (
          <TaskCard key={task.id} task={task} mode={data.mode} onLog={(c) => void log(task, c)} onEdit={() => onEdit(task.id)} />
        ))}
      </section>

      {notDue.length > 0 && (
        <section className="tasks later">
          <h2 className="section-title">{t.notToday}</h2>
          {notDue.map((task) => (
            <button key={task.id} className="task-mini" onClick={() => onEdit(task.id)}>
              <span aria-hidden>{task.emoji ?? '•'}</span> {task.title}
            </button>
          ))}
        </section>
      )}

      <div className="add-row">
        {canAdd ? (
          <button className="btn ghost" onClick={() => onEdit(null)}>
            + {t.addTask}
          </button>
        ) : (
          <p className="muted small center-text">{t.limitReached(data.limits.max_tasks ?? 0)}</p>
        )}
      </div>
    </>
  );
}

