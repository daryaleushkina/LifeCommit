// Голос и свободный текст → привычки и разовые дела. Речь распознаёт Whisper, фразу разбирает языковая модель;
// обе работают в Cloudflare Workers AI (бесплатный дневной лимит общий на аккаунт).
import type { Schedule, TaskInput, TaskKind, TodoInput } from '../shared/types';
import type { Env } from './env';

const WHISPER = '@cf/openai/whisper-large-v3-turbo';
const WHISPER_FALLBACK = '@cf/openai/whisper';
const LLM = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Больше не разбираем за раз: длинное перечисление почти наверняка ошибка распознавания. */
export const MAX_HABITS = 8;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  // Кусками: String.fromCharCode(...bytes) на большом массиве переполняет стек.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Распознать речь. Telegram присылает голосовые в OGG/Opus, мини-апп — то, что пишет браузер
 * (webm/Opus в Android и Chrome, mp4/AAC на iPhone); обе модели принимают всё это как есть.
 *
 * Whisper turbo распознаёт лучше, но в Workers AI часто отвечает «Failed to decode audio file»
 * на исправный файл (01.10.2026 — две трети запросов, на всех форматах; повтор не помогает).
 * Старый Whisper на тех же файлах не ошибся ни разу — он и подхватывает. Цена у обоих одна
 * (~41 нейрон за минуту речи); Deepgram Nova-3 надёжен, но в десять раз дороже.
 */
export async function transcribe(env: Env, audio: ArrayBuffer, lang: 'ru' | 'en'): Promise<string> {
  try {
    const res = (await env.AI.run(WHISPER as never, { audio: toBase64(new Uint8Array(audio)), language: lang } as never)) as { text?: string };
    return (res.text ?? '').trim();
  } catch (e) {
    console.warn('whisper turbo failed, falling back to whisper', e);
  }
  const bytes = [...new Uint8Array(audio)];
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = (await env.AI.run(WHISPER_FALLBACK as never, { audio: bytes } as never)) as { text?: string };
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
    todos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, day: { type: 'string' }, time: { type: 'string' }, duration: { type: 'number' }, location: { type: 'string' } },
        required: ['title', 'day', 'time', 'duration', 'location'],
      },
    },
  },
  required: ['habits', 'todos'],
};

const SYSTEM = `You turn a person's spoken or typed list into habits and one-off to-dos for a habit tracker. Reply with JSON only.
A HABIT repeats: something done every day, on some weekdays or N times a week, a daily amount, or something to quit. A TO-DO is a single thing to do once ("buy milk", "call mom", "book a dentist", "tomorrow pay the rent"). When unsure, a plain action with no repetition words is a to-do.
Every to-do has ALL of these fields:
- title: short, in the SAME language as the input, capitalised, the action itself without date words ("Купить молоко", "Позвонить маме").
- day: the date it is for as YYYY-MM-DD, counted from the "Today is" line at the start of the input ("завтра"/"tomorrow" = the next day, "в пятницу"/"on Friday" = the nearest coming Friday); "" when no day is said (it means today).
- time: the time of day as 24-hour HH:MM when one is said ("в 15:00", "в три часа дня" = "15:00", "в 9 утра" = "09:00", "at 7pm" = "19:00"); "" when no time is said. The time words are not part of the title.
- duration: how long it lasts in minutes when said ("на 3 часа", "продолжительностью три часа" = 180, "полчаса" = 30, "for an hour and a half" = 90, "с 14 до 16" = 120); 0 when not said. Not part of the title.
- location: the place when one is named ("в кафе Снежинка" = "Кафе Снежинка", "у мамы дома" = "У мамы", "в офисе на Ленина 5" = "Офис, Ленина 5", "at Blue Bottle" = "Blue Bottle"), capitalised, in the input language; "" when no place is said. The place is not part of the title ("встреча с Лизой в кафе Снежинка" → title "Встреча с Лизой", location "Кафе Снежинка").
Every habit has ALL of these fields:
- title: short, 1-3 words, in the SAME language as the input, capitalised, naming the thing itself — no numbers and no schedule words ("Читать", "Вода", "Спортзал", "Не курить", "Меньше телефона").
- kind: "count" when a daily amount is given (20 pages, 8 glasses, 30 minutes); "abstain" when the person wants to quit, stop or do less of something (smoking, alcohol, sweets, phone); otherwise "check".
- target: the daily number for "count", otherwise 0. Spelled-out numbers count too ("двадцать" = 20).
- unit: the unit word for "count" in the input language ("страниц", "стаканов", "минут"), otherwise "".
- schedule: "weekdays" when specific days of the week are named; "per_week" when it is N times a week on any days; otherwise "daily". "abstain" is always "daily".
- weekdays: for "weekdays" the day numbers, 1 = Monday … 7 = Sunday; otherwise [].
- per_week: for "per_week" the number N (1-6); otherwise 0.
If the input starts with a "Groups:" line, the person also gives tasks to those groups: anything said for a group («в группу Семья», «в семью», «нам всем») or for one of its listed people («Алёне погулять с собакой») is NOT personal — leave it out. Keep only what the person takes for themselves («себе», «мне», «лично»).
Each separate wish becomes its own habit or to-do. Ignore greetings and small talk. If there is nothing to add, return {"habits": [], "todos": []}. Never invent anything that was not mentioned.`;

// Два разобранных примера: без них модель теряет числа и расписание.
const SHOTS: [string, object][] = [
  [
    'Today is 2026-01-07, Wednesday.\nхочу читать двадцать страниц каждый день, ходить в спортзал три раза в неделю, бросить курить, а завтра купить молоко',
    {
      habits: [
        { title: 'Читать', kind: 'count', target: 20, unit: 'страниц', schedule: 'daily', weekdays: [], per_week: 0 },
        { title: 'Спортзал', kind: 'check', target: 0, unit: '', schedule: 'per_week', weekdays: [], per_week: 3 },
        { title: 'Не курить', kind: 'abstain', target: 0, unit: '', schedule: 'daily', weekdays: [], per_week: 0 },
      ],
      todos: [{ title: 'Купить молоко', day: '2026-01-08', time: '', duration: 0, location: '' }],
    },
  ],
  [
    'Today is 2026-03-02, Monday.\ncall the bank, run on mondays and thursdays, drink 8 glasses of water, less sugar, on friday send the report, tomorrow at 3:30 pm dentist and on wednesday at 6 pm a three-hour meeting with Liza at the Snowflake cafe, thanks!',
    {
      habits: [
        { title: 'Run', kind: 'check', target: 0, unit: '', schedule: 'weekdays', weekdays: [1, 4], per_week: 0 },
        { title: 'Water', kind: 'count', target: 8, unit: 'glasses', schedule: 'daily', weekdays: [], per_week: 0 },
        { title: 'Less sugar', kind: 'abstain', target: 0, unit: '', schedule: 'daily', weekdays: [], per_week: 0 },
      ],
      todos: [
        { title: 'Call the bank', day: '', time: '', duration: 0, location: '' },
        { title: 'Send the report', day: '2026-03-06', time: '', duration: 0, location: '' },
        { title: 'Dentist', day: '2026-03-03', time: '15:30', duration: 0, location: '' },
        { title: 'Meeting with Liza', day: '2026-03-04', time: '18:00', duration: 180, location: 'Snowflake Cafe' },
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

/** Сколько дел за раз: длиннее — почти наверняка ошибка распознавания. */
export const MAX_TODOS = 12;

/** Дела из ответа модели; дату проверяет и поправляет сервер при сохранении. */
export function toTodoInputs(raw: unknown): TodoInput[] {
  const list = (raw as { todos?: unknown })?.todos;
  if (!Array.isArray(list)) return [];
  const out: TodoInput[] = [];
  for (const d of list as { title?: unknown; day?: unknown; time?: unknown; duration?: unknown; location?: unknown }[]) {
    const title = typeof d?.title === 'string' ? d.title.trim().slice(0, 120) : '';
    if (!title) continue;
    const day = typeof d.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.day) ? d.day : null;
    const tm = typeof d.time === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(d.time.trim()) : null;
    const time = tm && Number(tm[1]) < 24 && Number(tm[2]) < 60 ? `${tm[1]!.padStart(2, '0')}:${tm[2]}` : null;
    const duration = typeof d.duration === 'number' && d.duration > 0 && d.duration <= 20160 ? Math.round(d.duration) : null;
    const location = typeof d.location === 'string' ? d.location.trim().slice(0, 200) : '';
    out.push({ title, day, time, ...(duration && { duration_min: duration }), ...(location && { location }) });
    if (out.length >= MAX_TODOS) break;
  }
  return out;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Строка с сегодняшней датой: без неё модель не поймёт «завтра» и «в пятницу». */
const todayLine = (day: string) => `Today is ${day}, ${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]}.`;

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

/** Чему учим модель: системная подсказка, примеры и схема ответа. Личный разбор — по умолчанию; групповой — worker/groupVoice.ts. */
export interface ModelSpec {
  system: string;
  shots: [string, object][];
  schema: object;
}
const PERSONAL: ModelSpec = { system: SYSTEM, shots: SHOTS, schema: SCHEMA };

async function parseWithGemini(key: string, text: string, spec: ModelSpec = PERSONAL): Promise<unknown> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: spec.system }] },
      contents: [
        ...spec.shots.flatMap(([q, a]) => [
          { role: 'user', parts: [{ text: q }] },
          { role: 'model', parts: [{ text: JSON.stringify(a) }] },
        ]),
        { role: 'user', parts: [{ text }] },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 1500, responseMimeType: 'application/json', responseSchema: geminiSchema(spec.schema) },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const out = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) throw new Error('gemini: empty answer');
  return JSON.parse(out);
}

async function parseWithWorkersAi(env: Env, text: string, spec: ModelSpec = PERSONAL): Promise<unknown> {
  const res = (await env.AI.run(
    LLM as never,
    {
      messages: [
        { role: 'system', content: spec.system },
        ...spec.shots.flatMap(([q, a]) => [
          { role: 'user', content: q },
          { role: 'assistant', content: JSON.stringify(a) },
        ]),
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_schema', json_schema: spec.schema },
      temperature: 0,
      max_tokens: 1500,
    } as never,
  )) as { response?: unknown };
  return typeof res.response === 'string' ? safeJson(res.response) : res.response;
}

export interface Parsed {
  habits: TaskInput[];
  todos: TodoInput[];
  by: 'gemini' | 'workers-ai';
}

/**
 * Разобрать фразу на привычки и разовые дела. Пустые списки — добавлять нечего.
 * today — логический день человека: от него модель считает «завтра» и «в пятницу».
 * Сначала Gemini (если есть ключ); не ответил вовремя или упал — та же задача уходит в Workers AI.
 */
/**
 * groups — группы, о которых шла речь: сказанное для них (и их участникам) — не личное, разбор его не берёт
 * (это забирает групповой разбор, worker/voiceRoute.ts).
 */
export async function parseHabits(env: Env, text: string, today: string, groups: { title: string; members: string[] }[] = []): Promise<Parsed> {
  const groupLine = groups.length ? `Groups: ${groups.map((g) => `${g.title} (${g.members.join(', ') || '—'})`).join('; ')}\n` : '';
  const input = `${groupLine}${todayLine(today)}\n${text.slice(0, 2000)}`;
  const read = (raw: unknown, by: Parsed['by']): Parsed => ({ habits: toTaskInputs(raw), todos: toTodoInputs(raw), by });
  if (env.GEMINI_API_KEY) {
    try {
      return read(await parseWithGemini(env.GEMINI_API_KEY, input), 'gemini');
    } catch (e) {
      console.warn('gemini failed, falling back to Workers AI', e);
    }
  }
  return read(await parseWithWorkersAi(env, input), 'workers-ai');
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Спросить модель по своей подсказке и схеме: сначала Gemini, не вышло — Workers AI. */
export async function askModel(env: Env, input: string, spec: ModelSpec): Promise<unknown> {
  if (env.GEMINI_API_KEY) {
    try {
      return await parseWithGemini(env.GEMINI_API_KEY, input, spec);
    } catch (e) {
      console.warn('gemini failed, falling back to Workers AI', e);
    }
  }
  return parseWithWorkersAi(env, input, spec);
}

export { todayLine };
