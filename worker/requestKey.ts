// Ключ повтора при добавлении (04.10.2026, решение владелицы: нажали «Добавить» — добавиться должно всё, без дублей).
// Клиент шлёт по ключу на строку; Worker делает его своим для человека («<id>:<ключ>») и пишет в request_key
// (уникальный). Повтор с тем же ключом не создаёт вторую строку, а отвечает id уже записанной.
import { HTTPException } from 'hono/http-exception';
import type { SupabaseClient } from '@supabase/supabase-js';

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new HTTPException(500, { message: res.error.message });
  return res.data as T;
}

/** Самый длинный ключ клиента, который принимаем (UUID с запасом). */
export const MAX_KEY = 80;

/** Ключи повтора на n строк: годный — «<id>:<ключ>», негодный или его нет — null (обычное добавление). */
export function requestKeys(raw: unknown, n: number, userId: number): (string | null)[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, i) => {
    const k = list[i];
    return typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY && !k.includes('\0') ? `${userId}:${k}` : null;
  });
}

function idRows(raw: unknown): { id: number; request_key: string | null }[] {
  if (!Array.isArray(raw)) throw new HTTPException(500, { message: 'bad_insert_result' });
  return raw.map((r: unknown) => {
    if (typeof r !== 'object' || r === null || !('id' in r) || typeof r.id !== 'number' || !Number.isSafeInteger(r.id)) {
      throw new HTTPException(500, { message: 'bad_insert_result' });
    }
    const key = 'request_key' in r ? r.request_key : null;
    if (key !== null && typeof key !== 'string') throw new HTTPException(500, { message: 'bad_insert_result' });
    return { id: r.id, request_key: key };
  });
}

/**
 * Записать строки с ключами повтора. ids — в порядке строк; fresh — записана ли строка сейчас
 * (повтор по ключу — false). Привычки с зависимыми строками записывает транзакция insert_tasks.
 */
export async function insertKeyed(
  sb: SupabaseClient,
  table: 'todos' | 'group_items',
  rows: Record<string, unknown>[],
  keys: (string | null)[],
  scope: Record<string, number>,
): Promise<{ ids: number[]; fresh: boolean[] }> {
  const ids: number[] = new Array(rows.length);
  const fresh: boolean[] = new Array(rows.length).fill(false);
  const plain = rows.flatMap((_, i) => (keys[i] ? [] : [i]));
  const keyed = rows.flatMap((_, i) => (keys[i] ? [i] : []));
  if (plain.length) {
    const made = idRows(must(await sb.from(table).insert(plain.map((i) => rows[i]!)).select('id')));
    if (made.length !== plain.length) throw new HTTPException(500, { message: 'bad_insert_result' });
    plain.forEach((i, j) => {
      ids[i] = made[j]!.id;
      fresh[i] = true;
    });
  }
  if (keyed.length) {
    const made = idRows(must(
      await sb
        .from(table)
        .upsert(keyed.map((i) => ({ ...rows[i]!, request_key: keys[i] })), { onConflict: 'request_key', ignoreDuplicates: true })
        .select('id, request_key'),
    ));
    const madeKeys = new Set(made.map((r) => r.request_key));
    // Записанные раньше (повтор) — найти по ключу.
    let query = sb.from(table).select('id, request_key').in('request_key', keyed.map((i) => keys[i]!));
    for (const [column, value] of Object.entries(scope)) query = query.eq(column, value);
    const known = idRows(must(await query));
    const byKey = new Map(known.map((r) => [r.request_key, r.id]));
    for (const i of keyed) {
      const id = byKey.get(keys[i]!);
      // Ключ группового дела нельзя переиспользовать в другой группе и получить оттуда id.
      if (id === undefined) throw new HTTPException(409, { message: 'request_key_conflict' });
      ids[i] = id;
      fresh[i] = madeKeys.has(keys[i]!);
    }
  }
  return { ids, fresh };
}
