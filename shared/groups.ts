// Группы: типы и правило «кто делает сегодня» — одно на «Сегодня», экран группы, бота и календарь.
// Архитектура — docs/groups-architecture.md.
import { occurrences, parseRRule } from './rrule';

export type GroupKind = 'family' | 'sport' | 'pair' | 'friends' | 'work' | 'other';
/** Кто делает: кто-то один, назначено, общая цель, мероприятие. */
export type GroupMode = 'one' | 'assign' | 'goal' | 'event';
export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMember {
  id: number;
  name: string;
  photo: string | null;
}

/** Единица общей цели (docs/groups-goals.md); null — просто числа «27 из 40». */
export interface GoalUnit {
  type: string;
  /** Формы слова: одна, две, пять — «книга, книги, книг». */
  forms: [string, string, string];
  currency?: string | null;
  icon?: string;
}

/** Строка группового дела, как её отдаёт `groups_today`. */
export interface GroupItemRow {
  id: number;
  title: string;
  mode: GroupMode;
  day: string;
  time: string | null;
  duration_min: number | null;
  rrule: string | null;
  exdates: string[];
  due_day: string | null;
  assignees: number[];
  all_members: boolean;
  rotate: boolean;
  target: number | null;
  unit: GoalUnit | null;
  goal_until: string | null;
  total: number | null;
  marks: { user_id: number; at: string }[];
}

/** Групповое дело на конкретный день — глазами одного участника. */
export interface GroupDayItem {
  id: number;
  title: string;
  mode: GroupMode;
  time: string | null;
  duration_min: number | null;
  due_day: string | null;
  /** Разовое с прошлого дня, ещё не сделано. */
  carried: boolean;
  recurring: boolean;
  /** Кому это дело сегодня (у очереди — один человек). */
  people: number[];
  /** Для «Все»: и будущие участники. */
  all_members: boolean;
  rotate: boolean;
  /** Чья сегодня очередь. */
  turn: number | null;
  /** Показывать мне на «Сегодня». */
  for_me: boolean;
  /** Я могу отметить. */
  can_mark: boolean;
  /** Закрыто для меня: кто-то один сделал, моя отметка, очередь сделана. */
  done: boolean;
  /** Кто сделал сегодня. */
  done_by: number[];
  target: number | null;
  total: number | null;
  unit: GoalUnit | null;
  goal_until: string | null;
  /** Как задано (для правки): первый день, повтор, выбранные люди. */
  start: string;
  rrule: string | null;
  assignees: number[];
}

/** Дела группы на один день — для «Календаря» и «Скоро». */
export interface GroupDayBlock {
  day: string;
  group: { id: number; title: string; kind: GroupKind; members: GroupMember[] };
  items: GroupDayItem[];
}

export interface GroupToday {
  id: number;
  title: string;
  kind: GroupKind;
  color: string | null;
  role: GroupRole;
  members: GroupMember[];
  items: GroupDayItem[];
  /** Сколько раз сегодня надо сделать на всю группу и сколько сделано (мероприятия и цели не считаем). */
  planned: number;
  done: number;
}

/** Бывает ли дело в этот день. Разовое — в свой день и потом, пока не сделано (переезжает, как личные дела). */
export function occursOn(item: Pick<GroupItemRow, 'mode' | 'day' | 'rrule' | 'exdates'>, day: string): boolean {
  if (item.mode === 'goal') return true;
  if (!item.rrule) return item.mode === 'event' ? item.day === day : item.day <= day;
  const rule = parseRRule(item.rrule);
  if (!rule) return item.day === day;
  return occurrences(rule, item.day, day, day, item.exdates).includes(day);
}

/** Номер раза по расписанию (0 — первый): по нему идёт очередь. Пропуск очередь не сдвигает. */
export function occurrenceIndex(item: Pick<GroupItemRow, 'day' | 'rrule' | 'exdates'>, day: string): number {
  if (!item.rrule) return 0;
  const rule = parseRRule(item.rrule);
  if (!rule) return 0;
  return Math.max(0, occurrences(rule, item.day, item.day, day, item.exdates).length - 1);
}

/** Кому дело: «Все» — все участники по порядку вступления, иначе выбранные (кто ещё в группе). */
export function targetsOf(item: Pick<GroupItemRow, 'mode' | 'assignees' | 'all_members'>, memberIds: number[]): number[] {
  if (item.mode === 'one' || item.mode === 'goal') return memberIds;
  if (item.all_members || item.assignees.length === 0) return memberIds;
  return item.assignees.filter((id) => memberIds.includes(id));
}

/** Групповое дело на день глазами участника `me`. null — в этот день его нет. */
export function dayItem(item: GroupItemRow, memberIds: number[], me: number, day: string): GroupDayItem | null {
  if (!occursOn(item, day)) return null;
  const targets = targetsOf(item, memberIds);
  const doneBy = item.marks.map((m) => m.user_id);
  const solo = item.mode === 'one' || (item.mode === 'assign' && item.rotate && targets.length > 1);
  const turn = item.mode === 'assign' && item.rotate && targets.length > 1 ? (targets[occurrenceIndex(item, day) % targets.length] ?? null) : null;
  const people = turn !== null ? [turn] : targets;
  const forMe = item.mode === 'one' || item.mode === 'goal' || people.includes(me);
  const done = item.mode === 'event' || item.mode === 'goal' ? false : solo ? doneBy.length > 0 : doneBy.includes(me);
  return {
    id: item.id,
    title: item.title,
    mode: item.mode,
    time: item.time,
    duration_min: item.duration_min,
    due_day: item.due_day,
    carried: !item.rrule && item.mode !== 'goal' && item.day < day,
    recurring: Boolean(item.rrule),
    people,
    all_members: item.all_members,
    rotate: item.rotate,
    turn,
    for_me: forMe,
    // Отметить: «кто-то один» — любой (снять — только сделавший); назначенное — тот, кому оно.
    can_mark: item.mode === 'one' ? !done || doneBy.includes(me) : item.mode === 'assign' ? people.includes(me) : false,
    done,
    done_by: doneBy,
    target: item.target === null ? null : Number(item.target),
    total: item.total === null ? null : Number(item.total),
    unit: item.unit,
    goal_until: item.goal_until,
    start: item.day,
    rrule: item.rrule,
    assignees: item.assignees,
  };
}

/** Сколько раз дело надо сделать сегодня и сколько сделано — для «5 из 8». */
export function dayCount(it: GroupDayItem): { planned: number; done: number } {
  if (it.mode === 'event' || it.mode === 'goal') return { planned: 0, done: 0 };
  if (it.mode === 'one' || it.turn !== null) return { planned: 1, done: it.done_by.length > 0 ? 1 : 0 };
  return { planned: it.people.length, done: it.people.filter((p) => it.done_by.includes(p)).length };
}

/** Форма слова по числу: 1 книга, 2 книги, 5 книг. */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (!Number.isInteger(n)) return forms[1];
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}
