import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { hapticFeedback } from '@tma.js/sdk-react';
import { sortTodos, type Todo } from '../shared/types';
import { api } from './api';
import { trackEdit } from './caches';
import { bumpChange, type Cache } from './useTaskLog';

/** Тот же раз дела: у повторяющегося дела один id на все дни, различает их день. */
export const sameTodo = (a: Todo, b: Todo): boolean => a.id === b.id && (!a.recurring || a.day === b.day);

/** Подробности с новым местом (пустое — без места). */
function withLocation(details: Todo['details'], location: string): Todo['details'] {
  const { location: _old, ...rest } = details ?? {};
  const next = location.trim() ? { ...rest, location: location.trim() } : rest;
  return Object.keys(next).length ? next : null;
}

/** Что меняют в шторке дела. */
export interface TodoEdit {
  title: string;
  day: string;
  time: string | null;
  /** Место — только у своих дел; '' — убрать. */
  location?: string;
}

interface Options {
  /** Поменять свой список дел (на «Сегодня» — кэш, в «Календаре» — дни на экране). */
  patchList: (fn: (list: Todo[]) => Todo[]) => void;
  /** Перечитать список с сервера: после переноса на другой день или удаления он меняется целиком. */
  reload: () => Promise<void>;
  errorText: string;
  /** Где показать ошибку: общая плашка на «Сегодня», строка во вкладке «Календарь». */
  onError: (text: string) => void;
}

/**
 * Действия с делами: отметить, добавить, поправить, удалить.
 * Экран меняется сразу, сервер догоняет; при ошибке отметка откатывается.
 */
export function useTodoActions({ patchList, reload, errorText, onError }: Options) {
  // Удаление уходит на сервер через 5 секунд «Вернуть» — экрана к тому времени может не быть: тогда только плашка.
  const fail = useCallback(() => onError(errorText), [onError, errorText]);

  const toggle = useCallback(
    async (todo: Todo) => {
      const done = !todo.done;
      patchList((list) => list.map((d) => (sameTodo(d, todo) ? { ...d, done } : d)));
      if (done) hapticFeedback.notificationOccurred.ifAvailable('success');
      try {
        // У повторяющегося дела «сделано» — на этот его день.
        await trackEdit(api.updateTodo(todo.id, { done, ...(todo.recurring && { on: todo.day }) }));
      } catch {
        patchList((list) => list.map((d) => (sameTodo(d, todo) ? todo : d)));
        fail();
      }
    },
    [patchList, fail],
  );

  /** Новое дело: появляется сразу, id приходит с сервера. false — не сохранилось (набранное вернуть в поле). */
  const add = useCallback(
    async (title: string, day: string): Promise<boolean> => {
      const temp: Todo = { id: -Date.now(), title, day, done: false, time: null, duration_min: null, recurring: false, source: null, details: null };
      patchList((list) => [...list, temp]);
      try {
        // trackEdit отмечает изменение до запроса и после ответа: начатые раньше чтения устарели, а перечитка дней
        // дождётся, пока дело создаётся (caches.ts), — иначе ответ без него ляжет поверх строки.
        const { id } = await trackEdit(api.createTodo({ title, day }));
        patchList((list) => list.map((d) => (d.id === temp.id ? { ...d, id } : d)));
        return true;
      } catch {
        patchList((list) => list.filter((d) => d.id !== temp.id));
        fail();
        return false;
      }
    },
    [patchList, fail],
  );

  const update = useCallback(
    async (todo: Todo, edit: TodoEdit) => {
      const patch = {
        ...(edit.title !== todo.title && { title: edit.title }),
        ...(edit.day !== todo.day && !todo.recurring && { day: edit.day }),
        ...(edit.time !== todo.time && { time: edit.time }),
        ...(edit.location !== undefined && edit.location !== (todo.details?.location ?? '') && { location: edit.location }),
      };
      if (!Object.keys(patch).length) return;
      patchList((list) => list.map((d) => (d.id === todo.id ? { ...d, title: edit.title, time: edit.time, ...(edit.location !== undefined && { details: withLocation(d.details, edit.location) }) } : d)));
      try {
        await trackEdit(api.updateTodo(todo.id, patch));
      } catch {
        // Сеть может не дать и перечитать список: откатываем изменённые поля сами, сохраняя дни и отметки.
        patchList((list) => list.map((d) => (d.id === todo.id ? { ...d, title: todo.title, time: todo.time, details: todo.details } : d)));
        fail();
      }
      await reload();
    },
    [patchList, reload, fail],
  );

  const remove = useCallback(
    async (todo: Todo) => {
      // Повторяющееся удаляется целиком — со всеми днями.
      try {
        await trackEdit(api.deleteTodo(todo.id));
        // Пока ждём сервер, строку прячет removeWithUndo. Не стираем её из данных до успеха:
        // при отказе и неудачной перечитке она всё равно вернётся, со всеми повторяющимися днями.
        patchList((list) => list.filter((d) => d.id !== todo.id));
      } catch {
        fail();
      }
      await reload();
    },
    [patchList, reload, fail],
  );

  /** Скрыть событие из календаря (свайп): у нас пропадает, в календаре остаётся. */
  const hide = useCallback(
    async (todo: Todo) => {
      try {
        await trackEdit(api.updateTodo(todo.id, { hidden: true }));
      } catch {
        fail();
      }
      await reload();
    },
    [reload, fail],
  );

  return { toggle, add, update, remove, hide };
}

/** Дела на «Сегодня»: список живёт в кэше приложения. */
export function useTodos(setCache: Dispatch<SetStateAction<Cache>>, errorText: string, onError: (text: string) => void) {
  const patchList = useCallback(
    (fn: (list: Todo[]) => Todo[]) => setCache((c) => ({ ...c, today: { ...c.today, todos: sortTodos(fn(c.today.todos)) } })),
    [setCache],
  );
  const reload = useCallback(async () => {
    bumpChange();
    // Фоновая перечитка после правки: успех уже применён, а отказ показан через onError.
    const today = await api.today().catch(() => null);
    if (today) setCache((c) => ({ ...c, today, loadedAt: Date.now() }));
  }, [setCache]);
  return useTodoActions({ patchList, reload, errorText, onError });
}
