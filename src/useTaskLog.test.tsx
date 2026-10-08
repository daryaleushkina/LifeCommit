// Отметка привычки: экран меняется сразу, сервер догоняет; ошибка — откат и текст ошибки.
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';
import type { TodayResponse, TodayTask } from '../shared/types';

const haptic = vi.hoisted(() => vi.fn());
const notify = vi.fn();
vi.mock('@tma.js/sdk-react', () => ({ hapticFeedback: { notificationOccurred: { ifAvailable: haptic } } }));
vi.mock('./api', () => ({ api: { log: vi.fn() } }));

import { api } from './api';
import { bumpChange, currentChange, useTaskLog, type Cache } from './useTaskLog';

const log = vi.mocked(api.log);

const task = (over: Partial<TodayTask>): TodayTask =>
  ({ id: 1, title: 'Вода', kind: 'count', target: 8, unit: 'стаканов', value: 3, status: null, logged: true, due: true, ...over }) as TodayTask;

const other = task({ id: 2, title: 'Чтение', kind: 'check', target: 1, value: 0, logged: false });

function setup(tasks: TodayTask[], onError: (text: string) => void = notify) {
  const initial: Cache = { today: { day: '2026-10-03', tasks, todos: [] } as unknown as TodayResponse, heat: [], loadedAt: 1 };
  return renderHook(() => {
    const [cache, setCache] = useState(initial);
    return { cache, ...useTaskLog(setCache, 'Не сохранилось', onError) };
  });
}

const byId = (cache: Cache, id: number) => cache.today.tasks.find((t) => t.id === id)!;

beforeEach(() => {
  haptic.mockReset();
  notify.mockReset();
  log.mockReset();
  log.mockResolvedValue({ ok: true });
});

describe('useTaskLog', () => {
  it('«Считать»: цель набрана — значение сразу на экране, хаптика «успех», запрос на сервер', async () => {
    const w = task({});
    const { result, act } = await setup([w, other]);
    const before = currentChange();
    await act(() => result.current.log(w, { value: 8 }));
    expect(byId(result.current.cache, 1)).toMatchObject({ value: 8, status: null, logged: true });
    expect(byId(result.current.cache, 2)).toBe(other); // соседние не трогаем
    expect(haptic).toHaveBeenCalledWith('success');
    expect(log).toHaveBeenCalledWith(1, 8, undefined);
    expect(currentChange()).toBe(before + 1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('не дотянули до цели — без хаптики', async () => {
    const w = task({});
    const { result, act } = await setup([w]);
    await act(() => result.current.log(w, { value: 5 }));
    expect(byId(result.current.cache, 1).value).toBe(5);
    expect(haptic).not.toHaveBeenCalled();
  });

  it('уже было сделано — повторно не хлопаем', async () => {
    const w = task({ value: 8 });
    const { result, act } = await setup([w]);
    await act(() => result.current.log(w, { value: 9 }));
    expect(haptic).not.toHaveBeenCalled();
  });

  it('снять отметку (value = null) — ноль и logged = false', async () => {
    const w = task({ kind: 'check', target: 1, value: 1 });
    const { result, act } = await setup([w]);
    await act(() => result.current.log(w, { value: null }));
    expect(byId(result.current.cache, 1)).toMatchObject({ value: 0, status: null, logged: false });
    expect(log).toHaveBeenCalledWith(1, null, undefined);
  });

  it('«Бросить»: «получилось» — clean и 1; «не получилось» — slip и 0; снять — без статуса', async () => {
    const q = task({ kind: 'abstain', target: 1, value: 0, status: null, logged: false });
    const { result, act } = await setup([q]);
    await act(() => result.current.log(q, { value: null, status: 'clean' }));
    expect(byId(result.current.cache, 1)).toMatchObject({ value: 1, status: 'clean', logged: true });
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith(1, null, 'clean');

    await act(() => result.current.log(q, { value: null, status: 'slip' }));
    expect(byId(result.current.cache, 1)).toMatchObject({ value: 0, status: 'slip', logged: true });

    const clean = byId(result.current.cache, 1);
    await act(() => result.current.log(clean, { value: null, status: null }));
    expect(byId(result.current.cache, 1)).toMatchObject({ value: 0, status: null, logged: false });
    expect(haptic).toHaveBeenCalledTimes(2); // снятие не хлопает
  });

  it('сервер не принял — откат к прежней отметке и текст ошибки', async () => {
    log.mockRejectedValueOnce(new Error('500'));
    const w = task({});
    const { result, act } = await setup([w]);
    await act(() => result.current.log(w, { value: 8 }));
    expect(byId(result.current.cache, 1)).toEqual(w);
    expect(notify).toHaveBeenCalledWith('Не сохранилось');
  });

  // 04.10.2026: на «Сегодня» ошибка — плашкой внизу (notify): вверху длинного списка её не видно.
  it('с notify — откат и плашка, состояние экрана без ошибки', async () => {
    log.mockRejectedValueOnce(new Error('500'));
    const notify = vi.fn();
    const w = task({});
    const { result, act } = await setup([w], notify);
    await act(() => result.current.log(w, { value: 8 }));
    expect(byId(result.current.cache, 1)).toEqual(w);
    expect(notify).toHaveBeenCalledExactlyOnceWith('Не сохранилось');
  });
});

describe('счётчик изменений', () => {
  it('bumpChange увеличивает и возвращает новый номер', () => {
    const n = currentChange();
    expect(bumpChange()).toBe(n + 1);
    expect(currentChange()).toBe(n + 1);
  });
});
