import { describe, expect, it } from 'vitest';
import { dayItem, type GroupItemRow } from '../shared/groups';
import { TgError } from './env';
import { chatFate, renderToday, type ChatGroup } from './groupBot';

const g: ChatGroup = { id: 7, title: 'Семья', owner_id: 1, tg_chat_id: -100, tg_today_msg_id: null, tg_today_day: null, tg_morning_day: null, tg_digest_day: null, chat_digest: true, owner: { timezone: 'Asia/Ho_Chi_Minh', day_start_hour: 4, language_code: 'ru' } };
const base: GroupItemRow = { id: 1, title: 'Ингаляция Тесле', mode: 'one', day: '2026-10-01', time: '21:00', duration_min: null, rrule: 'FREQ=DAILY', exdates: [], due_day: null, assignees: [], all_members: false, rotate: false, target: null, unit: null, goal_until: null, total: null, marks: [] };
const members = [{ id: 1, name: 'Даша', photo: null }, { id: 2, name: 'Маша', photo: null }];
const ids = [1, 2];
const day = '2026-10-02';

describe('сообщение «Сегодня в группе»', () => {
  it('сделанное — зачёркнуто с именем и без кнопки, несделанное — с кнопкой, мероприятие — без', () => {
    const items = [
      { ...base, marks: [{ user_id: 2, at: '' }] },
      { ...base, id: 2, title: 'Зарядка', time: null, mode: 'assign' as const, all_members: true, marks: [{ user_id: 1, at: '' }] },
      { ...base, id: 3, title: 'Ужин <семья>', mode: 'event' as const, rrule: null, day, time: '19:00' },
      { ...base, id: 4, title: 'Отпуск', mode: 'goal' as const, rrule: null, time: null, target: 150000, total: 62400 },
    ].map((it) => dayItem(it, ids, -1, day)!);
    const m = renderToday(g, { members, items }, day, 'LifeCommit_bot');
    expect(m.text).toContain('<b>Сегодня в «Семья»</b> · 2 из 3');
    expect(m.text).toContain('✓ <s>Ингаляция Тесле</s> · 21:00 — Маша');
    expect(m.text).toContain('◐ Зарядка — 1 из 2');
    expect(m.text).toContain('· Ужин &lt;семья&gt; · 19:00');
    expect(m.text).toMatch(/Отпуск: 62\s400 из 150\s000/);
    const buttons = m.reply_markup.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(['✓ Зарядка', 'Открыть ↗']);
    expect(buttons[0]).toMatchObject({ callback_data: `gm:2:${day}` });
    expect(m.left.map((x) => x.title)).toEqual(['Зарядка']);
  });
});

describe('сообщение «Сегодня в группе»: кто делает', () => {
  it('очередь, назначенное одному и нескольким, отметивший ушёл из группы, цель без чисел — по-английски', () => {
    const en: ChatGroup = { ...g, title: 'Team', owner: { timezone: 'Asia/Ho_Chi_Minh', day_start_hour: 4, language_code: 'en' } };
    const rows: GroupItemRow[] = [
      { ...base, id: 1, title: 'Trash', mode: 'assign', assignees: [1, 2], rotate: true },
      { ...base, id: 2, title: 'Dishes', mode: 'assign', assignees: [2], time: null },
      { ...base, id: 3, title: 'Workout', mode: 'assign', all_members: true, time: '07:00', marks: [{ user_id: 1, at: '' }] },
      { ...base, id: 4, title: 'Cat food', rrule: null, time: null, marks: [{ user_id: 99, at: '' }] },
      { ...base, id: 5, title: 'Trip', mode: 'goal', rrule: null, time: null },
    ];
    const m = renderToday(en, { members, items: rows.map((it) => dayItem(it, ids, -1, day)!) }, day, 'LifeCommit_bot');
    expect(m.text.split('\n\n')).toEqual([
      '<b>Today in “Team”</b> · 2 of 5',
      // Со вчерашнего начала очередь сегодня у второго; время — по порядку, без времени — в конце.
      ["◐ Workout · 07:00 — 1 of 2", "○ Trash · 21:00 — Маша's turn", '○ Dishes — Маша', '✓ <s>Cat food</s> — …', 'Trip: 0 of 0'].join('\n'),
      '<i>Reply to this message with text or voice to add to-dos.</i>',
    ]);
    expect(m.reply_markup.inline_keyboard.flat().map((b) => b.text)).toEqual(['✓ Workout', '✓ Trash', '✓ Dishes', 'Open ↗']);
  });

  it('кнопок не больше восьми, длинное название в кнопке обрезается', () => {
    const rows = Array.from({ length: 10 }, (_, i): GroupItemRow => ({ ...base, id: i + 1, title: `Очень длинное название дела номер ${i + 1}` }));
    const m = renderToday(g, { members, items: rows.map((it) => dayItem(it, ids, -1, day)!) }, day, 'LifeCommit_bot');
    const buttons = m.reply_markup.inline_keyboard;
    expect(buttons).toHaveLength(9);
    expect(buttons[0]![0]!.text).toBe('✓ Очень длинное название дела…');
    expect(m.left).toHaveLength(10);
  });
});

// Отвязать чат можно только когда Telegram прямо сказал, что его нет: временная беда не должна снимать привязку.
describe('чат пропал: chatFate', () => {
  it('чат удалён или бота убрали — gone', () => {
    expect(chatFate(new TgError('sendMessage', 400, 'Bad Request: chat not found'))).toBe('gone');
    expect(chatFate(new TgError('sendMessage', 403, 'Forbidden: bot was kicked from the group chat'))).toBe('gone');
    expect(chatFate(new TgError('sendMessage', 403, 'Forbidden: the group chat was deleted'))).toBe('gone');
    expect(chatFate(new TgError('getChatMember', 400, 'Bad Request: group chat was deactivated'))).toBe('gone');
  });

  it('стал супергруппой — новый id', () => {
    expect(chatFate(new TgError('sendMessage', 400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -1009876 }))).toBe(-1009876);
  });

  it('лимит, сеть и прочее — привязку не трогаем', () => {
    expect(chatFate(new TgError('sendMessage', 429, 'Too Many Requests: retry after 5', { retry_after: 5 }))).toBeNull();
    expect(chatFate(new TgError('editMessageText', 400, 'Bad Request: message is not modified'))).toBeNull();
    expect(chatFate(new TgError('sendMessage', 502, 'Bad Gateway'))).toBeNull();
    expect(chatFate(new Error('network connection lost'))).toBeNull();
  });
});
