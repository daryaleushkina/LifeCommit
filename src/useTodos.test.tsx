// Дела на «Сегодня»: отметить, добавить, поправить, удалить, скрыть. Экран меняется сразу, сервер догоняет.
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';
import type { TodayResponse, Todo } from '../shared/types';

const haptic = vi.hoisted(() => vi.fn());
vi.mock('@tma.js/sdk-react', () => ({ hapticFeedback: { notificationOccurred: { ifAvailable: haptic } } }));
vi.mock('./api', () => ({ api: { updateTodo: vi.fn(), createTodo: vi.fn(), deleteTodo: vi.fn(), today: vi.fn() } }));

import { api } from './api';
import { currentChange, type Cache } from './useTaskLog';
import { sameTodo, useTodos } from './useTodos';

const m = vi.mocked(api);

const todo = (over: Partial<Todo>): Todo => ({
  id: 1, title: 'Молоко', day: '2026-10-03', done: false, time: null, duration_min: null, recurring: false, source: null, details: null, ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(todos: Todo[]) {
  const initial: Cache = { today: { day: '2026-10-03', tasks: [], todos } as unknown as TodayResponse, heat: [], loadedAt: 1 };
  return renderHook(() => {
    const [cache, setCache] = useState(initial);
    return { cache, todos: cache.today.todos, ...useTodos(setCache, 'Не сохранилось') };
  });
}

/** Ответ /today после перечитывания. */
const fresh = (todos: Todo[]) => ({ day: '2026-10-03', tasks: [], todos }) as unknown as TodayResponse;

beforeEach(() => {
  vi.resetAllMocks();
  m.updateTodo.mockResolvedValue({ ok: true });
  m.deleteTodo.mockResolvedValue({ ok: true });
  m.today.mockResolvedValue(fresh([]));
});

describe('sameTodo', () => {
  it('обычное дело — по id, повторяющееся — по id и дню', () => {
    expect(sameTodo(todo({}), todo({ day: '2026-10-04' }))).toBe(true);
    expect(sameTodo(todo({}), todo({ id: 2 }))).toBe(false);
    expect(sameTodo(todo({ recurring: true }), todo({ recurring: true, day: '2026-10-04' }))).toBe(false);
    expect(sameTodo(todo({ recurring: true }), todo({ recurring: true }))).toBe(true);
  });
});

describe('toggle', () => {
  it('отметить: сразу «сделано» (уходит вниз списка), хаптика, на сервер done', async () => {
    const a = todo({ id: 1 });
    const b = todo({ id: 2, title: 'Хлеб' });
    const { result, act } = await setup([a, b]);
    await act(() => result.current.toggle(a));
    expect(result.current.todos.map((d) => [d.id, d.done])).toEqual([[2, false], [1, true]]);
    expect(haptic).toHaveBeenCalledWith('success');
    expect(m.updateTodo).toHaveBeenCalledWith(1, { done: true });
  });

  it('снять отметку — без хаптики', async () => {
    const a = todo({ done: true });
    const { result, act } = await setup([a]);
    await act(() => result.current.toggle(a));
    expect(result.current.todos[0]!.done).toBe(false);
    expect(haptic).not.toHaveBeenCalled();
    expect(m.updateTodo).toHaveBeenCalledWith(1, { done: false });
  });

  it('повторяющееся — «сделано» только на этот день (on)', async () => {
    const today = todo({ recurring: true });
    const tomorrow = todo({ recurring: true, day: '2026-10-04' });
    const { result, act } = await setup([today, tomorrow]);
    await act(() => result.current.toggle(today));
    expect(result.current.todos.find((d) => d.day === '2026-10-03')!.done).toBe(true);
    expect(result.current.todos.find((d) => d.day === '2026-10-04')!.done).toBe(false);
    expect(m.updateTodo).toHaveBeenCalledWith(1, { done: true, on: '2026-10-03' });
  });

  it('сервер не принял — откат и ошибка; clearError', async () => {
    m.updateTodo.mockRejectedValueOnce(new Error('500'));
    const a = todo({});
    const b = todo({ id: 2, title: 'Хлеб' });
    const { result, act } = await setup([a, b]);
    await act(() => result.current.toggle(a));
    expect(result.current.todos).toHaveLength(2);
    expect(result.current.todos).toEqual(expect.arrayContaining([a, b]));
    expect(result.current.error).toBe('Не сохранилось');
    await act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe('add', () => {
  it('дело появляется сразу с временным id, потом получает настоящий', async () => {
    const d = deferred<{ id: number }>();
    m.createTodo.mockReturnValue(d.promise);
    const other = todo({ id: 5, title: 'Хлеб', time: '08:00' });
    const { result, act } = await setup([other]);
    const before = currentChange();
    let done!: Promise<void>;
    await act(() => {
      done = result.current.add('Купить хлеб', '2026-10-03');
    });
    expect(result.current.todos).toHaveLength(2);
    expect(result.current.todos[1]).toMatchObject({ title: 'Купить хлеб', day: '2026-10-03', done: false, recurring: false });
    expect(result.current.todos[1]!.id).toBeLessThan(0);
    expect(m.createTodo).toHaveBeenCalledWith({ title: 'Купить хлеб', day: '2026-10-03' });
    await act(async () => {
      d.resolve({ id: 77 });
      await done;
    });
    expect(result.current.todos.map((x) => x.id)).toEqual([5, 77]); // со временем — выше
    // Раз до запроса и раз после: начатые раньше чтения устарели.
    expect(currentChange()).toBe(before + 2);
  });

  it('не создалось — дело пропадает, ошибка', async () => {
    m.createTodo.mockRejectedValue(new Error('500'));
    const keep = todo({ id: 5 });
    const { result, act } = await setup([keep]);
    await act(() => result.current.add('X', '2026-10-03'));
    expect(result.current.todos).toEqual([keep]);
    expect(result.current.error).toBe('Не сохранилось');
  });
});

describe('update', () => {
  it('ничего не поменяли — ни запроса, ни перечитывания', async () => {
    const a = todo({ time: '09:00', details: { location: 'Кафе' } });
    const { result, act } = await setup([a]);
    await act(() => result.current.update(a, { title: a.title, day: a.day, time: '09:00', location: 'Кафе' }));
    await act(() => result.current.update(a, { title: a.title, day: a.day, time: '09:00' }));
    expect(m.updateTodo).not.toHaveBeenCalled();
    expect(m.today).not.toHaveBeenCalled();
  });

  it('уходит только изменённое; экран сразу, потом перечитываем «Сегодня»', async () => {
    const a = todo({ details: { location: 'Дом', link: 'https://meet' } });
    const reloaded = todo({ title: 'с сервера' });
    m.today.mockResolvedValue(fresh([reloaded]));
    const d = deferred<{ ok: true }>();
    m.updateTodo.mockReturnValue(d.promise);
    const { result, act } = await setup([a]);
    let done!: Promise<void>;
    await act(() => {
      done = result.current.update(a, { title: 'Сливки', day: '2026-10-05', time: '10:30', location: '  Кафе  ' });
    });
    expect(m.updateTodo).toHaveBeenCalledWith(1, { title: 'Сливки', day: '2026-10-05', time: '10:30', location: '  Кафе  ' });
    expect(result.current.todos[0]).toMatchObject({ title: 'Сливки', time: '10:30', details: { location: 'Кафе', link: 'https://meet' } });
    await act(async () => {
      d.resolve({ ok: true });
      await done;
    });
    expect(m.today).toHaveBeenCalledTimes(1);
    expect(result.current.todos).toEqual([reloaded]);
    expect(result.current.cache.loadedAt).toBeGreaterThan(1);
  });

  it('пустое место убирает его; без других подробностей — details = null', async () => {
    const a = todo({ details: { location: 'Дом' } });
    const b = todo({ id: 2, details: { location: 'Дом', link: 'u' } });
    m.today.mockImplementation(() => new Promise(() => {})); // перечитывание не мешает смотреть на экран
    const { result } = await setup([a, b]);
    void result.current.update(a, { title: a.title, day: a.day, time: null, location: ' ' });
    await expect.poll(() => result.current.todos.find((x) => x.id === 1)!.details).toBeNull();
    void result.current.update(b, { title: b.title, day: b.day, time: null, location: '' });
    await expect.poll(() => result.current.todos.find((x) => x.id === 2)!.details).toEqual({ link: 'u' });
    expect(m.updateTodo).toHaveBeenCalledWith(1, { location: ' ' });
  });

  it('место у дела без подробностей', async () => {
    const a = todo({});
    m.today.mockImplementation(() => new Promise(() => {}));
    const { result } = await setup([a]);
    void result.current.update(a, { title: a.title, day: a.day, time: null, location: 'Парк' });
    await expect.poll(() => result.current.todos[0]!.details).toEqual({ location: 'Парк' });
  });

  it('у повторяющегося день не переносим', async () => {
    const a = todo({ recurring: true });
    const { result, act } = await setup([a]);
    await act(() => result.current.update(a, { title: 'Новое', day: '2026-10-09', time: null }));
    expect(m.updateTodo).toHaveBeenCalledWith(1, { title: 'Новое' });
  });

  it('сервер не принял — ошибка, но всё равно перечитываем', async () => {
    m.updateTodo.mockRejectedValue(new Error('500'));
    const a = todo({});
    const { result, act } = await setup([a]);
    await act(() => result.current.update(a, { title: 'Б', day: a.day, time: null }));
    expect(result.current.error).toBe('Не сохранилось');
    expect(m.today).toHaveBeenCalledTimes(1);
  });

  it('перечитать не вышло — экран остаётся как есть', async () => {
    m.today.mockRejectedValue(new Error('сеть'));
    const a = todo({});
    const { result, act } = await setup([a]);
    await act(() => result.current.update(a, { title: 'Б', day: a.day, time: null }));
    expect(result.current.todos[0]!.title).toBe('Б');
    expect(result.current.cache.loadedAt).toBe(1);
    expect(result.current.error).toBeNull();
  });
});

describe('remove и hide', () => {
  it('удалить: строка пропадает сразу (повторяющееся — все дни), потом перечитываем', async () => {
    const a = todo({ recurring: true });
    const a2 = todo({ recurring: true, day: '2026-10-04' });
    const b = todo({ id: 2 });
    m.today.mockImplementation(() => new Promise(() => {}));
    const { result } = await setup([a, a2, b]);
    void result.current.remove(a);
    await expect.poll(() => result.current.todos.map((x) => x.id)).toEqual([2]);
    expect(m.deleteTodo).toHaveBeenCalledWith(1);
    expect(m.today).toHaveBeenCalled();
  });

  it('удалить не вышло — ошибка и перечитывание', async () => {
    m.deleteTodo.mockRejectedValue(new Error('500'));
    const a = todo({});
    m.today.mockResolvedValue(fresh([a]));
    const { result, act } = await setup([a]);
    await act(() => result.current.remove(a));
    expect(result.current.error).toBe('Не сохранилось');
    expect(result.current.todos).toEqual([a]);
  });

  it('скрыть событие календаря — hidden и перечитывание', async () => {
    const a = todo({ source: 'google' });
    const { result, act } = await setup([a]);
    await act(() => result.current.hide(a));
    expect(m.updateTodo).toHaveBeenCalledWith(1, { hidden: true });
    expect(result.current.todos).toEqual([]);
  });

  it('скрыть не вышло — ошибка', async () => {
    m.updateTodo.mockRejectedValue(new Error('500'));
    const a = todo({});
    const { result, act } = await setup([a]);
    await act(() => result.current.hide(a));
    expect(result.current.error).toBe('Не сохранилось');
  });
});
