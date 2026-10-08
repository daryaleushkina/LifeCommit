// «Добавить всё» после голоса (решение владелицы 04.10.2026: нажали «Добавить» — добавиться должно всё, без дублей).
// Каждая строка несёт ключ повтора: сервер узнаёт повтор и второй раз не записывает (worker/requestKey.ts).
// Не дошедшее повторяется само; что так и не дошло — остаётся в списке, а дошедшее из него уходит.

/** Строка списка с ключом повтора. */
export type Keyed<T> = T & { key?: string };

/** Случайный ключ: 32 шестнадцатеричных знака. */
export function newKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Ключ каждой строке, у которой его ещё нет (те же строки при повторе — те же ключи). */
export const withKeys = <T extends object>(rows: Keyed<T>[]): Keyed<T>[] => rows.map((r) => (r.key ? r : { ...r, key: newKey() }));

/** Строка без ключа — как её ждёт сервер (ключи уходят отдельным списком). */
export function plain<T extends object>(r: Keyed<T>): T {
  const { key: _key, ...rest } = r;
  return rest as T;
}

/** Есть ли смысл повторить: связь оборвалась или сервер упал. Отказ по делу (лимит, неверный ввод, 4xx) — нет. */
export function retryable(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return true;
  const status = 'status' in e ? e.status : undefined;
  if (typeof status !== 'number') return true;
  if (status >= 400 && status < 500) return false;
  return status >= 500 || ('code' in e && e.code === 'network');
}

export interface Job {
  id: string;
  run: () => Promise<unknown>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Выполнить все задания разом; не дошедшие повторить (всего attempts попыток, пауза растёт).
 * failed — id так и не выполненных; error — их последняя ошибка (отказ по делу важнее обрыва связи).
 */
export async function runAll(jobs: Job[], { attempts = 3, pause = 600, wait = sleep } = {}): Promise<{ failed: string[]; error: unknown }> {
  // Отказ по делу не повторяем — он сразу в итоговых failed.
  const refused: Job[] = [];
  let refusal: unknown = null;
  let lastError: unknown = null;
  let left = jobs;
  for (let attempt = 1; left.length; attempt++) {
    const results = await Promise.allSettled(left.map((j) => Promise.resolve().then(j.run)));
    const again: Job[] = [];
    lastError = null;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') return;
      lastError = r.reason;
      if (retryable(r.reason)) again.push(left[i]!);
      else {
        refused.push(left[i]!);
        refusal = r.reason;
      }
    });
    if (!again.length || attempt >= attempts) {
      const failed = [...refused, ...again];
      return { failed: failed.map((j) => j.id), error: failed.length ? (refusal ?? lastError) : null };
    }
    await wait(pause * attempt);
    left = again;
  }
  return { failed: [], error: null };
}
