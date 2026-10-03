// Привычки на день так, как их видит владелец: нужна ли сегодня (расписание, «N раз в неделю»), отметка,
// «N дней без». Общее для «Сегодня» (api.ts) и экрана друга (friends.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanDaysBeforeStart, type TaskKind, type TodayTask } from '../shared/types';
import type { UserRow } from './api';
import { logicalDay, weekdayIndex, weekStart } from './day';

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export interface TaskRow {
  id: number;
  title: string;
  emoji: string | null;
  kind: TaskKind;
  unit: string | null;
  step: number;
  schedule: TodayTask['schedule'];
  weekdays: number;
  per_week: number | null;
  visibility: TodayTask['visibility'];
  challenge_id: number | null;
  position: number;
  last_slip_on: string | null;
}

/** Строка дела из `today_screen`: цель, первый день, чистые дни и подзадачи база считает сама. */
export interface TodayRow extends TaskRow {
  target: number | null;
  start: string | null;
  clean_count: number;
  pre_slips: number;
  subtasks: { id: number; title: string }[];
}

export type ScreenLog = { task_id: number; day: string; value: number; status: 'clean' | 'slip' | null };

/** Привычки из `today_screen` глазами их владельца на день `day`: отметка, нужна ли сегодня, «N дней без». */
export function toTodayTasks(tasks: TodayRow[], logRows: ScreenLog[], day: string): TodayTask[] {
  return tasks.map((t) => {
    const todayLog = logRows.find((l) => l.task_id === t.id && l.day === day);
    const weekDone = logRows.filter(
      (l) => l.task_id === t.id && l.day !== day && (Number(l.value) > 0 || l.status === 'clean'),
    ).length;
    const due =
      t.schedule === 'daily' ||
      (t.schedule === 'weekdays' && (t.weekdays & (1 << weekdayIndex(day))) !== 0) ||
      (t.schedule === 'per_week' && (weekDone < (t.per_week ?? 7) || todayLog !== undefined));
    return {
      id: t.id,
      title: t.title,
      emoji: t.emoji,
      kind: t.kind,
      unit: t.unit,
      step: t.step,
      schedule: t.schedule,
      weekdays: t.weekdays,
      per_week: t.per_week,
      visibility: t.visibility,
      challenge_id: t.challenge_id,
      target: t.target === null ? 1 : Number(t.target),
      value: todayLog ? Number(todayLog.value) : 0,
      logged: todayLog !== undefined,
      status: todayLog?.status ?? null,
      week_done: weekDone,
      due,
      subtasks: t.subtasks,
      // «N дней без…»: чистые дни в приложении плюс дни до его появления, если указан «последний раз».
      clean_before: t.kind === 'abstain' ? Number(t.clean_count) + cleanDaysBeforeStart(t.start ?? day, t.last_slip_on) - Number(t.pre_slips ?? 0) : 0,
      last_slip_on: t.last_slip_on,
    };
  });
}

/** Привычки человека на его сегодня — для экрана друга (там фильтруем открытые друзьям). */
export async function habitsToday(sb: SupabaseClient, user: UserRow): Promise<TodayTask[]> {
  const day = logicalDay(user.timezone, user.day_start_hour);
  const screen = check(await sb.rpc('today_screen', { p_user: user.id, p_day: day, p_from: weekStart(day) })) as { tasks: TodayRow[]; logs: ScreenLog[] };
  return toTodayTasks(screen.tasks, screen.logs, day);
}
