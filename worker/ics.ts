// Формат событий календаря (iCalendar, RFC 5545): разобрать событие из Apple/Google в дело
// и собрать событие из нашего дела. Время переводится в часовой пояс человека: дело живёт
// в его днях и часах, а календарь хранит момент (UTC или со своим TZID).
import { parseRRule } from '../shared/rrule';

/** Событие календаря, как его понимает LifeCommit. */
export interface CalEvent {
  uid: string;
  title: string;
  /** День начала в часовом поясе человека. */
  day: string;
  /** «HH:MM» в часовом поясе человека; null — на весь день. */
  time: string | null;
  durationMin: number | null;
  /** RRULE, если повтор нам понятен; иначе событие — один раз. */
  rrule: string | null;
  exdates: string[];
}

// ── Часовые пояса через Intl: без библиотек и без таблиц поясов ──
const partsFmt = new Map<string, Intl.DateTimeFormat>();
function zoneParts(tz: string, ms: number) {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    partsFmt.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}
const safeTz = (tz: string | undefined) => {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
};

/** Местные дата и время в поясе tz → момент UTC (мс). Два прохода — чтобы попасть в переход на летнее время. */
export function zonedToUtc(day: string, hm: string, tz: string): number {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const [h = 0, mi = 0, s = 0] = hm.split(':').map(Number);
  const local = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = local;
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(tz, guess);
    const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - guess;
    guess = local - offset;
  }
  return guess;
}

/** Момент UTC → день и «HH:MM» в поясе tz. */
export function utcToZoned(ms: number, tz: string): { day: string; time: string } {
  const p = zoneParts(tz, ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { day: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

// ── Разбор ──
interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(ics: string): string[] {
  return ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=V;PARAM="V:V":VALUE — двоеточие внутри кавычек параметра не разделитель.
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name = '', ...rawParams] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const [k, ...v] = p.split('=');
    if (k) params[k.toUpperCase()] = v.join('=').replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
export const escapeText = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** DTSTART/EXDATE/RECURRENCE-ID → день и время человека (у дат без времени — только день). */
function readMoment(p: Prop, userTz: string): { day: string; time: string | null } | null {
  const v = p.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (p.params.VALUE === 'DATE' || !m[4]) return { day, time: null };
  const hm = `${m[4]}:${m[5]}:${m[6]}`;
  // UTC («Z»), свой пояс события (TZID) или «плавающее» время — тогда считаем, что оно уже в поясе человека.
  const zone = m[7] ? 'UTC' : safeTz(p.params.TZID);
  if (!zone) return { day, time: hm.slice(0, 5) };
  return utcToZoned(zone === 'UTC' ? Date.parse(`${day}T${hm}Z`) : zonedToUtc(day, hm, zone), userTz);
}

/** PT1H30M, P1D → минуты. */
function durationMinutes(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m || m[1] === '-') return null;
  const total = Number(m[2] ?? 0) * 10080 + Number(m[3] ?? 0) * 1440 + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0);
  return total > 0 ? total : null;
}

/** Строки повтора (RRULE, EXDATE) — так их отдаёт Google в поле recurrence. */
export function parseRecurrence(lines: string[], userTz: string): { rrule: string | null; exdates: string[] } {
  const props = lines.map(parseLine).filter((p): p is Prop => p !== null);
  const rrule = props.find((p) => p.name === 'RRULE')?.value.trim() ?? null;
  const exdates = props
    .filter((p) => p.name === 'EXDATE')
    .flatMap((p) => p.value.split(',').map((v) => readMoment({ ...p, value: v }, userTz)?.day))
    .filter((d): d is string => Boolean(d));
  return { rrule: rrule && parseRRule(rrule) ? rrule : null, exdates };
}

/**
 * Все события из текста календаря (обычно один объект с одним событием и его изменёнными разами).
 * Изменённый раз повторяющегося события (RECURRENCE-ID) становится отдельным делом, а у самого
 * повтора этот день исключается; отменённые (STATUS:CANCELLED) — просто исключаются.
 */
export function parseEvents(ics: string, userTz: string): CalEvent[] {
  const blocks: Prop[][] = [];
  let cur: Prop[] | null = null;
  let depth = 0;
  for (const line of unfold(ics)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') {
      cur = [];
      depth = 0;
      continue;
    }
    if (!cur) continue;
    // Вложенные блоки (VALARM) внутри события пропускаем.
    if (p.name === 'BEGIN') depth++;
    else if (p.name === 'END' && depth > 0) depth--;
    else if (p.name === 'END' && p.value.toUpperCase() === 'VEVENT') {
      blocks.push(cur);
      cur = null;
    } else if (depth === 0) cur.push(p);
  }

  const masters = new Map<string, CalEvent>();
  const overrides: { uid: string; recur: string; event: CalEvent | null }[] = [];
  for (const props of blocks) {
    const get = (n: string) => props.find((p) => p.name === n);
    const uid = get('UID')?.value.trim();
    const start = get('DTSTART');
    if (!uid || !start) continue;
    const at = readMoment(start, userTz);
    if (!at) continue;
    const cancelled = get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED';
    let durationMin: number | null = null;
    const dur = get('DURATION');
    const end = get('DTEND');
    if (dur) durationMin = durationMinutes(dur.value);
    else if (end && at.time) {
      const endAt = readMoment(end, userTz);
      if (endAt?.time) durationMin = Math.round((Date.parse(`${endAt.day}T${endAt.time}:00Z`) - Date.parse(`${at.day}T${at.time}:00Z`)) / 60000) || null;
    }
    const rrule = get('RRULE')?.value.trim() ?? null;
    const exdates = props
      .filter((p) => p.name === 'EXDATE')
      .flatMap((p) => p.value.split(',').map((v) => readMoment({ ...p, value: v }, userTz)?.day))
      .filter((d): d is string => Boolean(d));
    const event: CalEvent = {
      uid,
      title: unescape(get('SUMMARY')?.value ?? '').trim().slice(0, 120) || '—',
      day: at.day,
      time: at.time,
      durationMin: durationMin && durationMin > 0 && durationMin <= 20160 ? durationMin : null,
      rrule: rrule && parseRRule(rrule) ? rrule : null,
      exdates,
    };
    const recurrenceId = get('RECURRENCE-ID');
    if (recurrenceId) {
      const recur = readMoment(recurrenceId, userTz)?.day;
      if (recur) overrides.push({ uid, recur, event: cancelled ? null : { ...event, uid: `${uid}#${recur}`, rrule: null, exdates: [] } });
    } else if (!cancelled) masters.set(uid, event);
  }

  const out = [...masters.values()];
  for (const o of overrides) {
    const master = masters.get(o.uid);
    if (master && !master.exdates.includes(o.recur)) master.exdates.push(o.recur);
    if (o.event) out.push(o.event);
  }
  return out;
}

// ── Сборка ──
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateValue = (day: string) => day.replace(/-/g, '');
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Свёртка длинных строк по 75 байт, как требует формат. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

/** Строки начала и конца события: весь день — датами, со временем — моментом UTC. */
function whenLines(day: string, time: string | null, durationMin: number | null, tz: string): string[] {
  if (!time) return [`DTSTART;VALUE=DATE:${dateValue(day)}`, `DTEND;VALUE=DATE:${dateValue(nextDay(day))}`];
  return [`DTSTART:${stamp(zonedToUtc(day, time, tz))}`, `DURATION:PT${durationMin ?? 30}M`];
}

export interface OwnEvent {
  uid: string;
  title: string;
  day: string;
  time: string | null;
  durationMin: number | null;
  /** Часовой пояс человека. */
  tz: string;
}

/** Наше дело → событие календаря. */
export function buildEvent(e: OwnEvent, now = Date.now()): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LifeCommit//RU',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `SUMMARY:${escapeText(e.title)}`,
    ...whenLines(e.day, e.time, e.durationMin, e.tz),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}

/**
 * Правка чужого события (пришло из календаря): меняем только название и время в основном событии,
 * всё остальное — повтор, приглашённых, напоминания — оставляем как было.
 * day не трогаем у повторяющихся: он задаёт, в какие дни событие бывает.
 */
export function patchEvent(ics: string, change: { title: string; day: string; time: string | null; durationMin: number | null; tz: string; recurring: boolean }, now = Date.now()): string {
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out: string[] = [];
  let inEvent = false;
  let isMaster = true;
  let block: string[] = [];
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      inEvent = true;
      isMaster = true;
      block = [line];
      continue;
    }
    if (!inEvent) {
      out.push(line);
      continue;
    }
    block.push(line);
    if (upper.startsWith('RECURRENCE-ID')) isMaster = false;
    if (upper === 'END:VEVENT') {
      inEvent = false;
      if (!isMaster) {
        out.push(...block);
        continue;
      }
      const startLine = block.find((l) => /^DTSTART[;:]/i.test(l));
      const startDay = startLine ? (/(\d{4})(\d{2})(\d{2})/.exec(startLine.split(':').pop() ?? '') ?? []).slice(1, 4).join('-') : change.day;
      const day = change.recurring ? startDay || change.day : change.day;
      const kept = block.filter((l) => !/^(SUMMARY|DTSTART|DTEND|DURATION|DTSTAMP)[;:]/i.test(l) && !/^(BEGIN|END):VEVENT$/i.test(l));
      out.push('BEGIN:VEVENT', `DTSTAMP:${stamp(now)}`, `SUMMARY:${escapeText(change.title)}`, ...whenLines(day, change.time, change.durationMin, change.tz), ...kept, 'END:VEVENT');
    }
  }
  return out.filter((l, i, a) => l || i < a.length - 1).map(fold).join('\r\n');
}
