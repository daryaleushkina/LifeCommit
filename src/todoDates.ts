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
