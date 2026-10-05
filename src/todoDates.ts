import type { Todo } from '../shared/types';
import { addDays } from './components/Heatmap';
import type { useT } from './i18n';

type T = ReturnType<typeof useT>;

const fmt = (day: string, locale: string, weekday: boolean) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long', ...(weekday && { weekday: 'short' }) });

/**
 * Подпись дела рядом с названием. Сегодняшнее — без подписи; переехавшее — тихое «со вчера»
 * (без красного и «просрочено»); запланированное — «завтра» или «пт, 3 октября».
 */
export function todoWhen(t: T, day: string, today: string, locale: string): string | null {
  if (day === today) return null;
  if (day < today) return day === addDays(today, -1) ? t.todo.sinceYesterday : t.todo.since(fmt(day, locale, false));
  if (day === addDays(today, 1)) return t.todo.tomorrow.toLowerCase();
  return fmt(day, locale, true);
}

/** Событие без длительности считаем часовым (решение владелицы 05.10.2026: у встреч из календаря она обычно есть). */
const EVENT_DEFAULT_MIN = 60;

/**
 * Событие из календаря уже прошло: сейчас не раньше его конца — начало плюс длительность (без неё — час).
 * Своё дело не «проходит»: оно сделано или нет. Событие на весь день — тоже: оно про весь день.
 * Время местное, как на телефоне; день — логический, поэтому вчерашнее событие ночью уже прошло.
 */
export function eventOver(d: Pick<Todo, 'source' | 'day' | 'time' | 'duration_min'>, now: Date): boolean {
  if (!d.source || !d.time) return false;
  const start = new Date(`${d.day}T${d.time.slice(0, 5)}:00`);
  return now.getTime() >= start.getTime() + (d.duration_min ?? EVENT_DEFAULT_MIN) * 60_000;
}
