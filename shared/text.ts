// Текст человека, который видят другие: названия дел, привычек, групп и групповых дел, имена — друзья, участники групп,
// бот пишет их в чаты. Невидимые и управляющие символы подменяют вид строки: U+202E переворачивает её, нулевая ширина
// прячет склейки, «пустое» имя из филлера выглядит как отсутствие имени. Решение владелицы 04.10.2026: вычищать при записи.

/** Пробельные управляющие (переводы строк, табуляция, разделители строк) — в обычный пробел. */
const SPACE = /[\t\n\v\f\r\u0085\u2028\u2029]/u;
/** Остальные управляющие C0/C1 и DEL — убрать. */
const CONTROL = /\p{Cc}/u;
/**
 * Невидимые «форматные» (Cf: нулевая ширина U+200B–U+200D, смена направления U+202A–U+202E и U+2066–U+2069,
 * U+2060–U+2064, U+FEFF, мягкий перенос U+00AD, U+180E, теги U+E0000–U+E007F), невидимый соединитель графем U+034F
 * и корейские филлеры, которыми делают «пустые» имена.
 */
const INVISIBLE = /[\p{Cf}\u034F\u115F\u1160\u3164\uFFA0]/u;
const PICTO = /\p{Extended_Pictographic}/u;
/** Что может стоять перед ZWJ внутри эмодзи: сам рисунок, VS16 или оттенок кожи. */
const BEFORE_ZWJ = /[\p{Extended_Pictographic}\uFE0F\u{1F3FB}-\u{1F3FF}]/u;
const TAG = /[\u{E0020}-\u{E007F}]/u;
const BLACK_FLAG = '\u{1F3F4}';

/**
 * Вычистить текст человека: без невидимых и управляющих символов, в NFC, пробелы схлопнуты, края обрезаны.
 * Эмодзи не ломаются: ZWJ внутри последовательности (👨‍👩‍👧, 🏳️‍🌈, 👩\u{1F3FD}‍💻) и теги флагов (🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}) остаются.
 * max — длина в единицах UTF-16, как у прежних .slice(0, n); режется по целым символам, без половинок эмодзи.
 */
export function cleanText(raw: string, max?: number): string {
  const chars = [...raw.normalize('NFC')];
  let out = '';
  let prev = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (SPACE.test(ch)) {
      out += ' ';
      prev = ' ';
      continue;
    }
    if (CONTROL.test(ch)) continue;
    if (INVISIBLE.test(ch)) {
      const zwjInEmoji = ch === '\u200D' && BEFORE_ZWJ.test(prev) && PICTO.test(chars[i + 1] ?? '');
      const flagTag = TAG.test(ch) && (prev === BLACK_FLAG || TAG.test(prev));
      if (!zwjInEmoji && !flagTag) continue;
    }
    out += ch;
    prev = ch;
  }
  out = out.replace(/\s+/gu, ' ').trim();
  if (max === undefined || out.length <= max) return out;
  let cut = '';
  for (const ch of out) {
    if (cut.length + ch.length > max) break;
    cut += ch;
  }
  return cut.replace(/\u200D+$/u, '').trimEnd();
}

const SKIN = /[\u{1F3FB}-\u{1F3FF}]/u;
const REGIONAL = /[\u{1F1E6}-\u{1F1FF}]/u;

/**
 * Строка по видимым символам (графемам): эмодзи-семья, флаг, «рисунок + оттенок кожи» — один символ, а не части.
 * Значок группы, аватарка без фото и обрезка названий на картинках брали `slice` по UTF-16 — от эмодзи оставалась
 * половинка суррогатной пары (/lc-explore, 04.10.2026). Intl.Segmenter есть в Telegram на iOS 14.5+ и Android;
 * без него — по символам, склеивая то, что внутри эмодзи-последовательности.
 */
export function graphemes(s: string): string[] {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
  const out: string[] = [];
  for (const ch of s) {
    const last = out.at(-1) ?? '';
    const lastCh = [...last].at(-1) ?? '';
    const glue =
      ch === '\u200D' ||
      ch === '\uFE0F' ||
      SKIN.test(ch) ||
      TAG.test(ch) ||
      (lastCh === '\u200D' && PICTO.test(ch)) ||
      // Флаг — пара региональных букв: вторая приклеивается к первой, третья начинает новый флаг.
      (REGIONAL.test(ch) && REGIONAL.test(lastCh) && [...last].length === 1);
    if (glue && last) out[out.length - 1] = last + ch;
    else out.push(ch);
  }
  return out;
}

/** Первый видимый символ — буква в кружке аватарки или значке группы. */
export const firstGrapheme = (s: string): string => graphemes(s)[0] ?? '';
