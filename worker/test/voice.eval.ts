// Прогон эталонных фраз (worker/eval/voice.cases.ts) через настоящий Gemini: pnpm eval:voice.
// Фразы идут через тот же код, что в проде (parseHabits, routeVoice, parseGroupItems) — подсказка не дублируется.
// Каждый кейс — EVAL_RUNS прогонов (по умолчанию 3); зелёный, только если зелёные все (pass^3).
// Не входит в pnpm test и в хук перед пушем: это настоящие запросы к модели, бесплатная квота Gemini общая с продом
// (40 кейсов × 3 ≈ 125 запросов). Запускать после каждой правки подсказки, примеров или схемы в voice.ts / groupVoice.ts.
//
// Ключ — GEMINI_API_KEY из окружения или из .dev.vars; в вывод не попадает.
// Переменные:
//   EVAL_BACKEND=workers-ai — проверить резерв (Llama в Workers AI через REST API Cloudflare;
//                             нужны CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN с правом Workers AI);
//   EVAL_RUNS=3 — прогонов на кейс; EVAL_RPM=12 — не чаще стольких запросов к модели в минуту;
//   EVAL_CONCURRENCY=2 — кейсов одновременно (vitest.eval.config.ts).
// Только часть кейсов: pnpm eval:voice -t p-zavtra.
// Итог — таблица в конце и test-results/voice-eval.json; прошлый файл — для сравнения «было → стало».
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, it, vi } from 'vitest';
import type { Env } from '../env';
import { caseToday, fromDrafts, fromParsed, fromRouted, passAll, scoreVoiceCase, summarize, type ActualVoice, type ExpectedVoice, type Score } from '../eval/score';
import { CASES, type VoiceCase } from '../eval/voice.cases';
import { parseGroupItems } from '../groupVoice';
import { parseHabits } from '../voice';
import { routeVoice } from '../voiceRoute';

const BACKEND = process.env.EVAL_BACKEND === 'workers-ai' ? 'workers-ai' : 'gemini';
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS ?? 3));
const RPM = Math.max(1, Number(process.env.EVAL_RPM ?? 12));
const MAX_RETRIES = 4;
const REPORT = 'test-results/voice-eval.json';

/** Значение из окружения или из .dev.vars (файл читаем сами — wrangler здесь не участвует). */
function devVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!existsSync('.dev.vars')) return undefined;
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1] === name) return m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Что случилось с запросами к модели в одной попытке разбора. */
interface Attempt {
  retryable: boolean;
  retryAfterMs: number;
  warnings: string[];
}
const attemptCtx = new AsyncLocalStorage<Attempt>();
const models = new Set<string>();
let modelCalls = 0;
let retries = 0;

async function retryDelay(res: Response): Promise<number> {
  const header = Number(res.headers.get('retry-after'));
  if (header > 0) return header * 1000;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: { details?: { retryDelay?: string }[] } } | null;
  const s = body?.error?.details?.find((d) => d.retryDelay)?.retryDelay;
  return s ? Math.ceil(parseFloat(s) * 1000) : 0;
}

// Подслушиваем запросы к модели: версия модели, 429/5xx и таймауты (их повторяем, а не считаем провалом подсказки).
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const a = attemptCtx.getStore();
  const gemini = url.includes('generativelanguage.googleapis.com');
  if (!a || !(gemini || url.includes('/ai/run/'))) return realFetch(input, init);
  modelCalls++;
  try {
    const res = await realFetch(input, init);
    if (res.status === 429 || res.status >= 500) {
      a.retryable = true;
      a.retryAfterMs = Math.max(a.retryAfterMs, await retryDelay(res));
    } else if (res.ok && gemini) {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as { modelVersion?: string } | null;
      if (body?.modelVersion) models.add(body.modelVersion);
    }
    return res;
  } catch (e) {
    a.retryable = true; // таймаут (12 с в voice.ts) или сеть
    throw e;
  }
}) as typeof fetch;

// Код разбора пишет console.warn, когда Gemini упал, — складываем в попытку, а не в вывод.
vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
  attemptCtx.getStore()?.warnings.push(args.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
});

/** Резерв в проде — привязка AI; здесь — тот же вызов через REST API Cloudflare. */
async function workersAiRest(model: string, input: unknown): Promise<unknown> {
  const account = devVar('CLOUDFLARE_ACCOUNT_ID');
  const token = devVar('CLOUDFLARE_API_TOKEN');
  if (!account || !token) throw new Error('EVAL_BACKEND=workers-ai: нужны CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: unknown; errors?: { message?: string }[] };
  if (!res.ok || !body.success) throw new Error(`workers-ai ${res.status}: ${(body.errors ?? []).map((e) => e.message).join('; ')}`);
  models.add(model);
  return body.result;
}

const geminiKey = BACKEND === 'gemini' ? devVar('GEMINI_API_KEY') : undefined;
if (BACKEND === 'gemini' && !geminiKey) throw new Error('Нет GEMINI_API_KEY ни в окружении, ни в .dev.vars');

const env = {
  GEMINI_API_KEY: geminiKey,
  AI: {
    run:
      BACKEND === 'workers-ai'
        ? workersAiRest
        : async () => {
            // Gemini не ответил — в проде подхватил бы Workers AI; здесь проверяем только основной путь.
            throw new Error('Gemini не ответил, резерв в этой оценке выключен (EVAL_BACKEND=workers-ai — проверить резерв)');
          },
  },
} as unknown as Env;

// Не чаще RPM запросов в минуту на всех: бесплатный Gemini отвечает 429 на поминутный лимит.
let nextSlot = 0;
async function gate(n: number) {
  for (let i = 0; i < n; i++) {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + 60_000 / RPM;
    if (at > now) await sleep(at - now);
  }
}

async function runOnce(c: VoiceCase, today: string): Promise<ActualVoice> {
  if (c.kind === 'personal') return fromParsed(await parseHabits(env, c.text, today));
  if (c.kind === 'group') return { habits: [], todos: [], groups: [fromDrafts(c.group, await parseGroupItems(env, c.text, today, c.members, c.speaker), c.members)] };
  return fromRouted(await routeVoice(env, c.text, today, c.me, c.groups, c.screenGroup), c.groups);
}

function expectedOf(c: VoiceCase, today: string): ExpectedVoice {
  return c.kind === 'group' ? { today, groups: [{ title: c.group, items: c.expect.items }] } : { today, ...c.expect };
}

type Run = Score & { error?: boolean };

async function attempt(c: VoiceCase, today: string): Promise<Run> {
  for (let tryNo = 0; ; tryNo++) {
    // В мини-аппе фраза про группу — это до двух запросов (группа и личное параллельно).
    await gate(c.kind === 'route' ? 2 : 1);
    const a: Attempt = { retryable: false, retryAfterMs: 0, warnings: [] };
    try {
      return scoreVoiceCase(expectedOf(c, today), await attemptCtx.run(a, () => runOnce(c, today)));
    } catch (e) {
      if (a.retryable && tryNo < MAX_RETRIES) {
        retries++;
        await sleep(Math.max(a.retryAfterMs, 15_000 * 2 ** tryNo));
        continue;
      }
      return { pass: false, error: true, diffs: [`ошибка: ${[...a.warnings, (e as Error).message].join(' / ')}`] };
    }
  }
}

interface CaseResult {
  id: string;
  text: string;
  today: string;
  note?: string;
  runs: Run[];
}
const results = new Map<string, CaseResult>();

describe(`разбор голоса: ${BACKEND}, pass^${RUNS}`, () => {
  for (const c of CASES) {
    it.concurrent(c.id, async ({ expect }) => {
      const today = caseToday(c.when);
      const runs: Run[] = [];
      for (let i = 0; i < RUNS; i++) runs.push(await attempt(c, today));
      results.set(c.id, { id: c.id, text: c.text, today, ...(c.note && { note: c.note }), runs });
      expect(passAll(runs), [...new Set(runs.flatMap((r) => r.diffs))].join('\n')).toBe(true);
    });
  }
});

afterAll(() => {
  const list = CASES.map((c) => results.get(c.id)).filter((r): r is CaseResult => r !== undefined);
  if (!list.length) return;
  let before: Record<string, boolean> = {};
  try {
    before = (JSON.parse(readFileSync(REPORT, 'utf8')) as { cases: { id: string; pass: boolean }[] }).cases.reduce<Record<string, boolean>>((m, x) => ({ ...m, [x.id]: x.pass }), {});
  } catch {
    // первого прогона нет — сравнивать не с чем
  }
  const width = Math.max(...list.map((r) => r.id.length)) + 2;
  const lines = ['', `Разбор голоса — ${BACKEND}, модель: ${[...models].join(', ') || '—'}, прогонов на кейс: ${RUNS}`, ''];
  const changes: string[] = [];
  for (const r of list) {
    const ok = passAll(r.runs);
    const marks = r.runs.map((x) => (x.error ? '!' : x.pass ? '✓' : '✗')).join(' ');
    lines.push(`${r.id.padEnd(width)}${marks}   ${ok ? 'зелёный' : 'КРАСНЫЙ'}`);
    if (!ok) {
      lines.push(`    «${r.text}» (сегодня ${r.today})${r.note ? ` — ${r.note}` : ''}`);
      const counts = new Map<string, number>();
      for (const d of r.runs.flatMap((x) => x.diffs)) counts.set(d, (counts.get(d) ?? 0) + 1);
      for (const [d, n] of counts) lines.push(`    ${d}${n > 1 ? `  ×${n}` : ''}`);
    }
    if (r.id in before && before[r.id] !== ok) changes.push(`${r.id} ${before[r.id] ? '✓' : '✗'}→${ok ? '✓' : '✗'}`);
  }
  const s = summarize(list);
  lines.push('', `Итог pass^${RUNS}: ${s.passed} из ${s.total} (${s.percent}%) · запросов к модели: ${modelCalls} · повторов после 429/5xx/таймаута: ${retries}`);
  if (changes.length) lines.push(`С прошлого прогона: ${changes.join(', ')}`);
  console.log(lines.join('\n'));
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    REPORT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        backend: BACKEND,
        models: [...models],
        runsPerCase: RUNS,
        summary: s,
        cases: list.map((r) => ({ id: r.id, pass: passAll(r.runs), runs: r.runs })),
      },
      null,
      2,
    ),
  );
});
