// Типы, общие для Worker'а и мини-аппа.
import type { GroupItemDraft, GroupToday } from './groups';

export type TaskKind = 'count' | 'check' | 'abstain';
export type Schedule = 'daily' | 'weekdays' | 'per_week';
/** Кто видит привычку: только я или друзья (решение 03.10.2026; по умолчанию — только я). */
export type Visibility = 'private' | 'friends';
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
  /** Место, ссылка на встречу, участники, описание — видно, когда дело открыли. */
  details: TodoDetails | null;
}

/** Подробности события: из календаря или из голоса («в кафе Снежинка»). Всё необязательное. */
export interface TodoDetails {
  /** «Кафе „Снежинка“» или адрес. */
  location?: string;
  /** Ссылка на созвон (Meet, Zoom, Телемост…) или ссылка события. */
  link?: string;
  /** Сколько всего участников (со мной). */
  people_count?: number;
  /** Имена остальных участников, до 12. */
  people?: string[];
  /** Описание без разметки, до 600 знаков. */
  notes?: string;
  /** Открыть событие в самом календаре (у Google — страница события). */
  open_url?: string;
}

export interface TodoInput {
  title: string;
  /** YYYY-MM-DD; не указан — сегодня. */
  day?: string | null;
  /** «HH:MM»; не указано — на весь день. */
  time?: string | null;
  /** Сколько длится, минуты («встреча на 3 часа»); нет — в календарь уходит 30 минут. */
  duration_min?: number | null;
  /** Где («в кафе Снежинка» → «Кафе Снежинка»); уходит в событие календаря. */
  location?: string | null;
}

/** Порядок дел в списке: несделанные со временем — по часам, потом без времени, сделанные — вниз. */
export function sortTodos<T extends Pick<Todo, 'done' | 'time'>>(list: readonly T[]): T[] {
  const rank = (d: T) => (d.done ? 2 : d.time ? 0 : 1);
  return list
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d) || (rank(a.d) === 0 ? a.d.time!.localeCompare(b.d.time!) : 0) || a.i - b.i)
    .map(({ d }) => d);
}

// ── Друзья (допрос 03.10.2026) ──

/** Человек — как его видят другие: в списке друзей, в заявке, в поиске по @username. */
export interface Person {
  id: number;
  first_name: string;
  username: string | null;
  photo_url: string | null;
}

/** Друг в списке: сколько открытых мне привычек он сделал сегодня из нужных сегодня. */
export interface FriendCard extends Person {
  /** Когда стали друзьями. */
  since: string | null;
  done: number;
  due: number;
  /** Общая карта за последние 14 дней друга (с самого раннего по сегодня) — полоска в карточке. */
  days: number[];
}

/** Заявка ко мне: нашли по @username или открыли мою ссылку. */
export interface FriendRequest extends Person {
  via: 'username' | 'link';
}

export interface FriendsResponse {
  friends: FriendCard[];
  /** Заявки ко мне. */
  incoming: FriendRequest[];
  /** Мои заявки, которые ещё не приняли. */
  outgoing: Person[];
  /** Моя постоянная ссылка «Позвать друга» (открывший присылает заявку). */
  link: string;
  /** Показать один раз шторку «Что показать друзьям?»: друг уже есть, а шторку ещё не видели. */
  prompt: boolean;
}

/** Кто это для меня: друг, заявка от меня, заявка ко мне, я сам, я его заблокировала — или никто. */
export type PersonStatus = 'none' | 'friends' | 'sent' | 'incoming' | 'self' | 'blocked';

/** Открытая друзьям привычка — на экране друга. */
export interface FriendHabit {
  id: number;
  title: string;
  emoji: string | null;
  kind: TaskKind;
  unit: string | null;
  target: number;
  value: number;
  status: AbstainStatus;
  due: boolean;
  /** Отказ: «N дней без». */
  clean_days: number;
  /** Отметки за последние 35 дней. */
  logs: { day: string; value: number; status: AbstainStatus }[];
}

export interface FriendProfile {
  person: Person;
  since: string | null;
  /** Логический день друга (его «сегодня»). */
  today: string;
  /** Общая карта за год — по всем привычкам и делам, без названий. */
  heat: HeatDay[];
  habits: FriendHabit[];
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
export type VoiceAction =
  | { type: 'create_habit'; habit: TaskInput }
  | { type: 'create_todo'; todo: TodoInput }
  /** Дело в группу; names — кому назначено, по порядку assignees ('' — сам говорящий). */
  | { type: 'create_group_item'; group: { id: number; title: string }; item: GroupItemDraft; names: string[] };

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
