import { describe, expect, it } from 'vitest';
import type { TodayTask } from '../../shared/types';
import { isDone, taskScore } from './TaskCard';

const task = (patch: Partial<TodayTask>): TodayTask => ({
  id: 1,
  title: 't',
  emoji: null,
  kind: 'count',
  unit: null,
  step: 1,
  schedule: 'daily',
  weekdays: 127,
  per_week: null,
  visibility: 'private',
  target: 10,
  value: 0,
  logged: false,
  status: null,
  week_done: 0,
  due: true,
  subtasks: [],
  challenge_id: null,
  clean_before: 0,
  last_slip_on: null,
  ...patch,
});

describe('taskScore', () => {
  it('количество: частичное выполнение засчитывается, сверх цели — не больше 1', () => {
    expect(taskScore(task({ value: 5 }))).toBe(0.5);
    expect(taskScore(task({ value: 25 }))).toBe(1);
  });
  it('да или нет', () => {
    expect(taskScore(task({ kind: 'check', target: 1, value: 1 }))).toBe(1);
    expect(taskScore(task({ kind: 'check', target: 1 }))).toBe(0);
  });
  it('лимит: без отметки 0, в пределах лимита 1, сверх — 0', () => {
    expect(taskScore(task({ kind: 'limit', target: 2 }))).toBe(0);
    expect(taskScore(task({ kind: 'limit', target: 2, logged: true, value: 0 }))).toBe(1);
    expect(taskScore(task({ kind: 'limit', target: 2, logged: true, value: 2 }))).toBe(1);
    expect(taskScore(task({ kind: 'limit', target: 2, logged: true, value: 3 }))).toBe(0);
  });
  it('отказ: засчитывается только «без»', () => {
    expect(taskScore(task({ kind: 'abstain', status: 'clean' }))).toBe(1);
    expect(taskScore(task({ kind: 'abstain', status: 'slip' }))).toBe(0);
  });
});

describe('isDone', () => {
  it('количество готово при достижении цели', () => {
    expect(isDone(task({ value: 9 }))).toBe(false);
    expect(isDone(task({ value: 10 }))).toBe(true);
  });
  it('отказ отмечен при любом ответе — срыв тоже отметка', () => {
    expect(isDone(task({ kind: 'abstain' }))).toBe(false);
    expect(isDone(task({ kind: 'abstain', status: 'slip' }))).toBe(true);
  });
});
