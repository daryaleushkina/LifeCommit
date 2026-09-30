// Типы, общие для Worker'а и мини-аппа.

export type TaskKind = 'count' | 'check' | 'limit' | 'abstain';
export type Schedule = 'daily' | 'weekdays' | 'per_week';
export type Visibility = 'private' | 'followers' | 'public';
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
  value: number;
  logged: boolean; // есть ли отметка за сегодня (для «не больше N» 0 — тоже отметка)
  status: AbstainStatus;
  week_done: number; // сколько дней на этой неделе уже отмечено (для per_week)
  due: boolean; // нужна ли сегодня
  subtasks: Subtask[];
  challenge_id: number | null;
  /** Отказ: чистых дней до сегодняшнего (вместе с днями до появления дела в приложении). */
  clean_before: number;
  /** Отказ: когда это было в последний раз до начала учёта. */
  last_slip_on: string | null;
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
  profile_mode: 'open' | 'closed';
  premium: boolean;
}

export interface TodayResponse {
  day: string; // YYYY-MM-DD, логический день пользователя
  tasks: TodayTask[];
  archived: ArchivedTask[];
  limits: { max_tasks: number | null; active: number };
}

export interface HeatDay {
  day: string;
  score: number;
}

/** Отложенное дело: скрыто из «Сегодня», история остаётся, можно вернуть. */
export interface ArchivedTask {
  id: number;
  title: string;
  emoji: string | null;
}

export interface TaskTemplate {
  slug: string;
  emoji: string;
  title: string;
  kind: TaskKind;
  unit: string | null;
  target: number;
  subtasks: string[];
}

export interface TaskInput {
  title: string;
  emoji?: string | null;
  kind: TaskKind;
  unit?: string | null;
  schedule?: Schedule;
  weekdays?: number;
  per_week?: number | null;
  visibility?: Visibility;
  target: number;
  subtasks?: string[];
  last_slip_on?: string | null;
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

/**
 * Отказ: сколько чистых дней было до первого дня дела в приложении.
 * Последний раз вчера или в первый же день — ноль; неделю назад — шесть.
 */
export function cleanDaysBeforeStart(startDay: string, lastSlipOn: string | null): number {
  if (!lastSlipOn) return 0;
  const days = Math.round((Date.parse(`${startDay}T00:00:00Z`) - Date.parse(`${lastSlipOn}T00:00:00Z`)) / 86_400_000);
  return Math.max(0, days - 1);
}

/** Шаг кнопки «+N» подбирается по цели: настройки «шаг» у пользователя нет. */
export function autoStep(target: number): number {
  if (target <= 10) return 1;
  if (target <= 40) return 5;
  if (target <= 100) return 10;
  return Math.max(1, Math.round(target / 10));
}
