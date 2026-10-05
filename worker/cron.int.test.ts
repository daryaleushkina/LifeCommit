// Напоминания утром и вечером (окно 15 минут по часам человека) и тик cron целиком.
// Напоминания зовём напрямую (sendReminders), а не cronTick: тик заодно синхронизирует календари всех в базе —
// не трогаем чужие тесты календарей, которые идут рядом. Тик целиком — отдельной проверкой ниже.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendReminders } from './cron';
import { localTime, logicalDay, minutesOf, weekdayIndex, weekStart } from './day';
import type { Env } from './env';
import worker from './index';
import { ctx, dbReady, env, sb, tg, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('cron-тесты пропущены: нет локальной Supabase (pnpm db:start)');

const TZ = 'Asia/Tokyo';
const pad = (n: number) => String(n).padStart(2, '0');
/** Время по часам человека m минут назад (отрицательное — впереди), «HH:MM». */
const ago = (m: number) => {
  const t = (((minutesOf(localTime(TZ)) - m) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};
const today = () => logicalDay(TZ, 4);

/** Человек, которому бот может писать, с такими напоминаниями. */
async function remindable(patch: Record<string, unknown>, lang = 'ru') {
  const u = await user({ timezone: TZ, lang });
  const { error } = await sb.from('users').update({ bot_chat_ok: true, ...patch }).eq('id', u.id);
  if (error) throw error;
  return u;
}
const habit = async (u: TestUser, title: string, more: object = {}) => (await u.call('POST', '/tasks', { title, kind: 'check', target: 1, schedule: 'daily', ...more })).body.id as number;
const check = (u: TestUser, taskId: number) => u.call('PUT', '/logs', { task_id: taskId, value: 1, day: today() });

/** Что бот написал этому человеку (в базе бывают и чужие тестовые пользователи). */
const toChat = (chat: number) => tg.sent('sendMessage').filter((c) => c.body.chat_id === chat);
const lines = (chat: number, i = 0) => (toChat(chat)[i]?.body.text as string).split('\n');
const remind = () => sendReminders(env, env.APP_URL);
const userRow = async (id: number) => (await sb.from('users').select('bot_chat_ok, last_morning_reminder, last_evening_reminder').eq('id', id).single()).data!;

// Отказы Telegram конкретным чатам: подменяем fetch поверх harness (вызов всё равно записывается в tg.calls).
const harnessFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = harnessFetch;
  vi.restoreAllMocks();
});
function refuse(chats: Record<number, string>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.endsWith('/sendMessage')) {
      const description = chats[((await req.clone().json()) as { chat_id: number }).chat_id];
      if (description) {
        await harnessFetch(req);
        return Response.json({ ok: false, error_code: 403, description });
      }
    }
    return harnessFetch(req);
  }) as typeof fetch;
}

describe.skipIf(!ready)('напоминания', () => {
  it('утро: план — только неотмеченное и неотложенное; день запоминаем, второй раз не шлём', async () => {
    const u = await remindable({ remind_morning: ago(5) });
    await habit(u, 'Спортзал', { emoji: '🏋️' });
    await habit(u, 'Читать');
    await check(u, await habit(u, 'Отмечено'));
    await u.call('POST', `/tasks/${await habit(u, 'Отложено')}/archive`);

    await remind();
    const [msg] = toChat(u.id);
    expect(lines(u.id).slice(0, 2)).toEqual(['Доброе утро ☀️ План на сегодня:', '']);
    expect(lines(u.id).slice(2).sort()).toEqual(['• Читать', '🏋️ Спортзал']);
    expect(msg!.body.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Отметить', web_app: { url: `${env.APP_URL}/app/` } }]] });
    expect(await userRow(u.id)).toMatchObject({ last_morning_reminder: today(), last_evening_reminder: null });

    await remind();
    expect(toChat(u.id)).toHaveLength(1);
  });

  it('утро по-английски', async () => {
    const u = await remindable({ remind_morning: ago(1) }, 'en');
    await habit(u, 'Read');
    await remind();
    expect(toChat(u.id)[0]!.body.text).toBe("Good morning ☀️ Today's plan:\n\n• Read");
    expect((toChat(u.id)[0]!.body.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard[0]![0]!.text).toBe('Check in');
  });

  it('вечер: сколько осталось, в списке не больше пяти', async () => {
    const u = await remindable({ remind_evening: ago(14) });
    for (let i = 1; i <= 7; i++) await habit(u, `Дело ${i}`);
    await remind();
    expect(lines(u.id)[0]).toBe('Осталось 7 🌙 Даже немного — уже засчитается:');
    expect(lines(u.id).slice(2)).toHaveLength(5);
    expect(await userRow(u.id)).toMatchObject({ last_morning_reminder: null, last_evening_reminder: today() });
  });

  it('вечер по-английски', async () => {
    const u = await remindable({ remind_evening: ago(0) }, 'en');
    await habit(u, 'Read');
    await habit(u, 'Walk');
    await remind();
    expect(lines(u.id)[0]).toBe('2 left 🌙 Even a little counts:');
  });

  it('окно — 15 минут от времени напоминания: раньше и позже не шлём', async () => {
    const due = await remindable({ remind_morning: ago(0) });
    const late = await remindable({ remind_morning: ago(15) });
    const early = await remindable({ remind_evening: ago(-10) });
    for (const u of [due, late, early]) await habit(u, 'Читать');
    await remind();
    expect(toChat(due.id)).toHaveLength(1);
    expect(toChat(late.id)).toEqual([]);
    expect(toChat(early.id)).toEqual([]);
    expect(await userRow(late.id)).toMatchObject({ last_morning_reminder: null });
  });

  it('утро и вечер в одном окне: сначала утро, на следующем тике — вечер, потом тишина', async () => {
    const u = await remindable({ remind_morning: ago(3), remind_evening: ago(3) });
    await habit(u, 'Читать');
    await remind();
    await remind();
    await remind();
    expect(toChat(u.id).map((c) => (c.body.text as string).split('\n')[0])).toEqual(['Доброе утро ☀️ План на сегодня:', 'Осталось 1 🌙 Даже немного — уже засчитается:']);
  });

  it('уже напоминали сегодня — молчим', async () => {
    const u = await remindable({ remind_morning: ago(2), last_morning_reminder: today() });
    await habit(u, 'Читать');
    await remind();
    expect(toChat(u.id)).toEqual([]);
  });

  it('всё отмечено или привычек нет — молчим, но день запомнили', async () => {
    const done = await remindable({ remind_evening: ago(1) });
    await check(done, await habit(done, 'Читать'));
    const empty = await remindable({ remind_morning: ago(1) });
    await remind();
    expect(toChat(done.id)).toEqual([]);
    expect(toChat(empty.id)).toEqual([]);
    expect((await userRow(done.id)).last_evening_reminder).toBe(today());
    expect((await userRow(empty.id)).last_morning_reminder).toBe(today());
  });

  it('по дням недели — только в свой день; «N раз в неделю» — пока норма недели не набрана', async () => {
    const u = await remindable({ remind_morning: ago(1) });
    const day = today();
    const idx = weekdayIndex(day);
    await habit(u, 'Сегодняшний день', { schedule: 'weekdays', weekdays: 1 << idx });
    await habit(u, 'Другой день', { schedule: 'weekdays', weekdays: 1 << ((idx + 1) % 7) });
    await habit(u, 'Дважды в неделю', { schedule: 'per_week', per_week: 2 });
    const once = await habit(u, 'Раз в неделю', { schedule: 'per_week', per_week: 1 });
    // норма уже набрана в начале недели (или сегодня, если сегодня понедельник)
    await sb.from('task_logs').insert({ task_id: once, user_id: u.id, day: weekStart(day), value: 1 });
    await remind();
    expect(lines(u.id).slice(2).sort()).toEqual(['• Дважды в неделю', '• Сегодняшний день']);
  });

  it('напоминания выключены или бот не запущен — не пишем', async () => {
    const off = await remindable({ remind_morning: null, remind_evening: null });
    const noBot = await user({ timezone: TZ });
    await sb.from('users').update({ remind_morning: ago(1), bot_chat_ok: false }).eq('id', noBot.id);
    for (const u of [off, noBot]) await habit(u, 'Читать');
    await remind();
    expect(toChat(off.id)).toEqual([]);
    expect(toChat(noBot.id)).toEqual([]);
    expect(await userRow(noBot.id)).toMatchObject({ last_morning_reminder: null });
  });

  it('заблокировал бота — больше не пишем; временный отказ Telegram личку не выключает', async () => {
    const blocked = await remindable({ remind_morning: ago(1) });
    const gone = await remindable({ remind_morning: ago(1) });
    const busy = await remindable({ remind_morning: ago(1) });
    for (const u of [blocked, gone, busy]) await habit(u, 'Читать');
    refuse({ [blocked.id]: 'Forbidden: bot was blocked by the user', [gone.id]: 'Forbidden: user is deactivated', [busy.id]: 'Too Many Requests: retry after 5' });
    await remind();
    expect(toChat(blocked.id)).toHaveLength(1);
    expect((await userRow(blocked.id)).bot_chat_ok).toBe(false);
    expect((await userRow(gone.id)).bot_chat_ok).toBe(false);
    expect((await userRow(busy.id)).bot_chat_ok).toBe(true);
  });

  it('связанные аккаунты получают то же; там бот не запущен — не страшно', async () => {
    const a1 = 9_200_000_000_000 + Math.floor(Math.random() * 1e9);
    const a2 = a1 + 1;
    const u = await remindable({ remind_evening: ago(1), telegram_aliases: [a1, a2] });
    await habit(u, 'Читать');
    refuse({ [a1]: 'Bad Request: chat not found' });
    await remind();
    const main = toChat(u.id)[0]!.body;
    expect(toChat(a1)[0]!.body).toEqual({ ...main, chat_id: a1 });
    expect(toChat(a2)[0]!.body).toEqual({ ...main, chat_id: a2 });
    expect((await userRow(u.id)).bot_chat_ok).toBe(true);
  });

  it('много напоминаний разом — пачками по 25: следующая пачка начинается, когда отправлена прошлая', async () => {
    const people = await Promise.all(Array.from({ length: 30 }, () => remindable({ remind_morning: ago(1) })));
    await Promise.all(people.map((u) => habit(u, 'Читать')));
    const mine = new Set(people.map((u) => u.id));
    // «start» — напоминание начали собирать (запрос привычек человека), «sent» — Telegram ответил на отправку
    const events: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/rest/v1/tasks' && mine.has(Number(url.searchParams.get('user_id')?.slice(3)))) events.push('start');
      const chat = url.pathname.endsWith('/sendMessage') ? ((await req.clone().json()) as { chat_id: number }).chat_id : null;
      const res = await harnessFetch(req);
      if (chat !== null && mine.has(chat)) events.push('sent');
      return res;
    }) as typeof fetch;
    await remind();
    expect(events.filter((e) => e === 'sent')).toHaveLength(30);
    expect(events.filter((e) => e === 'start')).toHaveLength(30);
    // до первой отправки начаты не больше одной пачки (раньше — все 30 сразу)
    expect(events.indexOf('sent')).toBeLessThanOrEqual(25);
  });

  it('база не ответила — ошибка наружу (cron увидит сбой)', async () => {
    await expect(sendReminders({ ...env, SUPABASE_SECRET_KEY: 'not-a-key' }, env.APP_URL)).rejects.toBeTruthy();
  });
});

/** Тик cron с другим окружением: как его запускает Cloudflare. Итог — 'ok' или ошибка самого обработчика. */
async function tick(patch: Partial<Env> = {}) {
  const c = ctx();
  const run = worker.scheduled!({ cron: '*/15 * * * *', scheduledTime: Date.now(), type: 'scheduled', noRetry() {} } as unknown as ScheduledController, { ...env, ...patch }, c as unknown as ExecutionContext);
  const result = await run.then(
    () => 'ok' as const,
    (e: unknown) => e,
  );
  await c.settle();
  return result;
}

describe.skipIf(!ready)('тик cron', () => {
  it('напоминания, чаты групп и календари — в одном тике', async () => {
    const u = await remindable({ remind_morning: ago(1) });
    await habit(u, 'Читать');
    // Без ключа календарей их синхронизация сразу выходит: она общая на всю базу, а рядом идут тесты календарей.
    expect(await tick({ CALENDAR_KEY: '' })).toBe('ok');
    expect(toChat(u.id)).toHaveLength(1);
  });

  it('сбой календарей или чатов групп не роняет тик — только в лог', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // ключ базы неверный: напоминания и календари падают, тик — нет
    expect(await tick({ SUPABASE_SECRET_KEY: 'not-a-key' })).toBe('ok');
    expect(errors.mock.calls.some(([m]) => m === 'calendar cron failed')).toBe(true);
    // адреса базы нет вовсе: чаты групп падают сразу (в лог), сам тик — с ошибкой
    expect(await tick({ SUPABASE_URL: 'not a url' })).toBeInstanceOf(Error);
    expect(errors.mock.calls.some(([m]) => m === 'group chats failed')).toBe(true);
  });
});
