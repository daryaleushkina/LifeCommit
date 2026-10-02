// Типы, общие для Worker'а и мини-аппа.
import type { GroupToday } from './groups';

export type TaskKind = 'count' | 'check' | 'abstain';
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
  logged: boolean; // есть ли отметка за сегодня
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

/** Разовое дело: не повторяется. Несделанное остаётся в списке и в следующие дни. */
export interface Todo {
  id: number;
  title: string;
  /** На какой день запланировано; раньше сегодняшнего — значит, переехало («со вчера»). У повторяющегося — день этого раза. */
  day: string;
  done: boolean;
  /** «HH:MM» — дело на это время; null — на весь день. */
  time: string | null;
  /** Длительность события из календаря, минуты. */
  duration_min: number | null;
  /** Повторяется, как событие календаря: «сделано» у каждого дня своё. */
  recurring: boolean;
  /** Пришло из календаря. */
  source: 'apple' | 'google' | null;
}

export interface TodoInput {
  title: string;
  /** YYYY-MM-DD; не указан — сегодня. */
  day?: string | null;
  /** «HH:MM»; не указано — на весь день. */
  time?: string | null;
  /** Сколько длится, минуты («встреча на 3 часа»); нет — в календарь уходит 30 минут. */
  duration_min?: number | null;
}

/** Порядок дел в списке: несделанные со временем — по часам, потом без времени, сделанные — вниз. */
export function sortTodos<T extends Pick<Todo, 'done' | 'time'>>(list: readonly T[]): T[] {
  const rank = (d: T) => (d.done ? 2 : d.time ? 0 : 1);
  return list
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d) || (rank(a.d) === 0 ? a.d.time!.localeCompare(b.d.time!) : 0) || a.i - b.i)
    .map(({ d }) => d);
}

export interface TodayResponse {
  day: string; // YYYY-MM-DD, логический день пользователя
  tasks: TodayTask[];
  archived: ArchivedTask[];
  limits: { max_tasks: number | null; active: number };
  /** Дела на сегодня: несделанные (в том числе переехавшие) и сделанные сегодня. */
  todos: Todo[];
  /** Сколько дел запланировано на потом. */
  todos_later: number;
  /** Мои группы с делами на сегодня (блоки под личным). */
  groups: GroupToday[];
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
/**
 * Сколько привычек можно без подписки; null — лимита нет.
 * С 01.10.2026 всё бесплатно для всех (решение владелицы), кроме дневного лимита голоса.
 * Вернуть лимит — поставить число (было 5): проверки на сервере, в боте и в интерфейсе остались.
 */
export const FREE_TASK_LIMIT: number | null = null;

/** Голосовых разборов в день на человека (мини-апп и бот вместе): квоты моделей общие на всех. */
export const VOICE_DAILY_LIMIT = 20;
/** Дольше не записываем: это уже не список привычек, а распознавание небесплатное. */
export const MAX_VOICE_SECONDS = 90;

/**
 * Что сказанное просит сделать: завести привычку или дело на день.
 * Позже сюда добавится «отметить» — клиент готов к списку разных действий.
 */
export type VoiceAction = { type: 'create_habit'; habit: TaskInput } | { type: 'create_todo'; todo: TodoInput };

/**
 * Ответ POST /api/voice приходит построчно (NDJSON), чтобы расслышанная фраза
 * показалась, пока модель ещё разбирает её: сначала `text`, потом `actions`.
 * `error`: `voice_limit` — попытки на сегодня кончились, `failed` — не получилось.
 */
export type VoiceEvent = { text: string } | { actions: VoiceAction[] } | { error: 'voice_limit' | 'failed' | 'too_long' };

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
