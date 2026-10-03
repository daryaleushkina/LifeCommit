// Невидимые и управляющие символы в тексте человека, который видят другие (решение владелицы 04.10.2026):
// при записи вычищаются — названия дел, привычек, групп, групповых дел, подзадачи, место, имя из Telegram.
// Эмодзи-последовательности с ZWJ остаются целыми.
import { describe, expect, it } from 'vitest';
import { dbReady, sb, user } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('тесты очистки текста пропущены: нет локальной Supabase (pnpm db:start)');

const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
/** Название с подменой направления, нулевой шириной, мягким переносом и переводом строки — и эмодзи-семьёй. */
const dirty = (s: string) => `\u202E${s}\u200B\u00AD\n\u2066 ${FAMILY}\uFEFF`;
const clean = (s: string) => `${s} ${FAMILY}`;

describe.skipIf(!ready)('очистка текста при записи', () => {
  it('дело: создать и переименовать, место — без невидимых символов', async () => {
    const u = await user();
    const { body } = await u.call('POST', '/todos', { title: dirty('Купить хлеб'), location: '\u202EДом\u200B' });
    const row = async () => (await sb.from('todos').select('title, details').eq('id', body.id).single()).data!;
    expect(await row()).toMatchObject({ title: clean('Купить хлеб'), details: { location: 'Дом' } });
    expect((await u.call('PATCH', `/todos/${body.id}`, { title: dirty('Хлеб и молоко') })).status).toBe(200);
    expect((await row()).title).toBe(clean('Хлеб и молоко'));
  });

  it('привычка: название, единица и подзадачи; переименование', async () => {
    const u = await user();
    const { body } = await u.call('POST', '/tasks', { title: dirty('Вода'), kind: 'count', target: 8, unit: '\u200Bстаканов\u202E', subtasks: [dirty('Утром')] });
    const id = body.id as number;
    const task = async () => (await sb.from('tasks').select('title, unit').eq('id', id).single()).data!;
    expect(await task()).toEqual({ title: clean('Вода'), unit: 'стаканов' });
    const subs = (await sb.from('task_subtasks').select('title').eq('task_id', id)).data!;
    expect(subs).toEqual([{ title: clean('Утром') }]);
    expect((await u.call('PATCH', `/tasks/${id}`, { title: dirty('Вода днём') })).status).toBe(200);
    expect((await task()).title).toBe(clean('Вода днём'));
  });

  it('группа: создать, переименовать, дело группы; одни невидимые символы — как пустое название', async () => {
    const u = await user();
    expect((await u.call('POST', '/groups', { title: '\u200B\u202E\u3164' })).status).toBe(400);
    const { body } = await u.call('POST', '/groups', { title: dirty('Семья') });
    const gid = body.id as number;
    const title = async () => (await sb.from('groups').select('title').eq('id', gid).single()).data!.title;
    expect(await title()).toBe(clean('Семья'));
    expect((await u.call('PATCH', `/groups/${gid}`, { title: dirty('Дом') })).status).toBe(200);
    expect(await title()).toBe(clean('Дом'));
    const item = await u.call('POST', `/groups/${gid}/items`, { title: dirty('Полить цветы'), mode: 'one' });
    expect(item.status).toBe(201);
    expect((await sb.from('group_items').select('title').eq('id', item.body.id).single()).data!.title).toBe(clean('Полить цветы'));
  });

  it('имя из Telegram при входе — без подмены направления и «пустого» филлера', async () => {
    const u = await user({ name: `\u202EДаша\u200B ${FAMILY}` });
    expect((await sb.from('users').select('first_name').eq('id', u.id).single()).data!.first_name).toBe(`Даша ${FAMILY}`);
    const blank = await user({ name: '\u3164' });
    expect((await sb.from('users').select('first_name').eq('id', blank.id).single()).data!.first_name).toBe('');
  });
});
