// Оценка разбора голоса: сравнить ответ модели (уже приведённый тем же кодом, что в проде) с эталоном.
// Эталон задаёт только ключевые поля — что не указано, не проверяем. Списки сравниваются без учёта порядка:
// каждому ожидаемому пункту ищем пункт с подходящим названием; не нашли — «нет», осталось лишнее — «лишнее».
// Прогон и таблица — worker/test/voice.eval.ts (pnpm eval:voice), эталоны — worker/eval/voice.cases.ts.
import type { GroupItemDraft, GroupMode } from '../../shared/groups';
import type { Schedule, TaskInput, TaskKind, TodoInput } from '../../shared/types';
import { logicalDay } from '../day';
import type { RoutedVoice } from '../voiceRoute';

/** Строка — «название содержит» (без регистра, ё = е, без знаков); RegExp — как есть. */
export type TextMatch = string | RegExp;

export interface ExpectedHabit {
  title: TextMatch;
  kind?: TaskKind;
  target?: number;
  unit?: TextMatch | null;
  schedule?: Schedule;
  /** Дни недели, 1 = пн … 7 = вс. */
  weekdays?: number[];
  per_week?: number | null;
}

export interface ExpectedTodo {
  title: TextMatch;
  /** Пустой день у дела — это «сегодня», поэтому здесь всегда дата. */
  day?: string;
  time?: string | null;
  duration_min?: number | null;
  location?: TextMatch | null;
}

export interface ExpectedGroupItem {
  title: TextMatch;
  mode?: GroupMode;
  /** Имена тех, кому назначено (говорящий — своим именем). */
  people?: string[];
  all?: boolean;
  rotate?: boolean;
  day?: string;
  time?: string | null;
  rrule?: string | null;
  target?: number | null;
  /** Знак валюты или слово единицы цели. */
  unit?: TextMatch | null;
  duration_min?: number | null;
}

export interface ExpectedVoice {
  /** Логический день, от которого модель считает «завтра». */
  today: string;
  /** Не указано — не проверяем; [] — ничего быть не должно. */
  habits?: ExpectedHabit[];
  todos?: ExpectedTodo[];
  groups?: { title: string; items: ExpectedGroupItem[] }[];
}

export interface ActualGroupItem {
  title: string;
  mode: GroupMode;
  people: string[];
  all: boolean;
  rotate: boolean;
  day: string;
  time: string | null;
  rrule: string | null;
  target: number | null;
  unit: string | null;
  duration_min: number | null;
}

export interface ActualVoice {
  habits: TaskInput[];
  todos: TodoInput[];
  groups: { title: string; items: ActualGroupItem[] }[];
}

export interface Score {
  pass: boolean;
  diffs: string[];
}

export const normText = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function textMatches(expected: TextMatch, actual: string | null | undefined): boolean {
  const s = actual ?? '';
  if (typeof expected !== 'string') return expected.test(s);
  const want = normText(expected);
  // Знак без букв («₽») нормализация стёрла бы целиком — его ищем как есть.
  return want ? normText(s).includes(want) : s.includes(expected);
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : v instanceof RegExp ? String(v) : typeof v === 'string' ? v : JSON.stringify(v));

/** Дни недели списком → маска, как в TaskInput.weekdays (пн = бит 0). */
export const weekdayMask = (days: number[]) => days.reduce((mask, d) => mask | (1 << (d - 1)), 0);

type Check = (diff: (field: string, want: unknown, got: unknown) => void) => void;

function same(want: unknown, got: unknown): boolean {
  if (want === null) return got === null || got === undefined || got === '';
  return want === got;
}

function checkText(diff: Parameters<Check>[0], field: string, want: TextMatch | null | undefined, got: string | null | undefined) {
  if (want === undefined) return;
  const ok = want === null ? !got : textMatches(want, got);
  if (!ok) diff(field, want, got);
}

function checkValue(diff: Parameters<Check>[0], field: string, want: unknown, got: unknown) {
  if (want !== undefined && !same(want, got)) diff(field, want, got);
}

/**
 * Сопоставить ожидаемые пункты с пришедшими по названию и сравнить поля.
 * fields — проверки одного найденного пункта (дописывают отличия через diff).
 */
function matchList<E extends { title: TextMatch }, A extends { title: string }>(
  label: string,
  expected: E[],
  actual: A[],
  fields: (e: E, a: A) => Check,
  out: string[],
) {
  const used = new Set<number>();
  for (const e of expected) {
    const i = actual.findIndex((a, idx) => !used.has(idx) && textMatches(e.title, a.title));
    if (i < 0) {
      const rest = actual.filter((_, idx) => !used.has(idx)).map((a) => `«${a.title}»`);
      out.push(`${label}: нет «${show(e.title)}»${rest.length ? ` (есть: ${rest.join(', ')})` : ''}`);
      continue;
    }
    used.add(i);
    const a = actual[i]!;
    fields(e, a)((field, want, got) => out.push(`${label} «${a.title}».${field}: ждали ${show(want)}, пришло ${show(got)}`));
  }
  actual.forEach((a, idx) => {
    if (!used.has(idx)) out.push(`${label}: лишнее «${a.title}»`);
  });
}

const habitFields =
  (e: ExpectedHabit, a: TaskInput): Check =>
  (diff) => {
    checkValue(diff, 'kind', e.kind, a.kind);
    checkValue(diff, 'target', e.target, a.target);
    checkText(diff, 'unit', e.unit, a.unit);
    checkValue(diff, 'schedule', e.schedule, a.schedule);
    if (e.weekdays !== undefined && weekdayMask(e.weekdays) !== a.weekdays) diff('weekdays', e.weekdays.join(','), a.weekdays);
    checkValue(diff, 'per_week', e.per_week, a.per_week);
  };

const todoFields =
  (today: string) =>
  (e: ExpectedTodo, a: TodoInput): Check =>
  (diff) => {
    // Дело без дня сервер кладёт на сегодня — значит, пустой день и сегодняшняя дата равны.
    checkValue(diff, 'day', e.day, a.day || today);
    checkValue(diff, 'time', e.time, a.time);
    checkValue(diff, 'duration_min', e.duration_min, a.duration_min);
    checkText(diff, 'location', e.location, a.location);
  };

const nameKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

const groupItemFields =
  (e: ExpectedGroupItem, a: ActualGroupItem): Check =>
  (diff) => {
    checkValue(diff, 'mode', e.mode, a.mode);
    if (e.people !== undefined) {
      const want = e.people.map(nameKey).sort().join(', ');
      const got = a.people.map(nameKey).sort().join(', ');
      if (want !== got) diff('people', want, got);
    }
    checkValue(diff, 'all', e.all, a.all);
    checkValue(diff, 'rotate', e.rotate, a.rotate);
    checkValue(diff, 'day', e.day, a.day);
    checkValue(diff, 'time', e.time, a.time);
    checkValue(diff, 'rrule', e.rrule, a.rrule);
    checkValue(diff, 'target', e.target, a.target);
    checkText(diff, 'unit', e.unit, a.unit);
    checkValue(diff, 'duration_min', e.duration_min, a.duration_min);
  };

/** Сравнить один ответ с эталоном. */
export function scoreVoiceCase(expected: ExpectedVoice, actual: ActualVoice): Score {
  const diffs: string[] = [];
  if (expected.habits) matchList('привычки', expected.habits, actual.habits, habitFields, diffs);
  if (expected.todos) matchList('дела', expected.todos, actual.todos, todoFields(expected.today), diffs);
  if (expected.groups) {
    const left = new Set(actual.groups.map((g) => g.title));
    for (const eg of expected.groups) {
      const ag = actual.groups.find((g) => nameKey(g.title) === nameKey(eg.title));
      if (!ag) {
        diffs.push(`группа «${eg.title}»: нет`);
        continue;
      }
      left.delete(ag.title);
      matchList(`группа «${eg.title}»`, eg.items, ag.items, groupItemFields, diffs);
    }
    for (const t of left) diffs.push(`группа «${t}»: лишняя`);
  }
  return { pass: diffs.length === 0, diffs };
}

/** Когда сказано: либо сразу логический день, либо момент и пояс — тогда день считает тот же код, что в проде. */
export type CaseWhen = { today: string } | { now: string; tz: string; startHour: number };

export function caseToday(when: CaseWhen): string {
  return 'today' in when ? when.today : logicalDay(when.tz, when.startHour, new Date(when.now));
}

/** Личный разбор → общий вид. */
export function fromParsed(p: { habits: TaskInput[]; todos: TodoInput[] }): ActualVoice {
  return { habits: p.habits, todos: p.todos, groups: [] };
}

/** Деньги — знак валюты, остальное — слово единицы. */
const goalUnit = (u: GroupItemDraft['unit']): string | null => (u ? u.currency || u.forms[0] : null);

/** Черновики групповых дел → общий вид: id участников превращаем в имена. */
export function fromDrafts(groupTitle: string, drafts: GroupItemDraft[], members: { id: number; name: string }[]): ActualVoice['groups'][number] {
  return {
    title: groupTitle,
    items: drafts.map((d) => ({
      title: d.title,
      mode: d.mode,
      people: d.assignees.map((id) => members.find((m) => m.id === id)?.name ?? `#${id}`),
      all: d.all_members,
      rotate: d.rotate,
      day: d.day,
      time: d.time,
      rrule: d.rrule,
      target: d.target,
      unit: goalUnit(d.unit),
      duration_min: d.duration_min,
    })),
  };
}

/** Разбор из мини-аппа (личное + группы) → общий вид. */
export function fromRouted(r: RoutedVoice, groups: { id: number; members: { id: number; name: string }[] }[]): ActualVoice {
  return {
    habits: r.habits,
    todos: r.todos,
    groups: r.groups.map((g) => fromDrafts(g.group.title, g.items, groups.find((x) => x.id === g.group.id)?.members ?? [])),
  };
}

/** pass^k: кейс зелёный, только если зелёные все прогоны. */
export const passAll = (runs: { pass: boolean }[]) => runs.length > 0 && runs.every((r) => r.pass);

export function summarize(cases: { runs: { pass: boolean }[] }[]): { passed: number; total: number; percent: number } {
  const passed = cases.filter((c) => passAll(c.runs)).length;
  const total = cases.length;
  return { passed, total, percent: total ? Math.round((passed / total) * 1000) / 10 : 0 };
}
