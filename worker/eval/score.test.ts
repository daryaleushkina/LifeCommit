import { describe, expect, it } from 'vitest';
import type { GroupItemDraft } from '../../shared/groups';
import type { TaskInput } from '../../shared/types';
import { addDays } from '../day';
import type { ActualGroupItem, ActualVoice } from './score';
import { caseToday, fromDrafts, fromParsed, fromRouted, normText, passAll, scoreVoiceCase, summarize, textMatches, weekdayMask } from './score';
import { CASES } from './voice.cases';

const habit = (h: Partial<TaskInput> & { title: string }): TaskInput => ({ kind: 'check', target: 1, unit: null, schedule: 'daily', weekdays: 127, per_week: null, ...h });
const item = (i: Partial<ActualGroupItem> & { title: string }): ActualGroupItem => ({
  mode: 'one',
  people: [],
  all: false,
  rotate: false,
  day: '2026-11-17',
  time: null,
  rrule: null,
  target: null,
  unit: null,
  duration_min: null,
  ...i,
});
const actual = (a: Partial<ActualVoice>): ActualVoice => ({ habits: [], todos: [], groups: [], ...a });
const draft = (d: Partial<GroupItemDraft> & { title: string }): GroupItemDraft => ({
  mode: 'one',
  day: '2026-11-17',
  time: null,
  rrule: null,
  assignees: [],
  all_members: false,
  rotate: false,
  target: null,
  unit: null,
  duration_min: null,
  ...d,
});

describe('сравнение текста', () => {
  it('без регистра, ё = е, без знаков', () => {
    expect(normText('  Планёрка,  в 9!  ')).toBe('планерка в 9');
    expect(textMatches('планерк', 'Планёрка')).toBe(true);
    expect(textMatches('молок', 'Купить хлеб')).toBe(false);
    expect(textMatches(/ри[еэ]лтор/i, 'Встреча с риэлтором')).toBe(true);
    expect(textMatches('кофе', null)).toBe(false);
    // знак валюты нормализация стёрла бы — сравниваем как есть
    expect(textMatches('₽', '₽')).toBe(true);
    expect(textMatches('₽', '$')).toBe(false);
  });
  it('дни недели — в маску, как у привычек', () => {
    expect(weekdayMask([1, 3, 5])).toBe(0b0010101);
    expect(weekdayMask([6, 7])).toBe(0b1100000);
  });
});

describe('scoreVoiceCase: привычки', () => {
  it('всё совпало — зелёный', () => {
    const got = scoreVoiceCase(
      { today: '2026-11-17', habits: [{ title: 'вод', kind: 'count', target: 8, unit: 'стакан', schedule: 'daily', weekdays: [1, 2, 3, 4, 5, 6, 7], per_week: null }] },
      actual({ habits: [habit({ title: 'Вода', kind: 'count', target: 8, unit: 'стаканов' })] }),
    );
    expect(got).toEqual({ pass: true, diffs: [] });
  });
  it('называет каждое неверное поле', () => {
    const got = scoreVoiceCase(
      {
        today: '2026-11-17',
        habits: [
          { title: 'бег', kind: 'count', target: 5, unit: 'км', schedule: 'weekdays', weekdays: [1, 3], per_week: 2 },
          { title: 'йог', unit: null },
        ],
      },
      actual({ habits: [habit({ title: 'Бег', weekdays: 0b101 | 0b1000 }), habit({ title: 'Йога', unit: 'раз' })] }),
    );
    expect(got.pass).toBe(false);
    expect(got.diffs).toEqual([
      'привычки «Бег».kind: ждали count, пришло check',
      'привычки «Бег».target: ждали 5, пришло 1',
      'привычки «Бег».unit: ждали км, пришло —',
      'привычки «Бег».schedule: ждали weekdays, пришло daily',
      'привычки «Бег».weekdays: ждали 1,3, пришло 13',
      'привычки «Бег».per_week: ждали 2, пришло —',
      'привычки «Йога».unit: ждали —, пришло раз',
    ]);
  });
  it('не найденное и лишнее', () => {
    const got = scoreVoiceCase({ today: '2026-11-17', habits: [{ title: /газиров/i }] }, actual({ habits: [habit({ title: 'Сладкое' })] }));
    expect(got.diffs).toEqual(['привычки: нет «/газиров/i» (есть: «Сладкое»)', 'привычки: лишнее «Сладкое»']);
    expect(scoreVoiceCase({ today: '2026-11-17', habits: [{ title: 'йог' }] }, actual({})).diffs).toEqual(['привычки: нет «йог»']);
  });
  it('[] — ничего быть не должно; не указано — не проверяем', () => {
    expect(scoreVoiceCase({ today: '2026-11-17', habits: [] }, actual({ habits: [habit({ title: 'Вода' })] })).diffs).toEqual(['привычки: лишнее «Вода»']);
    expect(scoreVoiceCase({ today: '2026-11-17' }, actual({ habits: [habit({ title: 'Вода' })], todos: [{ title: 'Хлеб' }] })).pass).toBe(true);
  });
});

describe('scoreVoiceCase: дела', () => {
  it('дело без дня — это сегодня', () => {
    expect(scoreVoiceCase({ today: '2026-11-17', todos: [{ title: 'хлеб', day: '2026-11-17', time: null }] }, actual({ todos: [{ title: 'Купить хлеб', day: null }] })).pass).toBe(true);
    expect(scoreVoiceCase({ today: '2026-11-17', todos: [{ title: 'хлеб', day: '2026-11-17', time: null }] }, actual({ todos: [{ title: 'Купить хлеб', day: '', time: '' }] })).pass).toBe(true);
  });
  it('пустое место — это «не сказано»', () => {
    expect(scoreVoiceCase({ today: '2026-11-17', todos: [{ title: 'посылк', location: 'почт' }] }, actual({ todos: [{ title: 'Посылка', location: '' }] })).diffs).toEqual([
      'дела «Посылка».location: ждали почт, пришло —',
    ]);
  });
  it('время, длительность и место', () => {
    const got = scoreVoiceCase(
      { today: '2026-11-17', todos: [{ title: 'кофе', day: '2026-11-18', time: '18:00', duration_min: 60, location: 'зерно' }] },
      actual({ todos: [{ title: 'Кофе с Олей', day: '2026-11-19', time: '06:00', location: 'Кофейня' }] }),
    );
    expect(got.diffs).toEqual([
      'дела «Кофе с Олей».day: ждали 2026-11-18, пришло 2026-11-19',
      'дела «Кофе с Олей».time: ждали 18:00, пришло 06:00',
      'дела «Кофе с Олей».duration_min: ждали 60, пришло —',
      'дела «Кофе с Олей».location: ждали зерно, пришло Кофейня',
    ]);
  });
  it('лишнее время, которого не говорили', () => {
    expect(scoreVoiceCase({ today: '2026-11-17', todos: [{ title: 'молок', time: null }] }, actual({ todos: [{ title: 'Молоко', time: '09:00' }] })).diffs).toEqual([
      'дела «Молоко».time: ждали —, пришло 09:00',
    ]);
  });
  it('одинаковые названия разбираются по порядку', () => {
    const got = scoreVoiceCase(
      { today: '2026-11-17', todos: [{ title: 'звонок', day: '2026-11-18' }, { title: 'звонок', day: '2026-11-19' }] },
      actual({ todos: [{ title: 'Звонок', day: '2026-11-18' }, { title: 'Звонок', day: '2026-11-19' }] }),
    );
    expect(got.pass).toBe(true);
  });
});

describe('scoreVoiceCase: группы', () => {
  const groups = [{ title: 'Семья', items: [item({ title: 'Мыть посуду', mode: 'assign', people: ['Петя', 'Алёна'], rotate: true, rrule: 'FREQ=DAILY' })] }];
  it('имена без порядка и регистра, ё = е', () => {
    const got = scoreVoiceCase(
      { today: '2026-11-17', groups: [{ title: 'семья', items: [{ title: 'посуд', mode: 'assign', people: ['Алена', 'петя'], rotate: true, rrule: 'FREQ=DAILY', unit: null }] }] },
      actual({ groups }),
    );
    expect(got).toEqual({ pass: true, diffs: [] });
    // не указали людей — их не проверяем
    expect(scoreVoiceCase({ today: '2026-11-17', groups: [{ title: 'Семья', items: [{ title: 'посуд' }] }] }, actual({ groups })).pass).toBe(true);
  });
  it('каждое поле группового дела', () => {
    const got = scoreVoiceCase(
      {
        today: '2026-11-17',
        groups: [
          {
            title: 'Семья',
            items: [{ title: 'посуд', mode: 'one', people: ['Петя'], all: true, rotate: false, day: '2026-11-18', time: '20:00', rrule: null, target: 5, unit: '₽', duration_min: 30 }],
          },
        ],
      },
      actual({ groups }),
    );
    expect(got.diffs).toEqual([
      'группа «Семья» «Мыть посуду».mode: ждали one, пришло assign',
      'группа «Семья» «Мыть посуду».people: ждали петя, пришло алена, петя',
      'группа «Семья» «Мыть посуду».all: ждали true, пришло false',
      'группа «Семья» «Мыть посуду».rotate: ждали false, пришло true',
      'группа «Семья» «Мыть посуду».day: ждали 2026-11-18, пришло 2026-11-17',
      'группа «Семья» «Мыть посуду».time: ждали 20:00, пришло —',
      'группа «Семья» «Мыть посуду».rrule: ждали —, пришло FREQ=DAILY',
      'группа «Семья» «Мыть посуду».target: ждали 5, пришло —',
      'группа «Семья» «Мыть посуду».unit: ждали ₽, пришло —',
      'группа «Семья» «Мыть посуду».duration_min: ждали 30, пришло —',
    ]);
  });
  it('нет группы и лишняя группа', () => {
    const got = scoreVoiceCase({ today: '2026-11-17', groups: [{ title: 'Бег', items: [] }] }, actual({ groups }));
    expect(got.diffs).toEqual(['группа «Бег»: нет', 'группа «Семья»: лишняя']);
  });
});

describe('приведение ответов к общему виду', () => {
  it('личный разбор', () => {
    expect(fromParsed({ habits: [], todos: [{ title: 'Хлеб' }] })).toEqual({ habits: [], todos: [{ title: 'Хлеб' }], groups: [] });
  });
  it('черновики группы: имена вместо id, единица цели', () => {
    const members = [
      { id: 1, name: 'Даша' },
      { id: 2, name: 'Алёна' },
    ];
    const g = fromDrafts(
      'Семья',
      [
        draft({ title: 'Посуда', mode: 'assign', assignees: [2, 9], rotate: true }),
        draft({ title: 'Отпуск', mode: 'goal', target: 150_000, unit: { type: 'money', forms: ['₽', '₽', '₽'], currency: '₽' } }),
        draft({ title: 'Бег', mode: 'goal', target: 300, unit: { type: 'custom', forms: ['км', 'км', 'км'] } }),
      ],
      members,
    );
    expect(g.title).toBe('Семья');
    expect(g.items.map((i) => [i.people, i.unit])).toEqual([
      [['Алёна', '#9'], null],
      [[], '₽'],
      [[], 'км'],
    ]);
  });
  it('разбор из мини-аппа: группа без участников в списке — id как есть', () => {
    const a = fromRouted(
      {
        habits: [],
        todos: [],
        by: 'gemini',
        groups: [
          { group: { id: 10, title: 'Семья' }, items: [{ ...draft({ title: 'Мусор', mode: 'assign', assignees: [3] }), names: ['Петя'] }] },
          { group: { id: 99, title: 'Чужая' }, items: [{ ...draft({ title: 'Кино', mode: 'event', assignees: [5] }), names: ['…'] }] },
        ],
      },
      [{ id: 10, members: [{ id: 3, name: 'Петя' }] }],
    );
    expect(a.groups.map((g) => [g.title, g.items[0]!.people])).toEqual([
      ['Семья', ['Петя']],
      ['Чужая', ['#5']],
    ]);
  });
});

describe('итоги', () => {
  it('pass^k — только если зелёные все прогоны', () => {
    expect(passAll([])).toBe(false);
    expect(passAll([{ pass: true }, { pass: true }, { pass: true }])).toBe(true);
    expect(passAll([{ pass: true }, { pass: false }, { pass: true }])).toBe(false);
  });
  it('процент зелёных кейсов', () => {
    expect(summarize([])).toEqual({ passed: 0, total: 0, percent: 0 });
    expect(summarize([{ runs: [{ pass: true }] }, { runs: [{ pass: false }] }, { runs: [{ pass: true }] }])).toEqual({ passed: 2, total: 3, percent: 66.7 });
  });
  it('день кейса: прямо или по моменту и поясу', () => {
    expect(caseToday({ today: '2026-11-17' })).toBe('2026-11-17');
    expect(caseToday({ now: '2026-11-18T01:30:00+03:00', tz: 'Europe/Moscow', startHour: 4 })).toBe('2026-11-17');
    expect(caseToday({ now: '2026-11-17T22:00:00Z', tz: 'Asia/Ho_Chi_Minh', startHour: 4 })).toBe('2026-11-18');
  });
});

describe('эталонные фразы', () => {
  it('49 кейсов: русских 25–45, английских 5–8, микрофон с группами — не меньше 10, id не повторяются', () => {
    expect(CASES).toHaveLength(49);
    const ru = CASES.filter((c) => c.lang === 'ru').length;
    expect(ru).toBeGreaterThanOrEqual(25);
    expect(ru).toBeLessThanOrEqual(45);
    expect(CASES.filter((c) => c.kind === 'route').length).toBeGreaterThanOrEqual(10);
    expect(CASES.length - ru).toBeGreaterThanOrEqual(5);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });
  it('даты в эталонах — настоящие, не раньше «сегодня» и не дальше двух месяцев; дни недели 1–7', () => {
    for (const c of CASES) {
      const today = caseToday(c.when);
      const days =
        c.kind === 'group'
          ? c.expect.items.map((i) => i.day)
          : [...(c.expect.todos ?? []).map((t) => t.day), ...(c.kind === 'route' ? (c.expect.groups ?? []).flatMap((g) => g.items.map((i) => i.day)) : [])];
      for (const d of days.filter((x): x is string => x !== undefined)) {
        expect(addDays(d, 0), `${c.id}: ${d}`).toBe(d);
        expect(d >= today && d <= addDays(today, 62), `${c.id}: ${d}`).toBe(true);
      }
      const weekdays = c.kind === 'group' ? [] : (c.expect.habits ?? []).flatMap((h) => h.weekdays ?? []);
      expect(weekdays.every((w) => w >= 1 && w <= 7), c.id).toBe(true);
      expect(c.text.trim().length, c.id).toBeGreaterThan(0);
    }
  });
  it('у групповых кейсов назначенные люди есть среди участников', () => {
    for (const c of CASES) {
      const members = c.kind === 'group' ? c.members : c.kind === 'route' ? c.groups.flatMap((g) => g.members) : [];
      const items = c.kind === 'group' ? c.expect.items : c.kind === 'route' ? (c.expect.groups ?? []).flatMap((g) => g.items) : [];
      for (const name of items.flatMap((i) => i.people ?? [])) expect(members.some((m) => m.name === name), `${c.id}: ${name}`).toBe(true);
    }
  });
});
