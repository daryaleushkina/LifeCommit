import { useContext, useEffect, useState, type ReactNode } from 'react';
import type { Todo } from '../../shared/types';
import { caches, load as fetchInto } from '../caches';
import { LangContext, useT } from '../i18n';
import type { TodoEdit } from '../useTodos';
import { todoWhen } from '../todoDates';
import { removeWithUndo, useRemoved } from '../removal';
import { Sheet } from './Picker';
import { SwipeRow, type SwipeAction } from './SwipeRow';
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
  /** Скрыть событие из календаря у нас (в самом календаре оно остаётся). */
  onHide?: (todo: Todo) => Promise<void>;
  /** Переключатель «Все · Осталось» в шапке — только на «Сегодня». */
  filterable?: boolean;
}

const LEFT_KEY = 'lc-todos-left';

/** «Только несделанные» — запоминается на этом устройстве (решение владелицы 02.10.2026), как тема. */
function useOnlyLeft(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(LEFT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.setItem(LEFT_KEY, '1');
      else localStorage.removeItem(LEFT_KEY);
    } catch {
      // нет хранилища — запомним до закрытия
    }
  };
  return [on, set];
}

/** Что под свайпом: своё дело — «Удалить»; событие из календаря — «Удалить» (и в календаре) и «Скрыть» (крайняя, она же — до конца). */
export function useTodoSwipe(onRemove: Props['onRemove'], onHide?: Props['onHide']) {
  const t = useT();
  const isRemoved = useRemoved();
  const actions = (d: Todo): SwipeAction[] => {
    const remove: SwipeAction = { label: t.swipe.remove, tone: 'danger', icon: 'trash', run: () => removeWithUndo(`todo:${d.id}`, t.swipe.removed(d.title), () => onRemove(d)) };
    if (!d.source || !onHide) return [remove];
    return [remove, { label: t.swipe.hide, tone: 'muted', icon: 'hide', run: () => removeWithUndo(`todo:${d.id}`, t.swipe.hidden(d.title), () => onHide(d)) }];
  };
  return { actions, visible: (d: Todo) => !isRemoved(`todo:${d.id}`) };
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
export function endTime(start: string, minutes: number): string | null {
  const [h = 0, m = 0] = start.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return total < 24 * 60 ? `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` : null;
}

/** Блок «Дела» на «Сегодня»: свои дела с кружком-галочкой, события из календаря без него, строка для нового дела, «Потом · N». */
export function TodoList({ todos: all, later = 0, today, heading, addLabel, showCarry = true, canAdd = true, onToggle, onAdd, onUpdate, onRemove, onHide, filterable = false }: Props): ReactNode {
  const t = useT();
  const swipe = useTodoSwipe(onRemove, onHide);
  const listed = all.filter(swipe.visible);
  const [onlyLeft, setOnlyLeft] = useOnlyLeft();
  // Прятать есть что, только когда есть свои дела: у событий из календаря галочки нет.
  const canFilter = filterable && listed.some((d) => !d.source);
  const todos = canFilter && onlyLeft ? listed.filter((d) => !d.done) : listed;
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
      {/* Только события из календаря — «События», вперемешку со своими — «События и дела» (как у Apple: событие — то, что будет). */}
      <div className="section-head">
        <h2 className="section-label">{heading ?? (listed.length && listed.every((d) => d.source) ? t.todo.blockEvents : listed.some((d) => d.source) ? t.todo.blockMixed : t.todo.block)}</h2>
        {/* Круг 22E: «Все · Осталось» — спрятать сделанные дела, если их много. */}
        {canFilter && (
          <div className="seg-mini" role="group" aria-label={t.todo.showWhich}>
            <button aria-pressed={!onlyLeft} className={onlyLeft ? undefined : 'on'} onClick={() => setOnlyLeft(false)}>
              {t.todo.showAll}
            </button>
            <button aria-pressed={onlyLeft} className={onlyLeft ? 'on' : undefined} onClick={() => setOnlyLeft(true)}>
              {t.todo.showLeft}
            </button>
          </div>
        )}
      </div>
      <ul className="card todo-list">
        {todos.map((d) => {
          const when = showCarry && !d.recurring ? todoWhen(t, d.day, today, locale) : null;
          const end = d.time && d.duration_min ? endTime(d.time, d.duration_min) : null;
          const note = [when, end && t.todo.until(end)].filter(Boolean).join(' · ');
          return (
            <SwipeRow key={`${d.id}:${d.day}`} className={d.done ? 'done' : undefined} actions={swipe.actions(d)}>
              {/* Событие из календаря — «что сегодня будет»: отмечать нечего, на карту не влияет. */}
              {d.source ? (
                <span className="todo-event" aria-hidden />
              ) : (
                <button className="todo-check" aria-pressed={d.done} aria-label={d.done ? t.todo.uncheck(d.title) : t.todo.check(d.title)} onClick={() => onToggle(d)}>
                  <Check />
                </button>
              )}
              <button className="todo-main" onClick={() => setEditing(d)}>
                {d.time && <time className="todo-time">{d.time}</time>}
                <span className="todo-text">
                  <span>{d.title}</span>
                  {note && !d.done && <small>{note}</small>}
                </span>
                <SourceMark source={d.source} />
              </button>
            </SwipeRow>
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
          details={editing.details}
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
  // Список подтянут в фоне, когда на «Сегодня» появилось «Потом», — шторка открывается сразу во весь рост.
  const [list, setList] = useState<Todo[] | null>(caches.later);
  const [editing, setEditing] = useState<Todo | null>(null);
  const load = () => {
    caches.later = null;
    return fetchInto.later().then(setList, () => setList((cur) => cur ?? []));
  };
  useEffect(() => {
    void load();
  }, []);

  const swipe = useTodoSwipe((d) => onRemove(d).then(load));
  const groups = new Map<string, Todo[]>();
  for (const d of (list ?? []).filter(swipe.visible)) groups.set(d.day, [...(groups.get(d.day) ?? []), d]);

  return (
    <>
      <Sheet title={t.todo.laterTitle} onClose={onClose}>
        {[...groups].map(([day, items]) => (
          <section key={day} className="later-day">
            <h3>{todoWhen(t, day, today, locale)}</h3>
            <ul className="card todo-list flat">
              {items.map((d) => (
                <SwipeRow key={d.id} actions={swipe.actions(d)}>
                  <button className="todo-main" onClick={() => setEditing(d)}>
                    {d.time && <time className="todo-time">{d.time}</time>}
                    <span className="todo-text">
                      <span>{d.title}</span>
                    </span>
                  </button>
                </SwipeRow>
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
          details={editing.details}
          today={today}
          onSave={(edit) => void onUpdate(editing, edit).then(load)}
          onDelete={() => void onRemove(editing).then(load)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
