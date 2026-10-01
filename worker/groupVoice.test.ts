import { describe, expect, it } from 'vitest';
import { matchMember, toGroupDrafts } from './groupVoice';

const members = [{ id: 1, name: 'Даша' }, { id: 2, name: 'Алёна' }, { id: 3, name: 'Петя' }];

describe('имена из голоса → участники', () => {
  it('падежи и ё', () => {
    expect(matchMember('Алёне', members)).toBe(2);
    expect(matchMember('Алена', members)).toBe(2);
    expect(matchMember('Алёной', members)).toBe(2);
    expect(matchMember('Пете', members)).toBe(3);
    expect(matchMember('Вася', members)).toBeNull();
  });
});

describe('ответ модели → групповые дела', () => {
  const today = '2026-10-02';
  it('назначенное Алёне, очередь, мероприятие, цель', () => {
    const d = toGroupDrafts({ items: [
      { title: 'Мыть посуду', mode: 'assign', people: ['Алёне'], repeat: 'daily' },
      { title: 'Вынести мусор', mode: 'assign', people: ['я', 'Петя'], rotate: true, repeat: 'days', weekdays: ['TU'] },
      { title: 'Семейный ужин', mode: 'event', people: ['all'], repeat: 'once', day: '2026-10-03', time: '19:00' },
      { title: 'Отпуск', mode: 'goal', repeat: 'once', target: 150000, unit: 'рублей', currency: 'RUB' },
    ] }, today, members, 1, 'копим 150 тысяч рублей на отпуск');
    expect(d[0]).toMatchObject({ mode: 'assign', assignees: [2], all_members: false, rotate: false, rrule: 'FREQ=DAILY' });
    expect(d[1]).toMatchObject({ assignees: [1, 3], rotate: true, rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    expect(d[2]).toMatchObject({ mode: 'event', all_members: true, day: '2026-10-03', time: '19:00' });
    expect(d[3]).toMatchObject({ mode: 'goal', target: 150000, unit: { currency: '₽' } });
  });
  it('незнакомое имя — «кто-то один», а не дело в пустоту; «все» — каждому', () => {
    const d = toGroupDrafts({ items: [
      { title: 'Купить хлеб', mode: 'assign', people: ['Вася'], repeat: 'once' },
      { title: 'Отжаться', mode: 'assign', people: ['all'], repeat: 'weekdays' },
    ] }, today, members, 1);
    expect(d[0]).toMatchObject({ mode: 'one', assignees: [] });
    expect(d[1]).toMatchObject({ mode: 'assign', all_members: true, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
  });
});

describe('валюта цели — только названная', () => {
  const today = '2026-10-02';
  const goal = (unit: string, currency: string | null) => ({ items: [{ title: 'Ноутбук', mode: 'goal', repeat: 'once', target: 50000, unit, currency }] });
  it('рубли, которых не говорили, не ставим; «тысяч» — не единица', () => {
    expect(toGroupDrafts(goal('рублей', 'RUB'), today, members, 1, 'копим 50 тысяч на ноутбук')[0]!.unit).toBeNull();
    expect(toGroupDrafts(goal('тысяч', null), today, members, 1, 'копим 50 тысяч на ноутбук')[0]!.unit).toBeNull();
  });
  it('сказали доллары — ставим $', () => {
    expect(toGroupDrafts(goal('долларов', 'USD'), today, members, 1, 'копим 500 долларов на ноутбук')[0]!.unit).toMatchObject({ currency: '$' });
  });
});
