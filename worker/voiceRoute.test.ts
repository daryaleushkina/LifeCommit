import { describe, expect, it } from 'vitest';
import { groupsOf, namedPeople, routeVoice, titleMentioned, type VoiceGroup } from './voiceRoute';

const groups: VoiceGroup[] = [
  { id: 1, title: 'Тестим бота', members: [{ id: 10, name: 'Даша' }, { id: 11, name: 'Алёна' }, { id: 12, name: 'Петя' }] },
  { id: 2, title: 'Семья', members: [{ id: 10, name: 'Даша' }, { id: 13, name: 'Мама' }] },
];

describe('куда сказано', () => {
  it('название группы во фразе — в падежах и с большой буквы', () => {
    expect(titleMentioned('Добавь в группу Тестим бота: Алёне погулять', 'Тестим бота')).toBe(true);
    expect(titleMentioned('в семью купить хлеб', 'Семья')).toBe(true);
    expect(titleMentioned('купить хлеб', 'Семья')).toBe(false);
  });
  it('группа по названию — явно', () => {
    expect(groupsOf('в группу тестим бота Алёне погулять', groups, 10, null)).toEqual({ list: [groups[0]], explicit: true });
  });
  it('без названия — по экрану группы', () => {
    expect(groupsOf('Алёне погулять с Плюшей', groups, 10, 2).list.map((g) => g.id)).toEqual([2]);
  });
  it('без названия и экрана — по имени участника одной группы', () => {
    expect(groupsOf('Завтра Алёне погулять с Плюшей', groups, 10, null).list.map((g) => g.id)).toEqual([1]);
  });
  it('своё имя и обычные слова группу не выбирают', () => {
    expect(groupsOf('Купить молоко и позвонить. Машину помыть', groups, 10, null).list).toEqual([]);
  });
  it('имена с большой буквы — не первые слова предложений', () => {
    expect(namedPeople('Завтра Алёне погулять. Купить корм Тесле')).toEqual(['Алёне', 'Тесле']);
  });
});

// Живой разбор моделью: GEMINI_API_KEY=… pnpm test (без ключа пропускается).
const key = process.env.GEMINI_API_KEY;
describe.skipIf(!key)('голос в группу — живая модель', () => {
  const env = { GEMINI_API_KEY: key } as never;
  it('«добавь в группу Тестим бота» — дела группе, Алёне — Алёне, себе — себе', async () => {
    const r = await routeVoice(env, 'Добавь в группу Тестим бота: Алёне погулять с Плюшей, а нам вдвоём с Петей сходить погулять каждому. И себе завтра купить молоко.', '2026-10-02', 10, groups, null);
    const items = r.groups[0]?.items ?? [];
    expect(r.groups.map((g) => g.group.id)).toEqual([1]);
    expect(items.some((d) => d.assignees.includes(11))).toBe(true);
    expect(r.todos.map((d) => d.title.toLowerCase()).join()).toContain('молок');
    expect(r.todos.some((d) => /плюш/i.test(d.title))).toBe(false);
  }, 30_000);
});
