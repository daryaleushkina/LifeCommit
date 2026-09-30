import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { hapticFeedback } from '@tma.js/sdk-react';
import type { HeatDay, TodayResponse, TodayTask } from '../../shared/types';
import { api } from '../api';
import { Heatmap } from '../components/Heatmap';
import { isDone, TaskCard, taskScore, type LogChange } from '../components/TaskCard';
import { LangContext, useT } from '../i18n';

interface Props {
  onEdit: (id: number | null) => void;
  onProfile: () => void;
  onArchive: () => void;
}

export function Today({ onEdit, onProfile, onArchive }: Props): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const [data, setData] = useState<TodayResponse | null>(null);
  const [heat, setHeat] = useState<HeatDay[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Ответы могут прийти не по порядку (быстрые нажатия) — берём только самый свежий запрос.
  const heatSeq = useRef(0);
  const refreshHeat = useCallback(() => {
    const seq = ++heatSeq.current;
    api.heatmap(35 * 7).then((h) => seq === heatSeq.current && setHeat(h.days), () => {});
  }, []);

  useEffect(() => {
    api.today().then(setData, () => setError(t.error));
    refreshHeat();
  }, [refreshHeat, t.error]);

  if (!data) return <div className="skeleton" />;

  const patchTask = (id: number, patch: Partial<TodayTask>) =>
    setData((d) => d && { ...d, tasks: d.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  const log = async (task: TodayTask, change: LogChange) => {
    const cleared = task.kind === 'abstain' ? !change.status : change.value === null;
    const next: Partial<TodayTask> = {
      value: change.value ?? (change.status === 'clean' ? 1 : 0),
      status: change.status ?? null,
      logged: !cleared,
    };
    const wasDone = isDone(task);
    patchTask(task.id, next);
    if (!wasDone && isDone({ ...task, ...next })) hapticFeedback.notificationOccurred.ifAvailable('success');
    try {
      await api.log(task.id, change.value, change.status);
      refreshHeat();
    } catch {
      patchTask(task.id, task); // откат
      setError(t.error);
    }
  };

  // Несделанные сверху, сделанные тихо опускаются вниз.
  const due = data.tasks.filter((x) => x.due);
  const ordered = [...due.filter((x) => !isDone(x)), ...due.filter(isDone)];
  const firstOpen = ordered.find((x) => !isDone(x))?.id;
  const canAdd = data.limits.max_tasks === null || data.limits.active < data.limits.max_tasks;
  // Сегодняшняя клетка зеленеет сразу, не дожидаясь сервера.
  const heatNow = [...heat.filter((d) => d.day !== data.day), { day: data.day, score: data.tasks.reduce((sum, x) => sum + taskScore(x), 0) }];
  const dateLabel = new Date(`${data.day}T12:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <header className="page-head">
        <h1>{t.today}</h1>
        <p>{dateLabel}</p>
      </header>

      <button className="heat-strip" onClick={onProfile} aria-label={t.me}>
        <Heatmap days={heatNow} today={data.day} weeks={35} cell={8} gap={2} />
      </button>

      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {ordered.length === 0 ? (
        <p className="empty">{t.nothingDue}</p>
      ) : (
        <section className="tasks">
          {ordered.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              primary={task.id === firstOpen}
              onLog={(c) => void log(task, c)}
              onEdit={() => onEdit(task.id)}
            />
          ))}
        </section>
      )}

      {/* Не на сегодня — без кнопки, но открыть и поправить можно. */}
      {data.tasks.some((x) => !x.due) && (
        <section className="tasks">
          {data.tasks
            .filter((x) => !x.due)
            .map((task) => (
              <article key={task.id} className="task done">
                <button className="task-main" onClick={() => onEdit(task.id)}>
                  <h2>
                    {task.emoji ? `${task.emoji} ` : ''}
                    {task.title}
                  </h2>
                  <span className="task-value">
                    {task.schedule === 'per_week' ? t.perWeek(task.per_week ?? 0) : t.schedules[task.schedule]}
                  </span>
                </button>
              </article>
            ))}
        </section>
      )}

      {canAdd ? (
        <button className="link-btn" onClick={() => onEdit(null)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t.addTask}
        </button>
      ) : (
        <p className="note">{t.limitReached(data.limits.max_tasks ?? 0)}</p>
      )}

      {data.archived.length > 0 && (
        <button className="link-btn" onClick={onArchive}>
          {t.archivedLink(data.archived.length)}
        </button>
      )}
    </>
  );
}
