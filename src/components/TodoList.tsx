import { useContext, useEffect, useState, type ReactNode } from 'react';
import type { Todo } from '../../shared/types';
import { api } from '../api';
import { LangContext, useT } from '../i18n';
import type { TodoEdit } from '../useTodos';
import { todoWhen } from '../todoDates';
import { Sheet } from './Picker';
import { TodoSheet } from './TodoSheet';

interface Props {
  todos: Todo[];
  /** Сколько дел запланировано на потом; нет — ссылки «Потом» нет (во вкладке «Календарь»). */
  later?: number;
  today: string;
  /** Заголовок блока; во вкладке «Календарь» — выбранный день. */
  heading?: string;
  /** Подпись строки добавления. */
  addLabel?: string;
  /** Подписи «со вчера» — только на «Сегодня»: в календаре дело и так стоит в свой день. */
  showCarry?: boolean;
  /** Можно ли добавлять: в прошедший день календаря — нельзя. */
  canAdd?: boolean;
  onToggle: (todo: Todo) => void;
  onAdd: (title: string) => void;
  onUpdate: (todo: Todo, edit: TodoEdit) => Promise<void>;
  onRemove: (todo: Todo) => Promise<void>;
}

/** Метка «откуда пришло»: G — Google, A — Apple. */
export const SourceMark = ({ source }: { source: Todo['source'] }) =>
  source ? (
    <span className={`src-mark ${source}`} aria-label={source === 'apple' ? 'Apple' : 'Google'}>
      {source === 'apple' ? 'A' : 'G'}
    </span>
  ) : null;

export const Check = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/** Время конца события: «10:00» + 60 минут → «11:00» (в пределах суток). */
function endTime(start: string, minutes: number): string | null {
  const [h = 0, m = 0] = start.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return total < 24 * 60 ? `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` : null;
}

/** Блок «Дела» на «Сегодня»: разовые дела с кружком-галочкой, строка для нового дела, «Потом · N». */
export function TodoList({ todos, later = 0, today, heading, addLabel, showCarry = true, canAdd = true, onToggle, onAdd, onUpdate, onRemove }: Props): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Todo | null>(null);
  const [laterOpen, setLaterOpen] = useState(false);

  const submit = () => {
    const title = draft.trim();
    if (title) onAdd(title);
    setDraft('');
  };

  return (
    <>
      <h2 className="section-label">{heading ?? t.todo.block}</h2>
      <ul className="card todo-list">
        {todos.map((d) => {
          const when = showCarry && !d.recurring ? todoWhen(t, d.day, today, locale) : null;
          const end = d.time && d.duration_min ? endTime(d.time, d.duration_min) : null;
          const note = [when, end && t.todo.until(end)].filter(Boolean).join(' · ');
          return (
            <li key={`${d.id}:${d.day}`} className={d.done ? 'done' : undefined}>
              <button className="todo-check" aria-pressed={d.done} aria-label={d.done ? t.todo.uncheck(d.title) : t.todo.check(d.title)} onClick={() => onToggle(d)}>
                <Check />
              </button>
              <button className="todo-main" onClick={() => setEditing(d)}>
                {d.time && <time className="todo-time">{d.time}</time>}
                <span className="todo-text">
                  <span>{d.title}</span>
                  {note && !d.done && <small>{note}</small>}
                </span>
                <SourceMark source={d.source} />
              </button>
            </li>
          );
        })}
        {!canAdd && todos.length === 0 && <li className="todo-empty">{t.calEmpty}</li>}
        {canAdd && (
        <li className="todo-add">
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(); // поле остаётся открытым: следующее дело можно вписать сразу
              }}
            >
              <input
                autoFocus
                value={draft}
                maxLength={120}
                enterKeyHint="done"
                placeholder={t.todo.addPh}
                aria-label={t.todo.add}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  submit();
                  setAdding(false);
                }}
              />
            </form>
          ) : (
            <button onClick={() => setAdding(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              {addLabel ?? t.todo.add}
            </button>
          )}
        </li>
        )}
      </ul>
      {later > 0 && (
        <button className="link-btn" onClick={() => setLaterOpen(true)}>
          {t.todo.later(later)}
        </button>
      )}

      {editing && (
        <TodoSheet
          title={editing.title}
          day={editing.day}
          time={editing.time}
          recurring={editing.recurring}
          source={editing.source}
          today={today}
          onSave={(edit) => void onUpdate(editing, edit)}
          onDelete={() => void onRemove(editing)}
          onClose={() => setEditing(null)}
        />
      )}
      {laterOpen && <LaterSheet today={today} onUpdate={onUpdate} onRemove={onRemove} onClose={() => setLaterOpen(false)} />}
    </>
  );
}

/** Запланированные на потом, по дням. Список открывают редко — грузим его, только когда открыли. */
function LaterSheet({ today, onUpdate, onRemove, onClose }: { today: string; onUpdate: Props['onUpdate']; onRemove: Props['onRemove']; onClose: () => void }): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const [list, setList] = useState<Todo[] | null>(null);
  const [editing, setEditing] = useState<Todo | null>(null);
  const load = () => api.laterTodos().then(setList, () => setList([]));
  useEffect(() => {
    void load();
  }, []);

  const groups = new Map<string, Todo[]>();
  for (const d of list ?? []) groups.set(d.day, [...(groups.get(d.day) ?? []), d]);

  return (
    <>
      <Sheet title={t.todo.laterTitle} onClose={onClose}>
        {[...groups].map(([day, items]) => (
          <section key={day} className="later-day">
            <h3>{todoWhen(t, day, today, locale)}</h3>
            <ul className="card todo-list flat">
              {items.map((d) => (
                <li key={d.id}>
                  <button className="todo-main" onClick={() => setEditing(d)}>
                    {d.time && <time className="todo-time">{d.time}</time>}
                    <span className="todo-text">
                      <span>{d.title}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Sheet>
      {editing && (
        <TodoSheet
          title={editing.title}
          day={editing.day}
          time={editing.time}
          today={today}
          onSave={(edit) => void onUpdate(editing, edit).then(load)}
          onDelete={() => void onRemove(editing).then(load)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
