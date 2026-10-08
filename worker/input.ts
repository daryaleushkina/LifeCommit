import { HTTPException } from 'hono/http-exception';

const bad = (code: string) => new HTTPException(400, { message: code });

/** JSON снаружи остаётся unknown до проверки формы и полей. */
export function inputObject(raw: unknown, code = 'bad_input'): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad(code);
  return raw as Record<string, unknown>;
}

/** Для обычного API: SyntaxError остаётся общему обработчику bad_json, не desktop bad_request. */
export async function inputBody(req: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  return inputObject(await req.json(), 'bad_json');
}

/** Прежнее приведение числовых полей JSON; объекты не вызывают пользовательский toString/valueOf. */
export function jsonNumber(raw: unknown): number {
  return raw === null || typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean' ? Number(raw) : NaN;
}

const jsonTitle = (raw: unknown) => typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw;

/** На HTTP-границе сохраняем прежние приведения; запись получает нормализованные поля. */
export function normalizeTaskInput(raw: unknown): Record<string, unknown> {
  const input = inputObject(raw);
  const schedule = input.schedule ?? 'daily';
  return {
    ...input,
    title: jsonTitle(input.title),
    target: input.kind === 'count' ? jsonNumber(input.target) : input.target,
    weekdays: schedule === 'weekdays' ? Math.min(127, Math.max(1, jsonNumber(input.weekdays ?? 127))) : undefined,
    per_week: schedule === 'per_week' ? Math.min(7, Math.max(1, jsonNumber(input.per_week ?? 3))) : undefined,
    last_slip_on: input.last_slip_on || null,
  };
}

export function normalizeTodoInput(raw: unknown): Record<string, unknown> {
  const input = inputObject(raw);
  const duration = jsonNumber(input.duration_min);
  return {
    ...input,
    title: jsonTitle(input.title),
    day: typeof input.day === 'string' ? input.day : undefined,
    duration_min: Number.isFinite(duration) ? duration : null,
    location: typeof input.location === 'string' ? input.location : undefined,
  };
}

export function optionalText(raw: unknown, code = 'bad_input'): string | null | undefined {
  if (raw === null || raw === undefined || typeof raw === 'string') return raw;
  throw bad(code);
}

export function optionalNumber(raw: unknown, code = 'bad_input'): number | null | undefined {
  if (raw === null || raw === undefined || (typeof raw === 'number' && Number.isFinite(raw))) return raw;
  throw bad(code);
}

export function optionalBoolean(raw: unknown): boolean | undefined {
  if (raw === undefined || typeof raw === 'boolean') return raw;
  throw bad('bad_input');
}
