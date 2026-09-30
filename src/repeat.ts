import type { Schedule } from '../shared/types';
import type { useT } from './i18n';

const ALL_DAYS = 127;

/** Как часто привычку делают — одной строкой: «Каждый день», «Пн, ср, пт», «3 раза в неделю». */
export function repeatLabel(t: ReturnType<typeof useT>, schedule: Schedule, weekdays: number, perWeek: number | null): string {
  if (schedule === 'per_week') return t.perWeek(perWeek ?? 3);
  if (schedule === 'weekdays' && weekdays !== ALL_DAYS) {
    const names = t.weekdaysShort.filter((_, i) => (weekdays & (1 << i)) !== 0);
    return names.join(', ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  }
  return t.schedules.daily;
}
