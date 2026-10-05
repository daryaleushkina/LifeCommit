// Вход на компьютере — подтверждение прямо в чате с ботом (решение владелицы 05.10.2026: «не обязательно апку
// открывать»). Компьютер открывает t.me/<бот>?start=mac_<билет> → Telegram присылает /start с билетом → бот спрашивает
// «Войти в LifeCommit на Mac?» с кнопками → «Войти» подтверждает тем же approveLogin, что и мини-апп (worker/desktop.ts).
// Кто нажал — Telegram сообщает в callback_query, вебхук проверен секретом: подтверждает именно этот аккаунт.
import { approveLogin, type ApproveResult } from './desktop';
import { byTelegram, db, tg, type Env } from './env';

/** /start mac_<билет> или web_<билет>: билет — код (22), время (7, base36), подпись (22). */
const START_RE = /^(mac|web)_([A-Za-z0-9_-]{22}[0-9a-z]{7}[A-Za-z0-9_-]{22})$/;

const texts = {
  ru: {
    ask: (where: string) => `Войти в LifeCommit ${where}?\n\nЕсли вход начали не вы — просто не нажимайте.`,
    mac: 'на Mac',
    web: 'в браузере',
    yes: 'Войти',
    no: 'Не входить',
    ok: 'Готово — LifeCommit на компьютере уже открывается.',
    declined: 'Хорошо, не входим.',
    used: 'Этот вход уже подтверждён.',
    expired: 'Ссылка устарела — начните вход на компьютере заново.',
    bad: 'Ссылка не подходит — начните вход на компьютере заново.',
  },
  en: {
    ask: (where: string) => `Sign in to LifeCommit ${where}?\n\nIf you didn't start this sign-in, just don't tap anything.`,
    mac: 'on a Mac',
    web: 'in a browser',
    yes: 'Sign in',
    no: 'Not now',
    ok: 'Done — LifeCommit is opening on your computer.',
    declined: 'OK, not signing in.',
    used: 'This sign-in is already confirmed.',
    expired: 'The link has expired — start the sign-in on your computer again.',
    bad: "This link doesn't work — start the sign-in on your computer again.",
  },
};
const pick = (code?: string | null) => (code?.startsWith('en') ? texts.en : texts.ru);

/** /start с билетом входа — спросить в чате. Вернёт false, если это не вход на компьютере. */
export async function askDesktopLogin(env: Env, chatId: number, param: string | undefined, languageCode?: string): Promise<boolean> {
  const m = START_RE.exec(param ?? '');
  if (!m) return false;
  const [, device, ticket] = m as unknown as [string, 'mac' | 'web', string];
  const t = pick(languageCode);
  await tg(env, 'sendMessage', {
    chat_id: chatId,
    text: t.ask(t[device]),
    // callback_data: «dl:» + m|w + билет — 55 байт из 64 разрешённых.
    reply_markup: { inline_keyboard: [[{ text: t.yes, callback_data: `dl:${device[0]}${ticket}` }, { text: t.no, callback_data: 'dl:no' }]] },
  });
  return true;
}

interface Press {
  id: string;
  from: { id: number; language_code?: string };
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}

/** Кнопка под вопросом: «dl:m<билет>» / «dl:w<билет>» — войти, «dl:no» — не входить. Сообщение сменяется итогом. */
export async function desktopLoginButton(env: Env, q: Press): Promise<void> {
  const data = q.data?.slice(3) ?? '';
  const sb = db(env);
  const { data: user, error } = await sb.from('users').select('id, language_code').or(byTelegram(q.from.id)).limit(1).maybeSingle<{ id: number; language_code: string }>();
  if (error) throw new Error(error.message);
  const t = pick(user?.language_code ?? q.from.language_code);
  let text = t.declined;
  if (data !== 'no') {
    const device = data[0] === 'm' ? 'mac' : data[0] === 'w' ? 'web' : null;
    // Пользователя нет (бота запускают /start — он заводит; это редкость) — подтверждать некому.
    const result: ApproveResult = device && user ? await approveLogin(env, sb, { ticket: data.slice(1), device, userId: user.id, telegramId: q.from.id }) : 'bad';
    text = t[result];
  }
  // Ответ на нажатие — только убрать крутилку на кнопке; не вышло — не страшно, итог всё равно в сообщении.
  await tg(env, 'answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
  if (q.message) await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text });
}
