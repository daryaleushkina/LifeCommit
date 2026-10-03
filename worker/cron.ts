import { logicalDay, localTime, minutesOf, weekdayIndex, weekStart } from './day';
import { db, tg, type Env } from './env';

interface ReminderUser {
  id: number;
  language_code: string;
  timezone: string;
  day_start_hour: number;
  remind_morning: string | null;
  remind_evening: string | null;
  last_morning_reminder: string | null;
  last_evening_reminder: string | null;
  /** Связанные аккаунты Telegram того же человека — напоминание приходит и туда. */
  telegram_aliases: number[];
}

const WINDOW_MIN = 15; // cron раз в 15 минут

/** Попадает ли «сейчас» в окно [время напоминания; +15 мин). */
function isDue(remind: string | null, now: string): boolean {
  if (!remind) return false;
  const diff = (minutesOf(now) - minutesOf(remind) + 1440) % 1440;
  return diff < WINDOW_MIN;
}

export async function sendReminders(env: Env, appUrl: string): Promise<void> {
  const sb = db(env);
  const { data: users, error } = await sb
    .from('users')
    .select('id, language_code, timezone, day_start_hour, remind_morning, remind_evening, last_morning_reminder, last_evening_reminder, telegram_aliases')
    .eq('bot_chat_ok', true)
    .or('remind_morning.not.is.null,remind_evening.not.is.null')
    .returns<ReminderUser[]>();
  if (error) throw error;

  const jobs: (() => Promise<void>)[] = [];
  for (const u of users ?? []) {
    const now = localTime(u.timezone);
    const day = logicalDay(u.timezone, u.day_start_hour);
    const morning = isDue(u.remind_morning, now) && u.last_morning_reminder !== day;
    const evening = isDue(u.remind_evening, now) && u.last_evening_reminder !== day;
    if (morning || evening) jobs.push(() => remindOne(env, u, day, morning ? 'morning' : 'evening', appUrl));
  }
  // Параллельно, но пачками — у Bot API лимит ~30 сообщений в секунду. Пачка стартует, когда закончилась прошлая:
  // раньше в список клали уже запущенные remindOne, и «пачки» ничего не сдерживали — уходило всё разом.
  for (let i = 0; i < jobs.length; i += 25) await Promise.allSettled(jobs.slice(i, i + 25).map((job) => job()));
}

async function remindOne(env: Env, u: ReminderUser, day: string, kind: 'morning' | 'evening', appUrl: string) {
  const sb = db(env);
  const [{ data: tasks }, { data: logs }] = await Promise.all([
    sb.from('tasks').select('id, title, emoji, schedule, weekdays, per_week').eq('user_id', u.id).is('archived_at', null),
    sb.from('task_logs').select('task_id, day').eq('user_id', u.id).gte('day', weekStart(day)).lte('day', day),
  ]);
  const column = kind === 'morning' ? 'last_morning_reminder' : 'last_evening_reminder';
  await sb.from('users').update({ [column]: day }).eq('id', u.id);

  const done = new Set((logs ?? []).filter((l) => l.day === day).map((l) => l.task_id));
  const due = (tasks ?? []).filter((t) => {
    if (t.schedule === 'weekdays') return (t.weekdays & (1 << weekdayIndex(day))) !== 0;
    if (t.schedule === 'per_week') return (logs ?? []).filter((l) => l.task_id === t.id).length < (t.per_week ?? 7);
    return true;
  });
  const left = due.filter((t) => !done.has(t.id));
  if (!left.length) return;

  const ru = u.language_code === 'ru';
  const list = left.slice(0, 5).map((t) => `${t.emoji ?? '•'} ${t.title}`).join('\n');
  const text =
    kind === 'morning'
      ? ru ? `Доброе утро ☀️ План на сегодня:\n\n${list}` : `Good morning ☀️ Today's plan:\n\n${list}`
      : ru
        ? `Осталось ${left.length} 🌙 Даже немного — уже засчитается:\n\n${list}`
        : `${left.length} left 🌙 Even a little counts:\n\n${list}`;
  const message = { text, reply_markup: { inline_keyboard: [[{ text: ru ? 'Отметить' : 'Check in', web_app: { url: appUrl } }]] } };
  await tg(env, 'sendMessage', { chat_id: u.id, ...message }).catch(async (e: Error) => {
    // Человек заблокировал бота — больше не пишем.
    if (/blocked|deactivated|chat not found/i.test(e.message)) await sb.from('users').update({ bot_chat_ok: false }).eq('id', u.id);
  });
  // Связанные аккаунты: туда же; не вышло (бот там не запущен) — не страшно.
  for (const alias of u.telegram_aliases ?? []) await tg(env, 'sendMessage', { chat_id: alias, ...message }).catch(() => {});
}
