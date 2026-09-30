import { useContext, useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { api } from '../api';
import { Heatmap } from '../components/Heatmap';
import { isDone, TaskCard, taskScore } from '../components/TaskCard';
import { LangContext, useT } from '../i18n';
import { currentChange, useTaskLog, type Cache } from '../useTaskLog';

interface Props {
  cache: Cache;
  setCache: Dispatch<SetStateAction<Cache>>;
  onEdit: (id: number | null) => void;
  onProfile: () => void;
  onArchive: () => void;
}

export function Today({ cache, setCache, onEdit, onProfile, onArchive }: Props): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const data = cache.today;
  const { log, error, clearError } = useTaskLog(setCache, t.error);

  // Тихое обновление в фоне: после редактора или если день сменился.
  // Если за время запроса что-то отметили, ответ уже устарел — он затёр бы свежую отметку.
  useEffect(() => {
    const seq = currentChange();
    api.today().then((today) => seq === currentChange() && setCache((c) => ({ ...c, today })), () => {});
  }, [setCache]);

  // Несделанные сверху, сделанные тихо опускаются вниз.
  const due = data.tasks.filter((x) => x.due);
  const notDue = data.tasks.filter((x) => !x.due);
  const ordered = [...due.filter((x) => !isDone(x)), ...due.filter(isDone)];
  const canAdd = data.limits.max_tasks === null || data.limits.active < data.limits.max_tasks;
  // Сегодняшняя клетка зеленеет сразу, не дожидаясь сервера.
  const heatNow = [...cache.heat.filter((d) => d.day !== data.day), { day: data.day, score: data.tasks.reduce((sum, x) => sum + taskScore(x), 0) }];
  const dateLabel = new Date(`${data.day}T12:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <>
      <header className="page-head">
        <h1>{t.today}</h1>
        <p>{dateLabel}</p>
      </header>

      <button className="heat-strip" onClick={onProfile} aria-label={t.me}>
        <Heatmap days={heatNow} today={data.day} weeks={22} gap={3} />
      </button>

      {error && (
        <p className="error" onClick={clearError}>
          {error}
        </p>
      )}

      {ordered.length === 0 ? (
        <p className="empty">{t.nothingDue}</p>
      ) : (
        <section className="tasks">
          {ordered.map((task) => (
            <TaskCard key={task.id} task={task} onLog={(c) => void log(task, c)} onOpen={() => onEdit(task.id)} />
          ))}
        </section>
      )}

      {/* Не на сегодня — без кнопки, но открыть и поправить можно. */}
      {notDue.length > 0 && (
        <section className="tasks">
          {notDue.map((task) => (
            <article key={task.id} className="task done">
              <button className="task-main" onClick={() => onEdit(task.id)}>
                <h2>{task.title}</h2>
                <span className="task-value">{task.schedule === 'per_week' ? t.perWeek(task.per_week ?? 0) : t.schedules[task.schedule]}</span>
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
