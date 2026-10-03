// Голос в мини-аппе: куда сказано — себе или в группу (worker/voiceRoute.ts), с настоящими группами из базы.
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, logicalDay } from './day';
import { ai, dbReady, net, sb, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('voice-тесты пропущены: нет локальной Supabase (pnpm db:start)');

const GEMINI = 'https://generativelanguage.googleapis.com/';
const ROUTE_SYSTEM = 'You sort what a person said';

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
  /** Разбор с группами (а не личный). */
  routed: boolean;
  input: string;
  /** Какие названия групп модель может вернуть. */
  labels: string[] | undefined;
  /** Сколько токенов ответа разрешено. */
  maxTokens: number;
}

/** Gemini отвечает answer на любой вопрос; что спрашивали — в prompts. */
function model(answer: object): Prompt[] {
  const prompts: Prompt[] = [];
  net.on(GEMINI, async (req) => {
    const body = (await req.json()) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { parts: { text: string }[] }[];
      generationConfig: { maxOutputTokens: number; responseSchema: { properties: { group_items?: { items: { properties: { group: { enum: string[] } } } } } } };
    };
    prompts.push({
      routed: body.systemInstruction.parts[0]!.text.startsWith(ROUTE_SYSTEM),
      input: body.contents.at(-1)!.parts[0]!.text,
      labels: body.generationConfig.responseSchema.properties.group_items?.items.properties.group.enum,
      maxTokens: body.generationConfig.maxOutputTokens,
    });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  });
  return prompts;
}

const item = (group: string, title: string, more: object = {}) => ({ group, title, mode: 'one', people: [], rotate: false, repeat: 'once', weekdays: [], day: null, time: null, duration: null, target: null, unit: null, currency: null, ...more });
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
  it('одна фраза — одним запросом: дела группе с исполнителями, своё — себе', async () => {
    const me = await user({ name: 'Даша' });
    const alena = await user({ name: 'Алёна' });
    const petya = await user({ name: 'Петя' });
    const g = await group('Тестим бота', [me, alena, petya]);
    const day = logicalDay('Europe/Moscow', 4);
    ai.transcript = 'Добавь в группу Тестим бота: Алёне погулять с Плюшей, мне купить корм. И себе завтра купить молоко, читать каждый день';
    const prompts = model({
      group_items: [item('Тестим бота', 'Погулять с Плюшей', { mode: 'assign', people: ['Алёна'] }), item('Тестим бота', 'Купить корм', { mode: 'assign', people: ['Даша'] })],
      habits: [habit('Читать')],
      todos: [todo('Купить молоко', addDays(day, 1))],
    });
    const { text, actions } = await speak(me);
    expect(text).toBe(ai.transcript);
    expect(actions).toEqual([
      { type: 'create_group_item', group: { id: g, title: 'Тестим бота' }, item: expect.objectContaining({ title: 'Погулять с Плюшей', mode: 'assign', assignees: [alena.id] }), names: ['Алёна'] },
      // «мне» — сам говорящий: имя пустое
      { type: 'create_group_item', group: { id: g, title: 'Тестим бота' }, item: expect.objectContaining({ title: 'Купить корм', assignees: [me.id] }), names: [''] },
      { type: 'create_todo', todo: expect.objectContaining({ title: 'Купить молоко', day: addDays(day, 1) }) },
      { type: 'create_habit', habit: expect.objectContaining({ title: 'Читать' }) },
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.routed).toBe(true);
    expect(prompts[0]!.labels).toEqual(['Тестим бота']);
    // Всё — свои дела, привычки и дела всех групп — в одном ответе: 1500 токенов длинной диктовке мало.
    expect(prompts[0]!.maxTokens).toBe(4000);
    expect(prompts[0]!.input).toMatch(/^Today is .+\nSpeaker: Даша\nGroups:\n- Тестим бота: Даша \(speaker\), (Алёна, Петя|Петя, Алёна)\nSpeech: Добавь в группу/);
  });

  it('две группы: каждая получает своё, пустая в ответ не попадает; архивные модели не показываем', async () => {
    const me = await user({ name: 'Даша' });
    const alena = await user({ name: 'Алёна' });
    const family = await group('Семья', [me]);
    const bot = await group('Тестим бота', [me, alena]);
    await group('Тестим бота', [me, alena], true);
    await group('Пусто', [me]);
    ai.transcript = 'В семью купить хлеб, а в группу Тестим бота Алёне погулять';
    const prompts = model({
      group_items: [item('Семья', 'Купить хлеб'), item('Тестим бота', 'Погулять', { mode: 'assign', people: ['Алёне'] })],
      habits: [],
      todos: [],
    });
    const { actions } = await speak(me);
    expect(actions).toEqual([
      { type: 'create_group_item', group: { id: family, title: 'Семья' }, item: expect.objectContaining({ title: 'Купить хлеб', mode: 'one' }), names: [] },
      { type: 'create_group_item', group: { id: bot, title: 'Тестим бота' }, item: expect.objectContaining({ title: 'Погулять', assignees: [alena.id] }), names: ['Алёна'] },
    ]);
    // Архивная тёзка не в списке — иначе была бы «Тестим бота (2)».
    expect([...prompts[0]!.labels!].sort()).toEqual(['Пусто', 'Семья', 'Тестим бота']);
  });

  it('с экрана группы — модель знает, откуда нажали микрофон', async () => {
    const me = await user({ name: 'Даша' });
    const mama = await user({ name: 'Мама' });
    await group('Работа', [me]);
    const g = await group('Семья', [me, mama]);
    ai.transcript = 'Помыть посуду вечером, а себе купить витамины';
    const prompts = model({ group_items: [item('Семья', 'Помыть посуду')], habits: [], todos: [todo('Купить витамины')] });
    const { actions } = await speak(me, g);
    expect(actions).toEqual([
      { type: 'create_group_item', group: { id: g, title: 'Семья' }, item: expect.objectContaining({ title: 'Помыть посуду' }), names: [] },
      { type: 'create_todo', todo: expect.objectContaining({ title: 'Купить витамины' }) },
    ]);
    expect(prompts[0]!.input).toContain('\nOpened from group: Семья\nSpeech: ');
  });

  it('микрофон с экрана чужой группы — строки Opened нет', async () => {
    const me = await user({ name: 'Даша' });
    const stranger = await user({ name: 'Чужой' });
    await group('Моя', [me]);
    const other = await group('Чужая', [stranger]);
    const prompts = model({ group_items: [], habits: [], todos: [todo('Купить молоко')] });
    await speak(me, other);
    expect(prompts[0]!.input).not.toContain('Opened from group');
    expect(prompts[0]!.input).not.toContain('Чужая');
    expect(prompts[0]!.labels).toEqual(['Моя']);
  });

  // 03.10.2026: «…настроить ноутбук Алёне…» — Алёна только в «Семье», и всё легло туда, а личный разбор не спросили вовсе.
  it('имя участника во фразе — это ещё не группа: личное не теряется', async () => {
    const me = await user({ name: 'Dasha' });
    const alena = await user({ name: 'Алёна' });
    await group('Семья ❤️', [me, alena]);
    ai.transcript = 'Настроить камеру и микрофон, настроить ноутбук Алёне, написать пробник JRE';
    const todos = [todo('Настроить камеру и микрофон'), todo('Настроить ноутбук Алёне'), todo('Написать пробник JRE')];
    // Модель разложила всё себе — что бы у неё ни спросили.
    net.on(GEMINI, () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ habits: [], todos, group_items: [], items: [] }) }] } }] }));
    const { actions } = await speak(me);
    expect(actions).toEqual(todos.map((d) => ({ type: 'create_todo', todo: expect.objectContaining({ title: d.title }) })));
  });

  it('групп нет — обычный личный разбор', async () => {
    const me = await user();
    ai.transcript = 'читать каждый день';
    const prompts = model({ habits: [habit('Читать')], todos: [] });
    const { actions } = await speak(me);
    expect(actions).toEqual([{ type: 'create_habit', habit: expect.objectContaining({ title: 'Читать', kind: 'check' }) }]);
    expect(prompts).toEqual([{ routed: false, input: expect.stringMatching(/^Today is .+\nчитать каждый день$/), labels: undefined, maxTokens: 1500 }]);
  });
});
