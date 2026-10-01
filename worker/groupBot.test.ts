import { describe, expect, it } from 'vitest';
import { dayItem, type GroupItemRow } from '../shared/groups';
import { renderToday, type ChatGroup } from './groupBot';

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
