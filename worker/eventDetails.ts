// Подробности события календаря (место, ссылка на созвон, участники, описание) — одинаково для Google и Apple.
// Хранятся в todos.details и видны, когда событие открыли. Описание чистим от разметки и режем:
// приглашения Zoom и Teams бывают на страницу, а нам нужно пару строк.
import type { TodoDetails } from '../shared/types';

export interface RawDetails {
  location?: string | null;
  description?: string | null;
  /** Ссылка на созвон, которую календарь знает отдельно (Meet у Google, URL / X-GOOGLE-CONFERENCE у iCalendar). */
  conference?: string | null;
  attendees?: { name: string; self?: boolean }[];
  openUrl?: string | null;
}

const NOTES_MAX = 600;
const PEOPLE_MAX = 12;

/** Сервисы созвонов: такая ссылка в месте или описании — это «подключиться», а не просто ссылка. */
const MEETING = /https?:\/\/(?:[\w-]+\.)*(?:meet\.google\.com|zoom\.us|zoom\.com|teams\.microsoft\.com|teams\.live\.com|telemost\.yandex\.ru|telemost\.360\.yandex\.ru|webex\.com|whereby\.com|meet\.jit\.si|jazz\.sber\.ru|salutejazz\.ru|ktalk\.ru|t\.me\/call|discord\.gg|facetime\.apple\.com)[^\s<>"')\]]*/i;
const ANY_URL = /https?:\/\/[^\s<>"')\]]+/i;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** HTML описания Google → текст: переносы строк остаются, теги и лишние пробелы — нет. */
export function plainText(s: string): string {
  return s
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1)) || 32) : m))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const clean = (s: string | null | undefined) => (s ? plainText(s) : '');

export function buildDetails(raw: RawDetails): TodoDetails | null {
  let location = clean(raw.location).replace(/\n+/g, ', ');
  const description = clean(raw.description);
  // Ссылка на созвон: отдельное поле календаря, потом — ссылка сервиса созвонов в месте или описании.
  let link = raw.conference?.trim() || MEETING.exec(location)?.[0] || MEETING.exec(description)?.[0] || '';
  // Место — одна ссылка: это не место, а ссылка.
  if (/^https?:\/\/\S+$/i.test(location)) {
    link ||= location;
    location = '';
  }
  link ||= ANY_URL.exec(description)?.[0] ?? '';
  // Описание, в котором только та же ссылка, ничего не добавляет.
  let notes = description;
  if (link && notes.replace(link, '').trim() === '') notes = '';
  if (notes.length > NOTES_MAX) notes = `${notes.slice(0, NOTES_MAX - 1).trimEnd()}…`;

  const attendees = raw.attendees ?? [];
  const people = attendees
    .filter((a) => !a.self)
    .map((a) => a.name.trim())
    .filter(Boolean)
    .slice(0, PEOPLE_MAX);

  const out: TodoDetails = {};
  if (location) out.location = location.slice(0, 200);
  if (link) out.link = link.slice(0, 500);
  // Одного себя участником не считаем: это просто моё событие.
  if (attendees.length > 1) {
    out.people_count = attendees.length;
    if (people.length) out.people = people;
  }
  if (notes) out.notes = notes;
  if (raw.openUrl) out.open_url = raw.openUrl.slice(0, 500);
  return Object.keys(out).length ? out : null;
}

/** Имя участника: подпись или почта до «@». */
export const personName = (displayName: string | null | undefined, email: string | null | undefined) =>
  displayName?.trim() || (email ?? '').replace(/^mailto:/i, '').split('@')[0] || '';
