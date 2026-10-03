import { describe, expect, it } from 'vitest';
import { cleanText } from './text';

describe('cleanText', () => {
  it('обычный текст — как был, края и лишние пробелы убраны', () => {
    expect(cleanText('  Вынести   мусор ')).toBe('Вынести мусор');
    expect(cleanText('')).toBe('');
  });

  it('нулевая ширина, BOM, мягкий перенос, U+180E, U+2060–U+2064 — убраны', () => {
    expect(cleanText('Ма\u200Bма\u200C\u200D \uFEFFпапа\u00AD\u180E\u2060\u2061\u2062\u2063\u2064')).toBe('Мама папа');
  });

  it('смена направления (U+202A–U+202E, U+2066–U+2069, LRM/RLM) — убрана, строка не переворачивается', () => {
    expect(cleanText('счёт\u202Egnp.exe\u202C')).toBe('счётgnp.exe');
    expect(cleanText('\u2066a\u2067b\u2068c\u2069\u202A\u202B\u202Dd\u200E\u200F')).toBe('abcd');
  });

  it('переводы строк, табуляция и разделители строк — в один пробел', () => {
    expect(cleanText('Купить\nхлеб\r\n\tи\u2028молоко\u2029\u0085сыр')).toBe('Купить хлеб и молоко сыр');
  });

  it('прочие управляющие C0/C1 и DEL — убраны без пробела', () => {
    expect(cleanText('a\u0000b\u0007c\u007Fd\u0090e')).toBe('abcde');
  });

  it('«пустое» имя из корейского филлера и невидимого соединителя — пустая строка', () => {
    expect(cleanText('\u3164\u115F\u1160\uFFA0\u034F')).toBe('');
  });

  it('NFC: «й» из двух символов становится одним', () => {
    expect(cleanText('й')).toBe('й');
  });

  it('эмодзи-последовательности с ZWJ остаются целыми', () => {
    for (const e of ['👨\u200D👩\u200D👧', '🏳\uFE0F\u200D🌈', '👩\u{1F3FD}\u200D💻', '❤\uFE0F\u200D🔥', '🧑\u200D🤝\u200D🧑']) {
      expect(cleanText(`Семья ${e}`)).toBe(`Семья ${e}`);
    }
  });

  it('ZWJ не между рисунками — убран: после буквы, перед буквой, в конце', () => {
    expect(cleanText('a\u200D👩')).toBe('a👩');
    expect(cleanText('👩\u200Db')).toBe('👩b');
    expect(cleanText('👩\u200D')).toBe('👩');
  });

  it('флаги: из региональных букв и с тегами (Шотландия) — целы; одинокие теги — убраны', () => {
    expect(cleanText('🇷🇺 🇻🇳')).toBe('🇷🇺 🇻🇳');
    const scotland = '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';
    expect(cleanText(`Поход ${scotland}`)).toBe(`Поход ${scotland}`);
    expect(cleanText('a\u{E0067}\u{E007F}b')).toBe('ab');
  });

  it('max: не длиннее, режется по целым символам, без половинок эмодзи и висящего ZWJ', () => {
    expect(cleanText('Привет мир', 6)).toBe('Привет');
    expect(cleanText('ab😀', 3)).toBe('ab');
    expect(cleanText('👨\u200D👩\u200D👧', 3)).toBe('👨');
    expect(cleanText('Короткое', 80)).toBe('Короткое');
    expect(cleanText('ab cd', 3)).toBe('ab');
  });
});
