import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { hapticFeedback } from '@tma.js/sdk-react';
import type { Todo } from '../shared/types';
import { api } from './api';
import { bumpChange, type Cache } from './useTaskLog';

/** Несделанные сверху (в порядке дней), сделанные опускаются вниз. */
export const sortTodos = (list: Todo[]): Todo[] => [...list.filter((d) => !d.done), ...list.filter((d) => d.done)];

/**
 * Дела на «Сегодня»: отметить, добавить, поправить, удалить.
 * Экран меняется сразу, сервер догоняет; при ошибке всё откатывается.
 */
export function useTodos(setCache: Dispatch<SetStateAction<Cache>>, errorText: string) {
  const [error, setError] = useState<string | null>(null);

  const patchList = useCallback(
    (fn: (list: Todo[]) => Todo[]) => setCache((c) => ({ ...c, today: { ...c.today, todos: sortTodos(fn(c.today.todos)) } })),
    [setCache],
  );

  const toggle = useCallback(
    async (todo: Todo) => {
      const done = !todo.done;
      bumpChange();
      patchList((list) => list.map((d) => (d.id === todo.id ? { ...d, done } : d)));
      if (done) hapticFeedback.notificationOccurred.ifAvailable('success');
      try {
        await api.updateTodo(todo.id, { done });
      } catch {
        patchList((list) => list.map((d) => (d.id === todo.id ? todo : d)));
        setError(errorText);
      }
    },
    [patchList, errorText],
  );

  /** Новое дело на сегодня: появляется сразу, id приходит с сервером. */
  const add = useCallback(
    async (title: string, day: string) => {
      const temp: Todo = { id: -Date.now(), title, day, done: false };
      bumpChange();
      patchList((list) => [...list, temp]);
      try {
        const { id } = await api.createTodo({ title, day });
        patchList((list) => list.map((d) => (d.id === temp.id ? { ...d, id } : d)));
      } catch {
        patchList((list) => list.filter((d) => d.id !== temp.id));
        setError(errorText);
      }
    },
    [patchList, errorText],
  );

  /** Перечитать «Сегодня»: после переноса дела на другой день или удаления список меняется целиком. */
  const reload = useCallback(async () => {
    bumpChange();
    const today = await api.today().catch(() => null);
    if (today) setCache((c) => ({ ...c, today, loadedAt: Date.now() }));
  }, [setCache]);

  const update = useCallback(
    async (todo: Todo, title: string, day: string) => {
      const patch = { ...(title !== todo.title && { title }), ...(day !== todo.day && { day }) };
      if (!Object.keys(patch).length) return;
      patchList((list) => list.map((d) => (d.id === todo.id ? { ...d, title } : d)));
      try {
        await api.updateTodo(todo.id, patch);
      } catch {
        setError(errorText);
      }
      await reload();
    },
    [patchList, reload, errorText],
  );

  const remove = useCallback(
    async (todo: Todo) => {
      patchList((list) => list.filter((d) => d.id !== todo.id));
      try {
        await api.deleteTodo(todo.id);
      } catch {
        setError(errorText);
      }
      await reload();
    },
    [patchList, reload, errorText],
  );

  return { toggle, add, update, remove, error, clearError: () => setError(null) };
}
