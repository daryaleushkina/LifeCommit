import { HTTPException } from 'hono/http-exception';

const bad = (code: string) => new HTTPException(400, { message: code });

/** JSON снаружи остаётся unknown до проверки формы и полей. */
export function inputObject(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad('bad_input');
  return raw as Record<string, unknown>;
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
