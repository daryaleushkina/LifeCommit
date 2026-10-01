import { useContext, useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { api } from '../api';
import { isDone, TaskCard } from '../components/TaskCard';
import { GroupBlocks } from '../components/GroupBlocks';
import { TodoList } from '../components/TodoList';
import { LangContext, useT } from '../i18n';
import { currentChange, useTaskLog, type Cache } from '../useTaskLog';
import { useTodos } from '../useTodos';

/** Сколько данные «Сегодня» считаются свежими при возврате на экран. */
const FRESH_MS = 60_000;

interface Props {
  cache: Cache;
  setCache: Dispatch<SetStateAction<Cache>>;
  onEdit: (id: number | null) => void;
  onArchive: () => void;
  /** Мой id — кому групповые дела и чья очередь. */
  me: number;
  onOpenGroup: (id: number) => void;
}

export function Today({ cache, setCache, onEdit, onArchive, me, onOpenGroup }: Props): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const data = cache.today;
  const { log, error, clearError } = useTaskLog(setCache, t.error);
  const todos = useTodos(setCache, t.error);

  // Тихое обновление в фоне, если данные уже не свежие (например, день сменился).
  // Сразу после заставки или редактора они только что пришли — повторный запрос не нужен.
  // Если за время запроса что-то отметили, ответ уже устарел — он затёр бы свежую отметку.
  const loadedAt = cache.loadedAt;
  useEffect(() => {
    if (Date.now() - loadedAt < FRESH_MS) return;
    const seq = currentChange();
    api.today().then((today) => seq === currentChange() && setCache((c) => ({ ...c, today, loadedAt: Date.now() })), () => {});
    // Только при открытии экрана: loadedAt нужен как значение на этот момент.
  }, [setCache]);

  // Несделанные сверху, сделанные тихо опускаются вниз.
  const due = data.tasks.filter((x) => x.due);
  const notDue = data.tasks.filter((x) => !x.due);
  const ordered = [...due.filter((x) => !isDone(x)), ...due.filter(isDone)];
  const canAdd = data.limits.max_tasks === null || data.limits.active < data.limits.max_tasks;
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

      {/* Полосы карты здесь больше нет (01.10.2026): на «Сегодня» она лишняя, карта — во вкладке «Я». */}
      {(error ?? todos.error) && (
        <p
          className="error"
          onClick={() => {
            clearError();
            todos.clearError();
          }}
        >
          {error ?? todos.error}
        </p>
      )}

      {/* Разовые дела — над привычками: их обычно надо сделать сегодня и один раз. */}
      <TodoList
        todos={data.todos}
        later={data.todos_later}
        today={data.day}
        onToggle={(d) => void todos.toggle(d)}
        onAdd={(title) => void todos.add(title, data.day)}
        onUpdate={todos.update}
        onRemove={todos.remove}
      />

      <h2 className="section-label">{t.voiceHabits}</h2>
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

      {/* Группы — под личным: мои дела каждой группы, «кто-то один», мероприятия и общие цели. */}
      <GroupBlocks groups={data.groups ?? []} me={me} setCache={setCache} onOpen={onOpenGroup} />

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
