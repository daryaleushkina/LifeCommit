// Жалобы пользователей (docs/feedback.md, этап 1 — приём): база, лимиты и повторы.
import { describe, expect, it } from 'vitest';
import { dbReady, sb, user } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('feedback-тесты пропущены: нет локальной Supabase (pnpm db:start)');

interface Submitted {
  result: 'ok' | 'duplicate' | 'limit' | 'project_limit';
  id?: number;
}

/** Принять жалобу так, как это делает Worker: лимиты — 3 в час, 10 в сутки, на проект — сколько задано. */
async function submit(userId: number, text: string, more: { project?: number; confirmed?: boolean; attachments?: object[] } = {}): Promise<Submitted> {
  const { data, error } = await sb.rpc('submit_feedback', {
    p_user: userId,
    p_source: 'app',
    p_text: text,
    p_attachments: more.attachments ?? [],
    p_context: { route: 'today' },
    p_confirmed: more.confirmed ?? true,
    p_per_hour: 3,
    p_per_day: 10,
    p_project_day: more.project ?? 200,
  });
  if (error) throw error;
  return data as Submitted;
}

const rows = async (userId: number) =>
  ((await sb.from('feedback').select('id, source, status, text, attachments, context, confirmed, dup_count').eq('user_id', userId).order('id')).data ?? []) as {
    id: number;
    text: string;
    dup_count: number;
    confirmed: boolean;
  }[];

/** Сдвинуть время подачи всех жалоб человека в прошлое. */
const age = (userId: number, minutes: number) => sb.from('feedback').update({ created_at: new Date(Date.now() - minutes * 60_000).toISOString() }).eq('user_id', userId);

describe.skipIf(!ready)('жалобы: приём в базе', () => {
  it('жалоба ложится целиком: откуда, текст, вложения, контекст, подтверждена ли', async () => {
    const u = await user();
    const r = await submit(u.id, 'Не сохраняется дело', { confirmed: false, attachments: [{ kind: 'storage', path: 'x/1.jpg' }] });
    expect(r).toEqual({ result: 'ok', id: expect.any(Number) });
    expect(await rows(u.id)).toEqual([
      {
        id: r.id,
        source: 'app',
        status: 'new',
        text: 'Не сохраняется дело',
        attachments: [{ kind: 'storage', path: 'x/1.jpg' }],
        context: { route: 'today' },
        confirmed: false,
        dup_count: 0,
      },
    ]);
  });

  it('больше трёх в час — отказ; час прошёл — снова можно', async () => {
    const u = await user();
    for (const n of [1, 2, 3]) expect((await submit(u.id, `Жалоба ${n}`)).result).toBe('ok');
    expect(await submit(u.id, 'Жалоба 4')).toEqual({ result: 'limit' });
    await age(u.id, 61);
    expect((await submit(u.id, 'Жалоба 5')).result).toBe('ok');
    expect(await rows(u.id)).toHaveLength(4);
  });

  it('больше десяти в сутки — отказ, даже если в последний час тихо', async () => {
    const u = await user();
    const old = Array.from({ length: 10 }, (_, i) => ({ user_id: u.id, source: 'bot', text: `Старая ${i}`, created_at: new Date(Date.now() - (2 + i) * 3_600_000).toISOString() }));
    expect((await sb.from('feedback').insert(old)).error).toBeNull();
    expect(await submit(u.id, 'Одиннадцатая')).toEqual({ result: 'limit' });
  });

  it('тот же текст за сутки — не новая жалоба, а счётчик у старой (без учёта регистра и пробелов)', async () => {
    const u = await user();
    const first = await submit(u.id, 'Кнопка  не нажимается');
    expect(await submit(u.id, '  кнопка не НАЖИМАЕТСЯ ')).toEqual({ result: 'duplicate', id: first.id });
    expect(await rows(u.id)).toEqual([expect.objectContaining({ id: first.id, dup_count: 1 })]);
    // Повтор не тратит лимит: ещё две разные проходят.
    expect((await submit(u.id, 'Другое')).result).toBe('ok');
    expect((await submit(u.id, 'Третье')).result).toBe('ok');
  });

  it('повтор чужого текста или через сутки — новая жалоба; пустой текст повтором не считается', async () => {
    const a = await user();
    const b = await user();
    await submit(a.id, 'Белый экран');
    expect((await submit(b.id, 'Белый экран')).result).toBe('ok');
    await age(a.id, 25 * 60);
    expect((await submit(a.id, 'Белый экран')).result).toBe('ok');
    const c = await user();
    expect((await submit(c.id, '', { attachments: [{ kind: 'tg_photo', file_id: 'f1' }] })).result).toBe('ok');
    expect((await submit(c.id, '', { attachments: [{ kind: 'tg_photo', file_id: 'f2' }] })).result).toBe('ok');
  });

  it('потолок проекта за сутки — общий на всех', async () => {
    const before = (await sb.from('feedback').select('id', { count: 'exact', head: true }).gte('created_at', new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString())).count ?? 0;
    const a = await user();
    const b = await user();
    expect((await submit(a.id, 'Первая', { project: before + 1 })).result).toBe('ok');
    expect(await submit(b.id, 'Вторая', { project: before + 1 })).toEqual({ result: 'project_limit' });
  });

  it('одновременные отправки не проходят лимит вдвоём', async () => {
    const u = await user();
    await submit(u.id, 'Раз');
    await submit(u.id, 'Два');
    const results = await Promise.all(['Три', 'Четыре', 'Пять'].map((t) => submit(u.id, t)));
    expect(results.filter((r) => r.result === 'ok')).toHaveLength(1);
    expect(await rows(u.id)).toHaveLength(3);
  });

  it('удалили человека — его жалобы и черновик уходят вместе с ним', async () => {
    const u = await user();
    await submit(u.id, 'Жалоба');
    expect((await sb.from('feedback_drafts').insert({ user_id: u.id, chat_id: u.id, text: 'черновик' })).error).toBeNull();
    expect((await sb.from('users').delete().eq('id', u.id)).error).toBeNull();
    expect(await rows(u.id)).toEqual([]);
    expect((await sb.from('feedback_drafts').select('user_id').eq('user_id', u.id)).data).toEqual([]);
  });
});
