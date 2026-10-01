// Повторы событий календаря (RFC 5545, RRULE) — то подмножество, что реально встречается
// в Apple и Google Календаре: каждый день / неделю по дням / месяц по числу или «2-й вторник» /
// год (дни рождения, праздники), с INTERVAL, COUNT, UNTIL и исключёнными днями (EXDATE).
// Повторяющееся дело живёт одной строкой «навсегда», а дни, когда оно бывает, считаются здесь.
// Все дни — строки YYYY-MM-DD, без часовых поясов: дело привязано к дню человека.

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Recurrence {
  freq: Freq;
  interval: number;
  /** Дни недели: 0 = пн … 6 = вс; n — «который по счёту в месяце» (1, 2, −1 = последний). */
  byDay?: { wd: number; n?: number }[];
  byMonthDay?: number[];
  /** Месяцы 1–12. */
  byMonth?: number[];
  count?: number;
  /** Последний возможный день, включительно. */
  until?: string;
}

const WD = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** «FREQ=WEEKLY;BYDAY=MO,TH» → правило; то, что не понимаем, — null (такое событие покажем один раз). */
export function parseRRule(text: string): Recurrence | null {
  const parts = new Map<string, string>();
  for (const p of text.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = p.split('=');
    if (k && v !== undefined) parts.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  // Повторы чаще раза в день (по часам и минутам) — не про дела на день.
  for (const k of ['BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYSETPOS', 'BYWEEKNO', 'BYYEARDAY']) if (parts.has(k)) return null;
  const rule: Recurrence = { freq, interval: Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1) };
  const byDay = parts.get('BYDAY');
  if (byDay) {
    const days = byDay.split(',').map((s) => {
      const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(s);
      return m ? { wd: WD.indexOf(m[2]!), ...(m[1] && { n: Number(m[1]) }) } : null;
    });
    if (days.some((d) => d === null)) return null;
    rule.byDay = days as { wd: number; n?: number }[];
  }
  const nums = (key: string) => parts.get(key)?.split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0);
  const byMonthDay = nums('BYMONTHDAY');
  if (byMonthDay?.length) rule.byMonthDay = byMonthDay;
  const byMonth = nums('BYMONTH')?.filter((m) => m >= 1 && m <= 12);
  if (byMonth?.length) rule.byMonth = byMonth;
  const count = Number(parts.get('COUNT'));
  if (count > 0) rule.count = count;
  const until = parts.get('UNTIL');
  if (until && /^\d{8}/.test(until)) rule.until = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  return rule;
}

// ── Даты без часовых поясов ──
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
const ymd = (day: string) => day.split('-').map(Number) as [number, number, number];
export const addDay = (day: string, n: number): string => new Date(ms(day) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86_400_000);
/** пн = 0 … вс = 6 */
const weekday = (day: string) => (new Date(ms(day)).getUTCDay() + 6) % 7;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Совпадает ли день с n-м (или −n-м с конца) таким днём недели в своём месяце. */
function nthInMonth(day: string, n: number): boolean {
  const [y, m, d] = ymd(day);
  return n > 0 ? Math.ceil(d / 7) === n : Math.ceil((daysInMonth(y, m) - d + 1) / 7) === -n;
}

function monthDayMatches(day: string, list: number[]): boolean {
  const [y, m, d] = ymd(day);
  const dim = daysInMonth(y, m);
  return list.some((n) => (n > 0 ? n === d : dim + n + 1 === d));
}

/** Бывает ли событие в этот день по правилу (без учёта COUNT, UNTIL и исключений). */
function matches(rule: Recurrence, start: string, day: string): boolean {
  if (day < start) return false;
  const [sy, sm, sd] = ymd(start);
  const [y, m] = ymd(day);
  const wd = weekday(day);
  if (rule.byMonth && !rule.byMonth.includes(m)) return false;
  const dayIn = (list?: { wd: number; n?: number }[]) => !list || list.some((b) => b.wd === wd && (b.n === undefined || nthInMonth(day, b.n)));

  switch (rule.freq) {
    case 'DAILY':
      return daysBetween(start, day) % rule.interval === 0 && dayIn(rule.byDay) && (!rule.byMonthDay || monthDayMatches(day, rule.byMonthDay));
    case 'WEEKLY': {
      // Недели считаем от понедельника (WKST=MO по умолчанию).
      const weeks = Math.floor(daysBetween(addDay(start, -weekday(start)), day) / 7);
      if (weeks % rule.interval !== 0) return false;
      return rule.byDay ? dayIn(rule.byDay.map(({ wd: w }) => ({ wd: w }))) : wd === weekday(start);
    }
    case 'MONTHLY': {
      if (((y - sy) * 12 + (m - sm)) % rule.interval !== 0) return false;
      if (rule.byDay) return dayIn(rule.byDay) && (!rule.byMonthDay || monthDayMatches(day, rule.byMonthDay));
      return monthDayMatches(day, rule.byMonthDay ?? [sd]);
    }
    case 'YEARLY': {
      if ((y - sy) % rule.interval !== 0) return false;
      if (!rule.byMonth && m !== sm) return false;
      if (rule.byDay) return dayIn(rule.byDay);
      // 29 февраля в невисокосный год пропускается — так по RFC и так делают календари.
      return monthDayMatches(day, rule.byMonthDay ?? [sd]);
    }
  }
}

/** Дни повторяющегося события в промежутке [from, to] включительно. */
export function occurrences(rule: Recurrence, start: string, from: string, to: string, exdates: readonly string[] = []): string[] {
  const last = rule.until && rule.until < to ? rule.until : to;
  const out: string[] = [];
  // COUNT считается от самого начала: проходим и дни до from, но только если COUNT задан.
  let seen = 0;
  let day = rule.count ? start : from > start ? from : start;
  for (; day <= last; day = addDay(day, 1)) {
    if (!matches(rule, start, day)) continue;
    seen++;
    if (rule.count && seen > rule.count) break;
    if (day >= from && !exdates.includes(day)) out.push(day);
  }
  return out;
}

export const occursOn = (rule: Recurrence, start: string, day: string, exdates: readonly string[] = []): boolean =>
  occurrences(rule, start, day, day, exdates).length > 0;
