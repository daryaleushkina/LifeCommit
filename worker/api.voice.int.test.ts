// Микрофон в мини-аппе (POST /api/voice): запись → фраза сразу → список действий (NDJSON).
// Проверки записи, дневной лимит, запасной разбор Workers AI, сбои. Куда сказано (себе или в группу) — voice.int.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from './day';
import { ai, dbReady, env, net, sb, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('voice-тесты пропущены: нет локальной Supabase (pnpm db:start)');

const GEMINI = 'https://generativelanguage.googleapis.com/';
const realAi = env.AI;

beforeEach(() => {
  ai.transcript = 'купить молоко';
  ai.parse = '{"habits":[],"todos":[]}';
});
afterEach(() => {
  env.AI = realAi;
});

const audio = () => new Blob([new Uint8Array([1, 2, 3, 4])]);

/** Наговорить: ответ — разобранные строки NDJSON. */
async function speak(u: TestUser, query = '') {
  const res = await u.call<unknown>('POST', `/voice${query}`, audio());
  expect(res.status).toBe(200);
  // Одна строка разбирается как обычный JSON — тогда это единственное событие.
  if (typeof res.body !== 'string') return [res.body];
  return res.body.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { text?: string; actions?: Record<string, unknown>[]; error?: string });
}

/** Gemini отвечает этим JSON; что спросили — в списке. */
function gemini(answer: object) {
  const asked: { key: string | null; input: string }[] = [];
  net.on(GEMINI, async (req) => {
    const body = (await req.json()) as { contents: { parts: { text: string }[] }[] };
    asked.push({ key: req.headers.get('x-goog-api-key'), input: body.contents.at(-1)!.parts[0]!.text });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  });
  return asked;
}

const usage = async (userId: number) => (await sb.from('voice_usage').select('count').eq('user_id', userId)).data?.map((r) => r.count) ?? [];

describe.skipIf(!ready)('голос: запись и лимит', () => {
  it('пустая запись — 400, длиннее 3 МБ — 413; попытка при этом не тратится', async () => {
    const u = await user();
    expect(await u.call('POST', '/voice')).toMatchObject({ status: 400, body: { error: 'no_audio' } });
    expect(await u.call('POST', '/voice', new ArrayBuffer(3_000_001))).toMatchObject({ status: 413, body: { error: 'too_long' } });
    expect(await usage(u.id)).toEqual([]);
    expect(ai.calls).toEqual([]);
  });

  it('попытки на сегодня кончились — 429, модели не зовём', async () => {
    const u = await user();
    await sb.from('voice_usage').insert({ user_id: u.id, day: new Date().toISOString().slice(0, 10), count: 20 });
    expect(await u.call('POST', '/voice', audio())).toMatchObject({ status: 429, body: { error: 'voice_limit' } });
    expect(ai.calls).toEqual([]);
    expect(net.calls).toEqual([]);
    expect(await usage(u.id)).toEqual([20]);
  });
});

describe.skipIf(!ready)('голос: разбор', () => {
  it('фраза приходит первой, потом действия: дела, затем привычки; попытка списана', async () => {
    const u = await user();
    const day = (await u.call('GET', '/today')).body.day as string;
    ai.transcript = '  завтра в три к стоматологу, и читать двадцать страниц  ';
    const asked = gemini({
      habits: [{ title: 'Читать', kind: 'count', target: 20, unit: 'страниц', schedule: 'daily', weekdays: [], per_week: 0 }],
      todos: [{ title: 'Стоматолог', day: addDays(day, 1), time: '15:00', duration: 0, location: '' }],
    });
    // Номер группы не числом — как будто микрофон нажали не в группе.
    const events = await speak(u, '?group=abc');
    expect(events).toEqual([
      { text: 'завтра в три к стоматологу, и читать двадцать страниц' },
      {
        actions: [
          { type: 'create_todo', todo: { title: 'Стоматолог', day: addDays(day, 1), time: '15:00' } },
          { type: 'create_habit', habit: expect.objectContaining({ title: 'Читать', kind: 'count', target: 20, unit: 'страниц', schedule: 'daily' }) },
        ],
      },
    ]);
    expect(asked).toEqual([{ key: env.GEMINI_API_KEY, input: expect.stringContaining(`Today is ${day}`) }]);
    expect(await usage(u.id)).toEqual([1]);
    // В базу голос ничего не пишет — человек сначала смотрит список.
    expect((await sb.from('todos').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect((await sb.from('tasks').select('id').eq('user_id', u.id)).data).toEqual([]);
  });

  it('Gemini недоступен (503) — фразу разбирает Workers AI', async () => {
    const u = await user();
    net.on(GEMINI, () => new Response('overloaded', { status: 503 }));
    ai.parse = JSON.stringify({ habits: [], todos: [{ title: 'Купить молоко', day: '', time: '', duration: 0, location: '' }] });
    const events = await speak(u);
    expect(events).toEqual([{ text: 'купить молоко' }, { actions: [{ type: 'create_todo', todo: { title: 'Купить молоко', day: null, time: null } }] }]);
    expect(net.calls.filter((c) => c.url.startsWith(GEMINI))).toHaveLength(1);
    expect(ai.calls.map((c) => c.model)).toEqual(['@cf/openai/whisper-large-v3-turbo', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']);
  });

  it('ничего не расслышали — пустой список, разбор не зовём', async () => {
    const u = await user();
    ai.transcript = '   ';
    expect(await speak(u)).toEqual([{ text: '' }, { actions: [] }]);
    expect(net.calls).toEqual([]);
    expect(ai.calls.map((c) => c.model)).toEqual(['@cf/openai/whisper-large-v3-turbo']);
  });

  it('расслышали, но добавлять нечего — пустой список', async () => {
    const u = await user();
    ai.transcript = 'привет, как дела';
    gemini({ habits: [], todos: [] });
    expect(await speak(u)).toEqual([{ text: 'привет, как дела' }, { actions: [] }]);
  });

  it('распознавание упало (обе модели) — {error: failed}, попытка списана', async () => {
    const u = await user();
    const tried: string[] = [];
    env.AI = {
      run: async (model: string) => {
        tried.push(model);
        throw new Error('Failed to decode audio file');
      },
    } as unknown as Ai;
    expect(await speak(u)).toEqual([{ error: 'failed' }]);
    expect(tried).toEqual(['@cf/openai/whisper-large-v3-turbo', '@cf/openai/whisper', '@cf/openai/whisper']);
    expect(await usage(u.id)).toEqual([1]);
  });

  it('Whisper слушает на языке интерфейса: en — по-английски, остальные — по-русски', async () => {
    const heard: unknown[] = [];
    env.AI = {
      run: async (model: string, input: { language?: string }) => {
        if (model.includes('whisper')) heard.push(input.language);
        return model.includes('whisper') ? { text: '' } : { response: '{}' };
      },
    } as unknown as Ai;
    await speak(await user({ lang: 'en' }));
    await speak(await user({ lang: 'ru' }));
    expect(heard).toEqual(['en', 'ru']);
  });
});
