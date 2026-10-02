// Итог по всем привычкам за период — для картинок «Поделиться» (круг 23: «1 024 слова · 18 зарядок · 31 день без»).
// Считаем на сервере из отметок за период; функция чистая — проверена тестами.
import type { TaskKind } from './types';

export interface SummaryTask {
  id: number;
  title: string;
  kind: TaskKind | 'limit';
  unit: string | null;
}

export interface SummaryLog {
  task_id: number;
  day: string;
  value: number;
  status: 'clean' | 'slip' | null;
}

export interface SummaryItem {
  id: number;
  title: string;
  kind: TaskKind;
  unit: string | null;
  /** «Считать» — сумма чисел; «Делать» — сколько дней сделано; «Бросить» — сколько дней получилось. */
  total: number;
  /** То же по месяцам года (0 — январь): столбики годовой картинки. */
  months: number[];
}

/** Привычки в их порядке; без единой отметки за период — не попадают (на картинке нечем хвастаться). */
export function summarize(tasks: SummaryTask[], logs: SummaryLog[]): SummaryItem[] {
  const byTask = new Map<number, SummaryLog[]>();
  for (const l of logs) byTask.set(l.task_id, [...(byTask.get(l.task_id) ?? []), l]);
  const out: SummaryItem[] = [];
  for (const t of tasks) {
    if (t.kind === 'limit') continue;
    const months = Array.from({ length: 12 }, () => 0);
    let total = 0;
    for (const l of byTask.get(t.id) ?? []) {
      const add = t.kind === 'count' ? l.value : t.kind === 'check' ? (l.value >= 1 ? 1 : 0) : l.status === 'clean' ? 1 : 0;
      if (!add) continue;
      total += add;
      months[Number(l.day.slice(5, 7)) - 1]! += add;
    }
    if (total > 0) out.push({ id: t.id, title: t.title, kind: t.kind, unit: t.unit, total, months });
  }
  return out;
}
