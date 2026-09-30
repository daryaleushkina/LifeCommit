// Голос и свободный текст → привычки. Речь распознаёт Whisper, фразу разбирает языковая модель;
// обе работают в Cloudflare Workers AI (бесплатный дневной лимит общий на аккаунт).
import type { Schedule, TaskInput, TaskKind } from '../shared/types';
import type { Env } from './env';

const WHISPER = '@cf/openai/whisper-large-v3-turbo';
const LLM = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Больше не разбираем за раз: длинное перечисление почти наверняка ошибка распознавания. */
export const MAX_HABITS = 8;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  // Кусками: String.fromCharCode(...bytes) на большом массиве переполняет стек.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Распознать речь. Telegram присылает голосовые в OGG/Opus — Whisper принимает их как есть. */
export async function transcribe(env: Env, audio: ArrayBuffer, lang: 'ru' | 'en'): Promise<string> {
  const input = { audio: toBase64(new Uint8Array(audio)), language: lang };
  // Whisper в Workers AI изредка отвечает «Failed to decode audio file» на тот же самый файл
  // (на проверке — примерно раз из семи), повтор проходит. Пробуем до трёх раз.
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = (await env.AI.run(WHISPER as never, input as never)) as { text?: string };
      return (res.text ?? '').trim();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const SCHEMA = {
  type: 'object',
  properties: {
    habits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['check', 'count', 'abstain'] },
          target: { type: 'number' },
          unit: { type: 'string' },
          schedule: { type: 'string', enum: ['daily', 'weekdays', 'per_week'] },
          weekdays: { type: 'array', items: { type: 'number' } },
          per_week: { type: 'number' },
        },
        // Все поля обязательные: с необязательными модель просто выбрасывает числа и расписание.
        required: ['title', 'kind', 'target', 'unit', 'schedule', 'weekdays', 'per_week'],
      },
    },
  },
  required: ['habits'],
};

const SYSTEM = `You turn a person's spoken or typed wish list into habits for a habit tracker. Reply with JSON only.
Every habit has ALL of these fields:
- title: short, 1-3 words, in the SAME language as the input, capitalised, naming the thing itself — no numbers and no schedule words ("Читать", "Вода", "Спортзал", "Не курить", "Меньше телефона").
- kind: "count" when a daily amount is given (20 pages, 8 glasses, 30 minutes); "abstain" when the person wants to quit, stop or do less of something (smoking, alcohol, sweets, phone); otherwise "check".
- target: the daily number for "count", otherwise 0. Spelled-out numbers count too ("двадцать" = 20).
- unit: the unit word for "count" in the input language ("страниц", "стаканов", "минут"), otherwise "".
- schedule: "weekdays" when specific days of the week are named; "per_week" when it is N times a week on any days; otherwise "daily". "abstain" is always "daily".
- weekdays: for "weekdays" the day numbers, 1 = Monday … 7 = Sunday; otherwise [].
- per_week: for "per_week" the number N (1-6); otherwise 0.
Each separate wish becomes its own habit. Ignore greetings and small talk. If there is no habit in the text, return {"habits": []}. Never invent habits that were not mentioned.`;

// Два разобранных примера: без них модель теряет числа и расписание.
const SHOTS: [string, object][] = [
  [
    'хочу читать двадцать страниц каждый день, ходить в спортзал три раза в неделю и бросить курить',
    {
      habits: [
        { title: 'Читать', kind: 'count', target: 20, unit: 'страниц', schedule: 'daily', weekdays: [], per_week: 0 },
        { title: 'Спортзал', kind: 'check', target: 0, unit: '', schedule: 'per_week', weekdays: [], per_week: 3 },
        { title: 'Не курить', kind: 'abstain', target: 0, unit: '', schedule: 'daily', weekdays: [], per_week: 0 },
      ],
    },
  ],
  [
    'run on mondays and thursdays, drink 8 glasses of water, less sugar, thanks!',
    {
      habits: [
        { title: 'Run', kind: 'check', target: 0, unit: '', schedule: 'weekdays', weekdays: [1, 4], per_week: 0 },
        { title: 'Water', kind: 'count', target: 8, unit: 'glasses', schedule: 'daily', weekdays: [], per_week: 0 },
        { title: 'Less sugar', kind: 'abstain', target: 0, unit: '', schedule: 'daily', weekdays: [], per_week: 0 },
      ],
    },
  ],
];

interface RawHabit {
  title?: unknown;
  kind?: unknown;
  target?: unknown;
  unit?: unknown;
  schedule?: unknown;
  weekdays?: unknown;
  per_week?: unknown;
}

/** Привести ответ модели к тому, что можно сохранить: модель может ошибиться в любом поле. */
export function toTaskInputs(raw: unknown): TaskInput[] {
  const list = (raw as { habits?: unknown })?.habits;
  if (!Array.isArray(list)) return [];
  const out: TaskInput[] = [];
  for (const h of list as RawHabit[]) {
    const title = typeof h?.title === 'string' ? h.title.trim().slice(0, 80) : '';
    if (!title) continue;
    const kind: TaskKind = h.kind === 'count' || h.kind === 'abstain' ? h.kind : 'check';
    const target = Math.floor(Number(h.target));
    // «Считать» без числа — это обычная галочка.
    const counted = kind === 'count' && target > 0;
    let schedule: Schedule = 'daily';
    let weekdays = 127;
    let perWeek: number | null = null;
    if (kind !== 'abstain') {
      const days = Array.isArray(h.weekdays) ? h.weekdays.map(Number).filter((d) => d >= 1 && d <= 7) : [];
      const n = Math.floor(Number(h.per_week));
      if (h.schedule === 'weekdays' && days.length > 0 && days.length < 7) {
        schedule = 'weekdays';
        weekdays = days.reduce((mask, d) => mask | (1 << (d - 1)), 0);
      } else if (h.schedule === 'per_week' && n >= 1 && n <= 6) {
        schedule = 'per_week';
        perWeek = n;
      }
    }
    out.push({
      title,
      kind: kind === 'count' && !counted ? 'check' : kind,
      target: counted ? Math.min(target, 100_000) : 1,
      unit: counted && typeof h.unit === 'string' ? h.unit.trim().slice(0, 12) || null : null,
      schedule,
      weekdays,
      per_week: perWeek,
    });
    if (out.length >= MAX_HABITS) break;
  }
  return out;
}

// Бесплатный уровень Gemini: псевдоним сам переезжает на свежую облегчённую модель.
const GEMINI = 'gemini-flash-lite-latest';
/** Дольше Gemini не ждём: бесплатный уровень бывает медленным и перегруженным, тогда разбирает Workers AI. */
const GEMINI_TIMEOUT_MS = 12_000;

/** Та же схема в записи Gemini: типы заглавными буквами. */
function geminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : geminiSchema(v);
  return out;
}

async function parseWithGemini(key: string, text: string): Promise<unknown> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        ...SHOTS.flatMap(([q, a]) => [
          { role: 'user', parts: [{ text: q }] },
          { role: 'model', parts: [{ text: JSON.stringify(a) }] },
        ]),
        { role: 'user', parts: [{ text }] },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 900, responseMimeType: 'application/json', responseSchema: geminiSchema(SCHEMA) },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const out = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) throw new Error('gemini: empty answer');
  return JSON.parse(out);
}

async function parseWithWorkersAi(env: Env, text: string): Promise<unknown> {
  const res = (await env.AI.run(
    LLM as never,
    {
      messages: [
        { role: 'system', content: SYSTEM },
        ...SHOTS.flatMap(([q, a]) => [
          { role: 'user', content: q },
          { role: 'assistant', content: JSON.stringify(a) },
        ]),
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      temperature: 0,
      max_tokens: 900,
    } as never,
  )) as { response?: unknown };
  return typeof res.response === 'string' ? safeJson(res.response) : res.response;
}

/**
 * Разобрать фразу на привычки. Пустой список — в тексте привычек не нашлось.
 * Сначала Gemini (если есть ключ); не ответил вовремя или упал — та же задача уходит в Workers AI.
 */
export async function parseHabits(env: Env, text: string): Promise<{ habits: TaskInput[]; by: 'gemini' | 'workers-ai' }> {
  const input = text.slice(0, 2000);
  if (env.GEMINI_API_KEY) {
    try {
      return { habits: toTaskInputs(await parseWithGemini(env.GEMINI_API_KEY, input)), by: 'gemini' };
    } catch (e) {
      console.warn('gemini failed, falling back to Workers AI', e);
    }
  }
  return { habits: toTaskInputs(await parseWithWorkersAi(env, input)), by: 'workers-ai' };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
