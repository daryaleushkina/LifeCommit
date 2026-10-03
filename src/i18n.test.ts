// Словари: русский и английский одинаковы по составу, все подписи-функции дают строку, склонения верные.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dictionaries, LangContext, useT, type Lang } from './i18n';

const ru = dictionaries.ru;
const en = dictionaries.en;

/** Все листья словаря: путь и значение. */
function leaves(obj: unknown, path = ''): [string, unknown][] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [[path, obj]];
}

describe('словари', () => {
  it('у английского те же ключи и те же виды значений, что у русского', () => {
    const shape = (d: object) => leaves(d).map(([p, v]) => `${p}:${Array.isArray(v) ? `array${(v as unknown[]).length}` : typeof v}`).sort();
    expect(shape(en)).toEqual(shape(ru));
  });

  it('нет пустых строк', () => {
    for (const [lang, d] of Object.entries(dictionaries)) {
      for (const [p, v] of leaves(d)) {
        if (typeof v === 'string') expect(v.trim(), `${lang}.${p}`).not.toBe('');
      }
    }
  });

  // Числа под все ветки (1 — «день», 2 — «дня», 5 и 11 — «дней», 0 — «нет мест» и т. п.); первое — ещё и номер месяца, до 11.
  const argSets: number[][] = [[1, 2], [2, 0], [0, 5], [5, 1], [11, 11], [3, 21], [0, 0], [4, 112]];

  it('каждая подпись-функция возвращает строку без undefined и NaN', () => {
    for (const [lang, d] of Object.entries(dictionaries)) {
      for (const [p, v] of leaves(d)) {
        if (typeof v !== 'function') continue;
        for (const args of argSets) {
          const fn = v as (...a: unknown[]) => unknown;
          const out = fn(...args);
          // Имена (rotateHint, from) проходят как есть — проверяем строкой.
          if (typeof out !== 'string') {
            expect(fn('Аня'), `${lang}.${p}`).toBe('Аня');
            continue;
          }
          expect(out as string, `${lang}.${p}(${args})`).not.toMatch(/undefined|NaN/);
        }
      }
    }
  });

  it('русские склонения', () => {
    const forms = [1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112, 122].map((n) => `${n} ${ru.share.days(n)}`);
    expect(forms).toEqual(['1 день', '2 дня', '4 дня', '5 дней', '11 дней', '12 дней', '14 дней', '21 день', '22 дня', '25 дней', '101 день', '111 дней', '112 дней', '122 дня']);
    expect(ru.perWeek(3)).toBe('3 раза в неделю');
    expect(ru.activeDays(1)).toBe('1 активный день');
    expect(ru.gr.people(5)).toBe('5 человек');
  });

  it('«из 31 дня», «из 30 дней», «из 11 дней»', () => {
    expect(ru.share.daysOf(31)).toBe('дня');
    expect(ru.share.daysOf(30)).toBe('дней');
    expect(ru.share.daysOf(11)).toBe('дней');
    expect(en.share.daysOf(1)).toBe('day');
    expect(en.share.daysOf(31)).toBe('days');
  });

  it('числа: разряды с тысяч через неразрывный пробел, до двух знаков после запятой', () => {
    expect(ru.num(146)).toBe('146');
    expect(ru.num(1146)).toBe('1 146');
    expect(ru.num(2.555)).toBe('2,56');
    expect(en.num(25546)).toBe('25,546');
  });

  it('кнопка голоса: всё вперемешку, только дела, только привычки', () => {
    expect(ru.voice.addN(2, 3)).toBe('Добавить всё · 5');
    expect(ru.voice.addN(2, 0)).toBe('Добавить 2 дела');
    expect(ru.voice.addN(0, 1)).toBe('Добавить 1 привычку');
    expect(en.voice.addN(1, 0)).toBe('Add 1 to-do');
    expect(en.voice.addN(0, 2)).toBe('Add 2 habits');
    expect(en.voice.addN(0, 1)).toBe('Add 1 habit');
  });

  it('лимит привычек: места нет и место есть', () => {
    expect(ru.voice.wontFit(0, 5)).toContain('все места заняты');
    expect(ru.voice.wontFit(2, 5)).toContain('добавятся первые 2');
    expect(en.voice.wontFit(0, 5)).toContain('all taken');
  });

  it('единица — если есть', () => {
    expect(ru.goalLine(8, 'стаканов')).toBe('Цель — 8 стаканов в день');
    expect(ru.goalLine(8, null)).toBe('Цель — 8 в день');
    expect(ru.statAvg(null)).toBe('раз в день в среднем');
    expect(ru.statAvg('км')).toBe('км в день в среднем');
    expect(en.statAvg(null)).toBe('times a day on average');
  });

  it('месяцы в нужном падеже', () => {
    expect(ru.share.inMonth(9)).toBe('в октябре');
    expect(ru.share.workMonth(0)).toBe('работы над собой в январе');
    expect(ru.share.myMonth(11)).toBe('Мой декабрь');
    expect(en.share.monthName(4)).toBe('May');
  });
});

describe('useT', () => {
  const Probe = () => createElement('b', null, useT().today);
  const html = (lang?: Lang) =>
    renderToStaticMarkup(lang ? createElement(LangContext.Provider, { value: lang }, createElement(Probe)) : createElement(Probe));

  it('берёт язык из контекста, по умолчанию — русский', () => {
    expect(html()).toBe('<b>Сегодня</b>');
    expect(html('ru')).toBe('<b>Сегодня</b>');
    expect(html('en')).toBe('<b>Today</b>');
  });
});
