// Кэш «Календаря» (caches.days): промежутки дней «from:to» — один день или месяц целыми неделями.
// Один и тот же день лежит и в «Дне», и в «Месяце», поэтому правки и чтение идут по всем промежуткам, где он есть
// (04.10.2026, /lc-explore: добавленное в «Дне» пропадало в «Месяце», отмеченное на «Сегодня» висело несделанным).
import type { GroupDayBlock } from '../shared/groups';
import type { Todo } from '../shared/types';

export interface DaysEntry {
  todos: Todo[];
  groups: GroupDayBlock[];
}

const bounds = (key: string) => key.split(':') as [string, string];

/** Что показать для промежутка: он сам из кэша, а нет — вырезанный из закэшированного, который его покрывает (день из месяца). */
export function rangeFrom(days: Map<string, DaysEntry>, from: string, to: string): DaysEntry | undefined {
  const exact = days.get(`${from}:${to}`);
  if (exact) return exact;
  for (const [key, v] of days) {
    const [a, b] = bounds(key);
    if (a <= from && to <= b) {
      return { todos: v.todos.filter((d) => d.day >= from && d.day <= to), groups: v.groups.filter((g) => g.day >= from && g.day <= to) };
    }
  }
  return undefined;
}

/** Правка дня — во все закэшированные промежутки, куда он входит. */
export function patchDay(days: Map<string, DaysEntry>, day: string, fn: (e: DaysEntry) => DaysEntry): void {
  for (const [key, v] of days) {
    const [a, b] = bounds(key);
    if (a <= day && day <= b) days.set(key, fn(v));
  }
}

/** Свежий ответ обновляет пересечения: день в месяце, дни в месяце и крайние недели соседнего месяца. */
export function storeRange(days: Map<string, DaysEntry>, from: string, to: string, fresh: DaysEntry): void {
  for (const [key, entry] of days) {
    const [a, b] = bounds(key);
    if (b < from || a > to) continue;
    days.set(key, {
      todos: [...entry.todos.filter((d) => d.day < from || d.day > to), ...fresh.todos.filter((d) => a <= d.day && d.day <= b)],
      groups: [...entry.groups.filter((g) => g.day < from || g.day > to), ...fresh.groups.filter((g) => a <= g.day && g.day <= b)],
    });
  }
  days.set(`${from}:${to}`, fresh);
}

/** Действия с делами — во все промежутки; новое дело остаётся только в тех, куда входит его день. */
export function patchTodos(days: Map<string, DaysEntry>, fn: (list: Todo[]) => Todo[]): void {
  for (const [key, entry] of days) {
    const [from, to] = bounds(key);
    days.set(key, { ...entry, todos: fn(entry.todos).filter((d) => from <= d.day && d.day <= to) });
  }
}

interface TodayList {
  day: string;
  todos: Todo[];
}

/**
 * «Сегодня» поменялось (отметили, добавили, удалили, пришло с сервера) — то же в дни «Календаря».
 * Переносим только то, что поменялось: свежая правка, сделанная в самом «Календаре», старым списком не затирается.
 * Дела «со вчера» на «Сегодня» принадлежат своему дню — их не трогаем.
 */
export function syncToday(days: Map<string, DaysEntry>, prev: TodayList, next: TodayList): void {
  const day = next.day;
  if (!day || prev.day !== day) return;
  const before = new Map(prev.todos.filter((d) => d.day === day).map((d) => [d.id, d]));
  const after = new Map(next.todos.filter((d) => d.day === day).map((d) => [d.id, d]));
  const changed = [...after.values()].filter((d) => JSON.stringify(before.get(d.id)) !== JSON.stringify(d));
  const gone = [...before.keys()].filter((id) => !after.has(id));
  if (!changed.length && !gone.length) return;
  patchDay(days, day, (e) => {
    let todos = e.todos.filter((d) => !(d.day === day && gone.includes(d.id)));
    for (const d of changed) {
      const at = todos.findIndex((x) => x.id === d.id && x.day === day);
      todos = at < 0 ? [...todos, d] : todos.map((x, i) => (i === at ? d : x));
    }
    return { ...e, todos };
  });
}
