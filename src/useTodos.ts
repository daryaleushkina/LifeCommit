import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { hapticFeedback } from '@tma.js/sdk-react';
import { sortTodos, type Todo } from '../shared/types';
import { api } from './api';
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
}

/**
 * Действия с делами: отметить, добавить, поправить, удалить.
 * Экран меняется сразу, сервер догоняет; при ошибке отметка откатывается.
 */
export function useTodoActions({ patchList, reload, errorText }: Options) {
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (todo: Todo) => {
      const done = !todo.done;
      bumpChange();
      patchList((list) => list.map((d) => (sameTodo(d, todo) ? { ...d, done } : d)));
      if (done) hapticFeedback.notificationOccurred.ifAvailable('success');
      try {
        // У повторяющегося дела «сделано» — на этот его день.
        await api.updateTodo(todo.id, { done, ...(todo.recurring && { on: todo.day }) });
      } catch {
        patchList((list) => list.map((d) => (sameTodo(d, todo) ? todo : d)));
        setError(errorText);
      }
    },
    [patchList, errorText],
  );

  /** Новое дело: появляется сразу, id приходит с сервера. */
  const add = useCallback(
    async (title: string, day: string) => {
      const temp: Todo = { id: -Date.now(), title, day, done: false, time: null, duration_min: null, recurring: false, source: null, details: null };
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

  const update = useCallback(
    async (todo: Todo, edit: TodoEdit) => {
      const patch = {
        ...(edit.title !== todo.title && { title: edit.title }),
        ...(edit.day !== todo.day && !todo.recurring && { day: edit.day }),
        ...(edit.time !== todo.time && { time: edit.time }),
        ...(edit.location !== undefined && edit.location !== (todo.details?.location ?? '') && { location: edit.location }),
      };
      if (!Object.keys(patch).length) return;
      bumpChange();
      patchList((list) => list.map((d) => (d.id === todo.id ? { ...d, title: edit.title, time: edit.time, ...(edit.location !== undefined && { details: withLocation(d.details, edit.location) }) } : d)));
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
      bumpChange();
      // Повторяющееся удаляется целиком — со всеми днями.
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

/** Дела на «Сегодня»: список живёт в кэше приложения. */
export function useTodos(setCache: Dispatch<SetStateAction<Cache>>, errorText: string) {
  const patchList = useCallback(
    (fn: (list: Todo[]) => Todo[]) => setCache((c) => ({ ...c, today: { ...c.today, todos: sortTodos(fn(c.today.todos)) } })),
    [setCache],
  );
  const reload = useCallback(async () => {
    bumpChange();
    const today = await api.today().catch(() => null);
    if (today) setCache((c) => ({ ...c, today, loadedAt: Date.now() }));
  }, [setCache]);
  return useTodoActions({ patchList, reload, errorText });
}
