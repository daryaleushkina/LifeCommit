// Логический день: день пользователя начинается в day_start_hour по его часовому поясу
// (по умолчанию 04:00 — отметка в 00:30 относится ко «вчера»).

const dateFmt = new Map<string, Intl.DateTimeFormat>();
const timeFmt = new Map<string, Intl.DateTimeFormat>();

function formatter(cache: Map<string, Intl.DateTimeFormat>, tz: string, opts: Intl.DateTimeFormatOptions) {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...opts });
    cache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function logicalDay(tz: string, startHour: number, now = new Date()): string {
  const shifted = new Date(now.getTime() - startHour * 3_600_000);
  return formatter(dateFmt, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
}

/** Местное время «HH:MM» (без сдвига на начало дня). */
export function localTime(tz: string, now = new Date()): string {
  return formatter(timeFmt, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Индекс дня недели: пн = 0 … вс = 6. */
export function weekdayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function weekStart(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

export function minutesOf(hm: string): number {
  const [h = '0', m = '0'] = hm.split(':');
  return Number(h) * 60 + Number(m);
}
