// Голос в мини-аппе: куда сказано — себе или в группу (worker/voiceRoute.ts), с настоящими группами из базы.
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, logicalDay } from './day';
import { ai, dbReady, net, sb, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('voice-тесты пропущены: нет локальной Supabase (pnpm db:start)');

const GEMINI = 'https://generativelanguage.googleapis.com/';
const GROUP_SYSTEM = 'You turn a message from a group chat';

beforeEach(() => {
  ai.transcript = 'купить молоко';
  ai.parse = '{"habits":[],"todos":[]}';
});

/** Группа из базы: первый — владелец. Удаляется вместе с владельцем (harness убирает группы тестовых пользователей). */
async function group(title: string, people: TestUser[], archived = false): Promise<number> {
  const { data, error } = await sb
    .from('groups')
    .insert({ title, owner_id: people[0]!.id, kind: 'other', ...(archived && { archived_at: new Date().toISOString() }) })
    .select('id')
    .single<{ id: number }>();
  if (error) throw error;
  await sb.from('group_members').insert(people.map((p, i) => ({ group_id: data.id, user_id: p.id, role: i === 0 ? 'owner' : 'member' })));
  return data.id;
}

interface Prompt {
  group: boolean;
  input: string;
}

/**
 * Gemini: личный разбор отвечает personal, групповой — group(строка запроса).
 * Что спрашивали — в prompts.
 */
function models(personal: object, group: (input: string) => object = () => ({ items: [] })): Prompt[] {
  const prompts: Prompt[] = [];
  net.on(GEMINI, async (req) => {
    const body = (await req.json()) as { systemInstruction: { parts: { text: string }[] }; contents: { parts: { text: string }[] }[] };
    const isGroup = body.systemInstruction.parts[0]!.text.startsWith(GROUP_SYSTEM);
    const input = body.contents.at(-1)!.parts[0]!.text;
    prompts.push({ group: isGroup, input });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(isGroup ? group(input) : personal) }] } }] });
  });
  return prompts;
}

const item = (title: string, more: object = {}) => ({ title, mode: 'one', people: [], rotate: false, repeat: 'once', weekdays: [], day: null, time: null, duration: null, target: null, unit: null, currency: null, ...more });
const todo = (title: string, day = '') => ({ title, day, time: '', duration: 0, location: '' });
const habit = (title: string) => ({ title, kind: 'check', target: 0, unit: '', schedule: 'daily', weekdays: [], per_week: 0 });

/** Наговорить в микрофон (с экрана группы — screen). Ответ — строки NDJSON. */
async function speak(u: TestUser, screen?: number) {
  const res = await u.call<string>('POST', `/voice${screen ? `?group=${screen}` : ''}`, new Blob([new Uint8Array([1, 2, 3])]));
  expect(res.status).toBe(200);
  const events = res.body.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { text?: string; actions?: Record<string, unknown>[]; error?: string });
  return { text: events[0]!.text, actions: events[1]!.actions! };
}

describe.skipIf(!ready)('голос: себе или в группу', () => {
  it('группа названа: дела группе с исполнителями, личное — себе, сказанное группе не дублируется', async () => {
    const me = await user({ name: 'Даша' });
    const alena = await user({ name: 'Алёна' });
    const petya = await user({ name: 'Петя' });
    const g = await group('Тестим бота', [me, alena, petya]);
    const day = logicalDay('Europe/Moscow', 4);
    ai.transcript = 'Добавь в группу Тестим бота: Алёне погулять с Плюшей, мне купить корм. И себе завтра купить молоко';
    const prompts = models(
      // личный разбор ошибся и взял дела группы — их отбрасываем
      { habits: [habit('Купить корм')], todos: [todo('Купить молоко', addDays(day, 1)), todo('Погулять с Плюшей')] },
      () => ({ items: [item('Погулять с Плюшей', { mode: 'assign', people: ['Алёна'] }), item('Купить корм', { mode: 'assign', people: ['Даша'] })] }),
    );
    const { text, actions } = await speak(me);
    expect(text).toBe(ai.transcript);
    expect(actions).toEqual([
      { type: 'create_group_item', group: { id: g, title: 'Тестим бота' }, item: expect.objectContaining({ title: 'Погулять с Плюшей', mode: 'assign', assignees: [alena.id] }), names: ['Алёна'] },
      // «мне» — сам говорящий: имя пустое
      { type: 'create_group_item', group: { id: g, title: 'Тестим бота' }, item: expect.objectContaining({ title: 'Купить корм', assignees: [me.id] }), names: [''] },
      { type: 'create_todo', todo: expect.objectContaining({ title: 'Купить молоко', day: addDays(day, 1) }) },
    ]);
    const personal = prompts.find((p) => !p.group)!.input;
    expect(personal).toMatch(/^Groups: Тестим бота \((Алёна, Петя|Петя, Алёна)\)\nToday is /);
    const forGroup = prompts.find((p) => p.group)!.input;
    expect(forGroup).toMatch(/^Only for group: Тестим бота\. Take only what is meant for this group; skip what the speaker keeps for themselves/);
    expect(forGroup).toContain('Speaker: Даша');
    for (const name of ['Даша', 'Алёна', 'Петя']) expect(forGroup).toContain(name);
  });

  it('две группы названы: каждая получает своё, пустая в ответ не попадает', async () => {
    const me = await user({ name: 'Даша' });
    const alena = await user({ name: 'Алёна' });
    const family = await group('Семья', [me]);
    await group('Тестим бота', [me, alena]);
    ai.transcript = 'В семью купить хлеб, а в группу Тестим бота ничего';
    const prompts = models({ habits: [], todos: [] }, (input) => (input.startsWith('Only for group: Семья') ? { items: [item('Купить хлеб')] } : { items: [] }));
    const { actions } = await speak(me);
    expect(actions).toEqual([{ type: 'create_group_item', group: { id: family, title: 'Семья' }, item: expect.objectContaining({ title: 'Купить хлеб', mode: 'one' }), names: [] }]);
    expect(prompts.filter((p) => p.group)).toHaveLength(2);
    expect(prompts.find((p) => p.input.startsWith('Only for group: Семья'))!.input).toContain(' — not for Тестим бота');
  });

  it('с экрана группы, без названия и без личного — только группе, личный разбор не зовём', async () => {
    const me = await user({ name: 'Даша' });
    const mama = await user({ name: 'Мама' });
    const g = await group('Семья', [me, mama]);
    ai.transcript = 'Помыть посуду вечером';
    const prompts = models({ habits: [habit('Не должно попасть')], todos: [] }, () => ({ items: [item('Помыть посуду')] }));
    const { actions } = await speak(me, g);
    expect(actions).toEqual([{ type: 'create_group_item', group: { id: g, title: 'Семья' }, item: expect.objectContaining({ title: 'Помыть посуду' }), names: [] }]);
    expect(prompts.map((p) => p.group)).toEqual([true]);
    expect(prompts[0]!.input).not.toContain('skip what the speaker keeps');
  });

  it('«в группу», а название не расслышали: группа одна — это она; в группе только я — «—» вместо участников', async () => {
    const me = await user({ name: 'Даша' });
    await group('Пробежки', [me]);
    ai.transcript = 'Добавь в группу мне купить кроссовки';
    const prompts = models({ habits: [], todos: [todo('Купить кроссовки')] });
    const { actions } = await speak(me);
    // групповой разбор ничего не нашёл — всё личное
    expect(actions).toEqual([{ type: 'create_todo', todo: expect.objectContaining({ title: 'Купить кроссовки' }) }]);
    expect(prompts.find((p) => !p.group)!.input).toMatch(/^Groups: Пробежки \(—\)\n/);
  });

  it('по имени участника ровно одной группы — ей; архивные группы не в счёт', async () => {
    const me = await user({ name: 'Даша' });
    const alena = await user({ name: 'Алёна' });
    const g = await group('Тестим бота', [me, alena]);
    // в архивной группе Алёна тоже есть — будь она в счёте, имя указывало бы на две группы
    await group('Старая', [me, alena], true);
    // название без слов — по названию не выбирается никогда
    await group('№ 1', [me]);
    ai.transcript = 'Завтра Алёне погулять с Плюшей';
    const prompts = models({ habits: [], todos: [] }, () => ({ items: [item('Погулять с Плюшей', { mode: 'assign', people: ['Алёне'] })] }));
    const { actions } = await speak(me);
    expect(actions).toEqual([{ type: 'create_group_item', group: { id: g, title: 'Тестим бота' }, item: expect.objectContaining({ assignees: [alena.id] }), names: ['Алёна'] }]);
    expect(prompts.map((p) => p.group)).toEqual([true]);
  });

  it('групп нет — обычный личный разбор', async () => {
    const me = await user();
    ai.transcript = 'читать каждый день';
    const prompts = models({ habits: [habit('Читать')], todos: [] });
    const { actions } = await speak(me);
    expect(actions).toEqual([{ type: 'create_habit', habit: expect.objectContaining({ title: 'Читать', kind: 'check' }) }]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.input).toMatch(/^Today is /);
  });
});
