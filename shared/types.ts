// Типы, общие для Worker'а и мини-аппа.

export type TaskKind = 'count' | 'check' | 'limit' | 'abstain';
export type Schedule = 'daily' | 'weekdays' | 'per_week';
export type Visibility = 'private' | 'followers' | 'public';
export type DayMode = 'minimum' | 'pause' | null;
export type AbstainStatus = 'clean' | 'slip' | null;

export interface Subtask {
  id: number;
  title: string;
}

export interface TodayTask {
  id: number;
  title: string;
  emoji: string | null;
  kind: TaskKind;
  unit: string | null;
  step: number;
  schedule: Schedule;
  weekdays: number; // битовая маска, пн = 1
  per_week: number | null;
  visibility: Visibility;
  target: number;
  min_target: number | null;
  value: number;
  logged: boolean; // есть ли отметка за сегодня (для «не больше N» 0 — тоже отметка)
  status: AbstainStatus;
  week_done: number; // сколько дней на этой неделе уже отмечено (для per_week)
  due: boolean; // нужна ли сегодня
  subtasks: Subtask[];
  challenge_id: number | null;
}

export interface UserSettings {
  id: number;
  first_name: string;
  username: string | null;
  photo_url: string | null;
  language_code: string;
  timezone: string;
  day_start_hour: number;
  remind_morning: string | null;
  remind_evening: string | null;
  bot_chat_ok: boolean;
  premium: boolean;
}

export interface TodayResponse {
  day: string; // YYYY-MM-DD, логический день пользователя
  mode: DayMode;
  tasks: TodayTask[];
  limits: { max_tasks: number | null; active: number };
}

export interface HeatDay {
  day: string;
  score: number;
  mode: DayMode;
}

export interface TaskTemplate {
  slug: string;
  emoji: string;
  title: string;
  kind: TaskKind;
  unit: string | null;
  target: number;
  min_target: number | null;
  step: number;
  subtasks: string[];
}

export interface TaskInput {
  title: string;
  emoji?: string | null;
  kind: TaskKind;
  unit?: string | null;
  step?: number;
  schedule?: Schedule;
  weekdays?: number;
  per_week?: number | null;
  visibility?: Visibility;
  target: number;
  min_target?: number | null;
  subtasks?: string[];
}

/** Бесплатный лимит личных задач (задачи челленджей не считаются). */
export const FREE_TASK_LIMIT = 5;

/** Уровень клетки тепловой карты по абсолютной сумме выполненного за день. */
export function heatLevel(score: number): 0 | 1 | 2 | 3 | 4 {
  if (score <= 0) return 0;
  if (score < 1) return 1;
  if (score < 3) return 2;
  if (score < 5) return 3;
  return 4;
}
