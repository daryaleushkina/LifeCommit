// Статистика одной привычки: чистые функции над её историей (общие для клиента и тестов).
import type { AbstainStatus } from './types';

export interface HistoryLog {
  day: string;
  value: number;
  status: AbstainStatus;
}

export interface HistoryGoal {
  effective_from: string;
  target: number;
}

export interface TaskHistory {
  /** Первый день привычки в приложении. */
  start: string;
  goals: HistoryGoal[];
  logs: HistoryLog[];
}

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Цель, действовавшая в этот день: прошлые дни по новой цели не пересчитываются. */
export function targetOn(goals: HistoryGoal[], day: string): number {
  let target = goals[0]?.target ?? 1;
  let from = '';
  for (const g of goals) {
    if (g.effective_from <= day && g.effective_from >= from) {
      from = g.effective_from;
      target = g.target;
    }
  }
  return target;
}

/**
 * «Бросить»: самый долгий период без этого и текущий.
 * Период — дни подряд с отметкой «получилось»; дни до появления привычки в приложении
 * (после «последнего раза») продолжают первый период. Сегодня без ответа период не рвёт.
 */
export function cleanRuns(logs: HistoryLog[], start: string, lastSlipOn: string | null, today: string): { longest: number; current: number } {
  const clean = new Set(logs.filter((l) => l.status === 'clean').map((l) => l.day));
  const answered = new Set(logs.map((l) => l.day));
  // До первого дня привычки: после «последнего раза» дни чистые, если задним числом не отметили срыв.
  let run = 0;
  let longest = 0;
  for (let day = lastSlipOn ? addDays(lastSlipOn, 1) : start; day < start; day = addDays(day, 1)) {
    run = answered.has(day) && !clean.has(day) ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  for (let day = start; day <= today; day = addDays(day, 1)) {
    if (clean.has(day)) run++;
    else if (day === today && !answered.has(day)) break;
    else run = 0;
    longest = Math.max(longest, run);
  }
  return { longest, current: run };
}

/** Значения за последние n дней по порядку, включая дни без отметки (нули). */
export function lastDays(logs: HistoryLog[], today: string, n: number): { day: string; value: number }[] {
  const byDay = new Map(logs.map((l) => [l.day, l.value]));
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - n + 1);
    return { day, value: byDay.get(day) ?? 0 };
  });
}
