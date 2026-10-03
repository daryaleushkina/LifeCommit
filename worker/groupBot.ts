// Бот в чате группы: привязка чата, «Сегодня в группе» с кнопками-отметками, новые дела ответом
// на сообщение бота (текстом или голосом), утренний список и вечерний итог. docs/groups-architecture.md.
import type { SupabaseClient } from '@supabase/supabase-js';
import { dayCount, dayItem, type GroupDayItem, type GroupItemRow, type GroupMember } from '../shared/groups';
import { MAX_VOICE_SECONDS } from '../shared/types';
import { takeVoiceQuota, USER_COLS, type UserRow } from './api';
import { logicalDay, localTime } from './day';
import { byTelegram, db, tg, TgError, type Env } from './env';
import { markItem } from './groups';
import { parseGroupItems, type GroupDraft } from './groupVoice';
import { transcribe } from './voice';

interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
}
interface TgChat {
  id: number;
  type: string;
  title?: string;
}
export interface GroupUpdate {
  message?: {
    message_id: number;
    chat: TgChat;
    from?: TgUser;
    text?: string;
    voice?: { file_id: string; duration: number };
    reply_to_message?: { from?: TgUser };
    /** Служебные: чат переименовали; обычная группа стала супергруппой (у неё новый id). */
    new_chat_title?: string;
    migrate_to_chat_id?: number;
    migrate_from_chat_id?: number;
  };
  my_chat_member?: { chat: TgChat; from: TgUser; new_chat_member: { status: string; user: TgUser } };
  callback_query?: { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: TgChat } };
}

const isGroupChat = (c?: TgChat) => c?.type === 'group' || c?.type === 'supergroup';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const T = {
  ru: {
    hello: (title: string) => `Привет! Этот чат теперь — группа «${title}» в LifeCommit.\n\nОтвечайте на мои сообщения текстом или голосом — добавлю общие дела. Отмечать можно кнопками прямо здесь.`,
    needApp: 'Чтобы подключить этот чат, откройте LifeCommit — это пара секунд.',
    connectFailed: 'Не получилось подключить этот чат. Уберите бота из чата и добавьте ещё раз чуть позже.',
    bye: (title: string) => `Этот чат отключили от группы «${title}» в LifeCommit. Пока!`,
    adminsOnly: (title: string) => `Подключить чат к группе «${title}» может только её создатель или админ.`,
    open: 'Открыть LifeCommit',
    openGroup: 'Открыть ↗',
    today: (title: string) => `Сегодня в «${title}»`,
    of: (d: number, p: number) => `${d} из ${p}`,
    turn: (n: string) => `очередь: ${n}`,
    hint: 'Ответьте на это сообщение текстом или голосом — добавлю дела.',
    empty: 'На сегодня дел нет.',
    done: 'Готово ✓',
    undone: 'Отметка снята',
    notYours: 'Это дело сегодня не на тебе',
    taken: 'Уже кто-то сделал',
    joinFirst: 'Сначала откройте LifeCommit и вступите в группу',
    heard: (t: string) => `Расслышал: «${t}»`,
    added: (title: string) => `Добавил в «${title}»:`,
    nothing: 'Не понял, что добавить. Скажите, например: «завтра купить корм Тесле, ингаляция каждый день в девять вечера».',
    undo: 'Отменить',
    undoneAll: 'Отменено — эти дела удалены.',
    limit: 'На сегодня хватит: разбираю до 20 сообщений в день на человека.',
    tooLong: 'Слишком длинное сообщение — до полутора минут.',
    failed: 'Не получилось разобрать. Попробуйте ещё раз чуть позже.',
    digest: (title: string) => `Итоги дня в «${title}»`,
    allDone: 'Всё сделали — отличный день!',
    madeOf: (d: number, p: number) => `Сделали ${d} из ${p}.`,
    left: (list: string) => `Осталось: ${list}.`,
    joinBtn: 'Вступить в группу',
    joinText: 'Откройте LifeCommit — и дела группы появятся у вас на «Сегодня».',
    goal: (title: string, v: string, t: string) => `${title}: ${v} из ${t}`,
    d: {
      anyone: 'кто-то один',
      event: 'мероприятие',
      each: 'каждому',
      turns: (names: string) => `по очереди: ${names}`,
      goal: (v: string) => `общая цель: ${v}`,
      daily: 'каждый день',
      weekdays: 'по будням',
      weekends: 'по выходным',
      today: 'сегодня',
      wd: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
    },
  },
  en: {
    hello: (title: string) => `Hi! This chat is now the “${title}” group in LifeCommit.\n\nReply to my messages with text or voice and I'll add shared to-dos. Check them off with the buttons right here.`,
    needApp: 'To connect this chat, open LifeCommit — it takes a couple of seconds.',
    connectFailed: 'Could not connect this chat. Remove the bot from the chat and add it again a bit later.',
    bye: (title: string) => `This chat was disconnected from the “${title}” group in LifeCommit. Bye!`,
    adminsOnly: (title: string) => `Only the owner or an admin of “${title}” can connect a chat to it.`,
    open: 'Open LifeCommit',
    openGroup: 'Open ↗',
    today: (title: string) => `Today in “${title}”`,
    of: (d: number, p: number) => `${d} of ${p}`,
    turn: (n: string) => `${n}'s turn`,
    hint: 'Reply to this message with text or voice to add to-dos.',
    empty: 'Nothing for today.',
    done: 'Done ✓',
    undone: 'Unchecked',
    notYours: 'This one is not on you today',
    taken: 'Someone already did it',
    joinFirst: 'Open LifeCommit and join the group first',
    heard: (t: string) => `I heard: “${t}”`,
    added: (title: string) => `Added to “${title}”:`,
    nothing: 'I could not tell what to add. Try: “tomorrow buy cat food, inhaler every day at 9 pm”.',
    undo: 'Undo',
    undoneAll: 'Undone — those to-dos were removed.',
    limit: "That's enough for today: up to 20 messages a day per person.",
    tooLong: 'That message is too long — keep it under a minute and a half.',
    failed: 'Could not process it. Please try again later.',
    digest: (title: string) => `Today in “${title}” — summary`,
    allDone: 'Everything done — great day!',
    madeOf: (d: number, p: number) => `Done ${d} of ${p}.`,
    left: (list: string) => `Left: ${list}.`,
    joinBtn: 'Join the group',
    joinText: "Open LifeCommit — the group's to-dos will show up on your Today.",
    goal: (title: string, v: string, t: string) => `${title}: ${v} of ${t}`,
    d: {
      anyone: 'anyone',
      event: 'event',
      each: 'everyone',
      turns: (names: string) => `taking turns: ${names}`,
      goal: (v: string) => `shared goal: ${v}`,
      daily: 'every day',
      weekdays: 'on weekdays',
      weekends: 'on weekends',
      today: 'today',
      wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    },
  },
};
type Texts = typeof T.ru;

export interface ChatGroup {
  id: number;
  title: string;
  owner_id: number | null;
  tg_chat_id: number | null;
  tg_today_msg_id: number | null;
  tg_today_day: string | null;
  tg_morning_day: string | null;
  tg_digest_day: string | null;
  chat_digest: boolean;
  owner: { timezone: string; day_start_hour: number; language_code: string } | null;
}
const GROUP_COLS = 'id, title, owner_id, tg_chat_id, tg_today_msg_id, tg_today_day, tg_morning_day, tg_digest_day, chat_digest, owner:users!teams_owner_id_fkey(timezone, day_start_hour, language_code)';

const textsOf = (g: ChatGroup) => (g.owner?.language_code === 'en' ? T.en : T.ru);
const dayOf = (g: ChatGroup) => (g.owner ? logicalDay(g.owner.timezone, g.owner.day_start_hour) : new Date().toISOString().slice(0, 10));

async function groupByChat(sb: SupabaseClient, chatId: number): Promise<ChatGroup | null> {
  const { data } = await sb.from('groups').select(GROUP_COLS).eq('tg_chat_id', chatId).is('archived_at', null).maybeSingle();
  return data as unknown as ChatGroup | null;
}

async function appUser(sb: SupabaseClient, tgId: number): Promise<UserRow | null> {
  const { data } = await sb.from('users').select(USER_COLS).or(byTelegram(tgId)).limit(1).maybeSingle<UserRow>();
  return data;
}

/** Человек из чата, у которого есть LifeCommit, — сразу участник группы этого чата. */
async function ensureMember(sb: SupabaseClient, groupId: number, userId: number) {
  await sb.from('group_members').upsert({ group_id: groupId, user_id: userId, role: 'member' }, { onConflict: 'group_id,user_id', ignoreDuplicates: true });
}

/** Группа на день глазами чата (без «меня»): участники и дела. */
async function chatView(sb: SupabaseClient, g: ChatGroup, day: string): Promise<{ members: GroupMember[]; items: GroupDayItem[] }> {
  if (!g.owner_id) return { members: [], items: [] };
  const { data } = await sb.rpc('groups_today', { p_user: g.owner_id, p_day: day });
  const raw = ((data ?? []) as { id: number; members: GroupMember[] | null; items: GroupItemRow[] }[]).find((x) => x.id === g.id);
  const members = raw?.members ?? [];
  const ids = members.map((m) => m.id);
  return { members, items: (raw?.items ?? []).map((it) => dayItem(it, ids, -1, day)).filter((x) => x !== null) };
}

const numFmt = (lang: Texts) => new Intl.NumberFormat(lang === T.ru ? 'ru-RU' : 'en-US', { maximumFractionDigits: 2 });

/** Текст и кнопки сообщения «Сегодня в группе». */
export function renderToday(g: ChatGroup, view: { members: GroupMember[]; items: GroupDayItem[] }, day: string, bot: string) {
  const t = textsOf(g);
  const name = (id: number) => esc(view.members.find((m) => m.id === id)?.name ?? '…');
  let planned = 0;
  let done = 0;
  const lines: string[] = [];
  const buttons: { text: string; callback_data: string }[][] = [];
  const fmt = numFmt(t);
  const sorted = [...view.items].sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
  for (const it of sorted) {
    const c = dayCount(it);
    planned += c.planned;
    done += c.done;
    const time = it.time ? ` · ${it.time}` : '';
    if (it.mode === 'goal') {
      lines.push(t.goal(esc(it.title), fmt.format(it.total ?? 0), fmt.format(it.target ?? 0)));
      continue;
    }
    if (it.mode === 'event') {
      lines.push(`· ${esc(it.title)}${time}`);
      continue;
    }
    const finished = c.planned > 0 && c.done === c.planned;
    const mark = finished ? '✓' : c.done > 0 ? '◐' : '○';
    let who = '';
    if (it.done_by.length && (it.mode === 'one' || it.turn !== null)) who = ` — ${it.done_by.map(name).join(', ')}`;
    else if (it.turn !== null) who = ` — ${t.turn(name(it.turn))}`;
    else if (it.mode === 'assign' && it.people.length === 1) who = ` — ${name(it.people[0]!)}`;
    else if (it.mode === 'assign' && c.planned > 1) who = ` — ${t.of(c.done, c.planned)}`;
    lines.push(`${mark} ${finished ? `<s>${esc(it.title)}</s>` : esc(it.title)}${time}${who}`);
    if (!finished && buttons.length < 8) buttons.push([{ text: `✓ ${cut(it.title, 28)}`, callback_data: `gm:${it.id}:${day}` }]);
  }
  const head = `<b>${esc(t.today(g.title))}</b>${planned ? ` · ${t.of(done, planned)}` : ''}`;
  const text = [head, lines.length ? lines.join('\n') : t.empty, `<i>${t.hint}</i>`].join('\n\n');
  const keyboard = [...buttons, [{ text: t.openGroup, url: `https://t.me/${bot}?startapp=grp_${g.id}` }]];
  return { text, reply_markup: { inline_keyboard: keyboard }, planned, done, left: sorted.filter((it) => { const c = dayCount(it); return c.planned > c.done; }) };
}

// ── Чат пропал: удалили, выгнали бота, стал супергруппой (решения владелицы 02.10.2026) ──

const NO_CHAT = { tg_chat_id: null, tg_chat_title: null, tg_today_msg_id: null, tg_today_day: null };

/** Отвязать чат от группы — вместе с названием (раньше название оставалось, и экран показывал «чат подключён»). */
async function unbind(sb: SupabaseClient, chatId: number) {
  await sb.from('groups').update(NO_CHAT).eq('tg_chat_id', chatId);
}

/**
 * Что значит отказ Telegram для привязки: 'gone' — чата для бота больше нет (удалён, выгнали, бот не участник);
 * число — чат стал супергруппой с этим id; null — временная беда (сеть, лимит), привязку не трогаем.
 */
export function chatFate(e: unknown): 'gone' | number | null {
  if (!(e instanceof TgError)) return null;
  if (e.parameters.migrate_to_chat_id) return e.parameters.migrate_to_chat_id;
  if (e.code === 403) return 'gone';
  if (e.code === 400 && /chat not found|deactivated|was deleted|not a member|kicked/i.test(e.description)) return 'gone';
  return null;
}

/** Ошибка при работе с чатом группы: чата нет — отвязываем молча, переехал — переносим привязку. true — разобрались. */
async function onChatError(sb: SupabaseClient, chatId: number, e: unknown): Promise<boolean> {
  const fate = chatFate(e);
  if (fate === 'gone') await unbind(sb, chatId);
  else if (typeof fate === 'number') await sb.from('groups').update({ tg_chat_id: fate, tg_today_msg_id: null, tg_today_day: null }).eq('tg_chat_id', chatId);
  return fate !== null;
}

const botId = (env: Env) => Number(env.TELEGRAM_BOT_TOKEN.split(':')[0]);

/** Бот ещё в чате? Ошибка сети — считаем, что да. */
async function botInChat(env: Env, chatId: number): Promise<boolean> {
  try {
    const m = await tg<{ status: string }>(env, 'getChatMember', { chat_id: chatId, user_id: botId(env) });
    return m.status !== 'left' && m.status !== 'kicked';
  } catch (e) {
    return chatFate(e) !== 'gone';
  }
}

/** Попрощаться и выйти из чата (отключили из приложения или подключили другой). Ошибки не важны — чата может уже не быть. */
async function leaveChat(env: Env, chatId: number, groupTitle: string, t: Texts) {
  await tg(env, 'sendMessage', { chat_id: chatId, text: t.bye(groupTitle), disable_notification: true }).catch(() => {});
  await tg(env, 'leaveChat', { chat_id: chatId }).catch(() => {});
}

/**
 * Проверка при открытии экрана группы: чат ещё есть и бот в нём? Нет — отвязываем. Заодно освежаем название.
 * Ответ — название подключённого чата или null.
 */
export async function checkChat(env: Env, groupId: number): Promise<string | null> {
  const sb = db(env);
  const { data } = await sb.from('groups').select('tg_chat_id, tg_chat_title').eq('id', groupId).maybeSingle<{ tg_chat_id: number | null; tg_chat_title: string | null }>();
  if (!data?.tg_chat_id) return null;
  const chatId = data.tg_chat_id;
  try {
    const [chat, inside] = await Promise.all([tg<{ id: number; title?: string }>(env, 'getChat', { chat_id: chatId }), botInChat(env, chatId)]);
    if (!inside) {
      await unbind(sb, chatId);
      return null;
    }
    if (chat.title && chat.title !== data.tg_chat_title) await sb.from('groups').update({ tg_chat_title: chat.title }).eq('id', groupId);
    return chat.title ?? data.tg_chat_title;
  } catch (e) {
    if (chatFate(e) === 'gone') {
      await unbind(sb, chatId);
      return null;
    }
    // Стал супергруппой — переносим и показываем то же название; прочие ошибки — оставляем как было.
    await onChatError(sb, chatId, e);
    return data.tg_chat_title;
  }
}

/** «Отключить» в настройках группы: бот прощается, выходит из чата, привязка снимается. */
export async function disconnectChat(env: Env, groupId: number): Promise<void> {
  const sb = db(env);
  const { data } = await sb.from('groups').select(GROUP_COLS).eq('id', groupId).maybeSingle();
  const g = data as unknown as ChatGroup | null;
  if (!g?.tg_chat_id) return;
  await unbind(sb, g.tg_chat_id);
  await leaveChat(env, g.tg_chat_id, g.title, textsOf(g));
}

/** Показать «Сегодня в группе»: сегодняшнее сообщение правим, на новый день — новое (и пробуем закрепить). */
export async function postToday(env: Env, sb: SupabaseClient, g: ChatGroup, forceNew = false): Promise<void> {
  if (!g.tg_chat_id) return;
  const day = dayOf(g);
  const msg = renderToday(g, await chatView(sb, g, day), day, env.BOT_USERNAME);
  if (!forceNew && g.tg_today_day === day && g.tg_today_msg_id) {
    try {
      await tg(env, 'editMessageText', { chat_id: g.tg_chat_id, message_id: g.tg_today_msg_id, text: msg.text, parse_mode: 'HTML', reply_markup: msg.reply_markup });
      return;
    } catch (e) {
      // «message is not modified» — всё и так актуально; удалили сообщение — пришлём новое.
      if (/not modified/i.test(String(e))) return;
    }
  }
  let sent: { message_id: number };
  try {
    sent = await tg<{ message_id: number }>(env, 'sendMessage', { chat_id: g.tg_chat_id, text: msg.text, parse_mode: 'HTML', reply_markup: msg.reply_markup, disable_notification: true });
  } catch (e) {
    // Чата больше нет — тихо отвязываем; стал супергруппой — переносим и шлём уже туда.
    if (!(await onChatError(sb, g.tg_chat_id, e))) throw e;
    const moved = chatFate(e);
    if (typeof moved === 'number') return postToday(env, sb, { ...g, tg_chat_id: moved, tg_today_msg_id: null, tg_today_day: null }, true);
    return;
  }
  await sb.from('groups').update({ tg_today_msg_id: sent.message_id, tg_today_day: day }).eq('id', g.id);
  await tg(env, 'pinChatMessage', { chat_id: g.tg_chat_id, message_id: sent.message_id, disable_notification: true }).catch(() => {});
}

/** После отметки в приложении — обновить сообщение в чате (если чат привязан). */
export async function refreshChat(env: Env, groupId: number): Promise<void> {
  const sb = db(env);
  const { data } = await sb.from('groups').select(GROUP_COLS).eq('id', groupId).not('tg_chat_id', 'is', null).maybeSingle();
  if (data) await postToday(env, sb, data as unknown as ChatGroup).catch((e) => console.error('chat refresh failed', e));
}

async function bindChat(env: Env, sb: SupabaseClient, groupId: number, chat: TgChat, t: Texts) {
  // Привязка — три записи без транзакции: не вышло — в лог и в чат «не получилось», а не привет неподключённому чату.
  const failed = async (error: unknown) => {
    console.error('group chat: bind failed', groupId, chat.id, error);
    await tg(env, 'sendMessage', { chat_id: chat.id, text: t.connectFailed });
  };
  // Чат мог быть привязан к другой группе — отвязываем (один чат — одна группа).
  const { error: unbindError } = await sb.from('groups').update(NO_CHAT).eq('tg_chat_id', chat.id).neq('id', groupId);
  if (unbindError) return failed(unbindError);
  const { data: before, error: readError } = await sb.from('groups').select(GROUP_COLS).eq('id', groupId).single();
  if (!before) return failed(readError);
  const old = before as unknown as ChatGroup;
  const { error: bindError } = await sb.from('groups').update({ tg_chat_id: chat.id, tg_chat_title: chat.title ?? null, tg_today_msg_id: null, tg_today_day: null }).eq('id', groupId);
  if (bindError) return failed(bindError);
  // «Другой чат»: из прежнего бот прощается и выходит — как при «Отключить».
  if (old.tg_chat_id && old.tg_chat_id !== chat.id) await leaveChat(env, old.tg_chat_id, old.title, textsOf(old));
  const { data } = await sb.from('groups').select(GROUP_COLS).eq('id', groupId).single();
  const g = data as unknown as ChatGroup;
  await tg(env, 'sendMessage', { chat_id: chat.id, text: textsOf(g).hello(g.title) });
  await postToday(env, sb, g, true);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Апдейт из группового чата (или про него). true — обработан здесь. */
export async function handleGroupUpdate(env: Env, u: GroupUpdate): Promise<boolean> {
  const sb = db(env);

  // Бота добавили в чат или убрали из него.
  if (u.my_chat_member && isGroupChat(u.my_chat_member.chat)) {
    const { chat, from, new_chat_member } = u.my_chat_member;
    const status = new_chat_member.status;
    if (status === 'left' || status === 'kicked') {
      await unbind(sb, chat.id);
      return true;
    }
    if (status !== 'member' && status !== 'administrator') return true;
    // Добавили по ссылке «в группу» — следом придёт /start g_<код>, он и привяжет. Ждём его чуть-чуть.
    await sleep(2500);
    if (await groupByChat(sb, chat.id)) return true;
    // По ссылке, но не админ группы — бот уже отказал и вышел: новую группу не заводим.
    if (!(await botInChat(env, chat.id))) return true;
    const user = await appUser(sb, from.id);
    const t = from.language_code?.startsWith('ru') ? T.ru : T.en;
    if (!user) {
      await tg(env, 'sendMessage', { chat_id: chat.id, text: t.needApp, reply_markup: { inline_keyboard: [[{ text: T.ru.open, url: `https://t.me/${env.BOT_USERNAME}?start=app` }]] } });
      return true;
    }
    // Группа и её владелец — два запроса без транзакции: не вышло — в лог и в чат, без группы-сироты.
    const { data: created, error: createError } = await sb.from('groups').insert({ title: cut(chat.title?.trim() || 'Группа', 60), kind: 'other', owner_id: user.id }).select('id').single<{ id: number }>();
    if (!created) {
      console.error('group from chat: create failed', chat.id, user.id, createError);
      await tg(env, 'sendMessage', { chat_id: chat.id, text: t.connectFailed });
      return true;
    }
    const { error: memberError } = await sb.from('group_members').insert({ group_id: created.id, user_id: user.id, role: 'owner' });
    if (memberError) {
      console.error('group from chat: owner not added', created.id, user.id, memberError);
      const { error: dropError } = await sb.from('groups').delete().eq('id', created.id);
      if (dropError) console.error('group from chat: orphan not removed', created.id, dropError);
      await tg(env, 'sendMessage', { chat_id: chat.id, text: t.connectFailed });
      return true;
    }
    await bindChat(env, sb, created.id, chat, t);
    return true;
  }

  // Кнопки под сообщениями бота в чате.
  const q = u.callback_query;
  if (q?.data?.startsWith('gm:') || q?.data?.startsWith('gu:')) {
    await onCallback(env, sb, q);
    return true;
  }

  const msg = u.message;
  if (msg && isGroupChat(msg.chat)) {
    if (msg.migrate_to_chat_id) {
      await sb.from('groups').update({ tg_chat_id: msg.migrate_to_chat_id, tg_today_msg_id: null, tg_today_day: null }).eq('tg_chat_id', msg.chat.id);
      return true;
    }
    if (msg.migrate_from_chat_id) {
      await sb.from('groups').update({ tg_chat_id: msg.chat.id, tg_today_msg_id: null, tg_today_day: null }).eq('tg_chat_id', msg.migrate_from_chat_id);
      return true;
    }
    if (msg.new_chat_title) {
      await sb.from('groups').update({ tg_chat_title: msg.new_chat_title }).eq('tg_chat_id', msg.chat.id);
      return true;
    }
  }
  if (!msg || !isGroupChat(msg.chat) || !msg.from || msg.from.is_bot) return false;
  const text = msg.text ?? '';
  const command = /^\/(start|today)(@\w+)?(?:\s+(\S+))?/i.exec(text);

  if (command) {
    const payload = command[3];
    if (command[1]!.toLowerCase() === 'start' && payload?.startsWith('g_')) {
      // Привязать чат к группе по ссылке-приглашению.
      const { data: inv } = await sb.from('invites').select('group_id, expires_at').eq('code', payload.slice(2)).maybeSingle<{ group_id: number | null; expires_at: string | null }>();
      if (inv?.group_id) {
        const user = await appUser(sb, msg.from.id);
        if (user) await ensureMember(sb, inv.group_id, user.id);
        // Подключают чат только создатель и админы группы (решение владелицы 02.10.2026).
        const { data: m } = user ? await sb.from('group_members').select('role').eq('group_id', inv.group_id).eq('user_id', user.id).maybeSingle<{ role: string }>() : { data: null };
        if (m?.role === 'owner' || m?.role === 'admin') {
          await bindChat(env, sb, inv.group_id, msg.chat, msg.from.language_code?.startsWith('en') ? T.en : T.ru);
        } else {
          const { data: target } = await sb.from('groups').select('title').eq('id', inv.group_id).maybeSingle<{ title: string }>();
          const t = msg.from.language_code?.startsWith('en') ? T.en : T.ru;
          await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: t.adminsOnly(target?.title ?? '…') }).catch(() => {});
          // Чат ни к чему не привязан — бот здесь не нужен.
          if (!(await groupByChat(sb, msg.chat.id))) await tg(env, 'leaveChat', { chat_id: msg.chat.id }).catch(() => {});
        }
      }
      return true;
    }
    const g = await groupByChat(sb, msg.chat.id);
    if (g) await postToday(env, sb, g, true);
    return true;
  }

  // Ответ на сообщение бота или упоминание — новые дела в группу.
  const toBot = msg.reply_to_message?.from?.is_bot || text.includes(`@${env.BOT_USERNAME}`);
  if (!toBot || (!text && !msg.voice)) return true;
  const g = await groupByChat(sb, msg.chat.id);
  if (!g) return true;
  await addFromChat(env, sb, g, msg);
  return true;
}

async function addFromChat(env: Env, sb: SupabaseClient, g: ChatGroup, msg: NonNullable<GroupUpdate['message']>) {
  const t = textsOf(g);
  const reply = (text: string, extra: object = {}) => tg(env, 'sendMessage', { chat_id: msg.chat.id, text, reply_parameters: { message_id: msg.message_id }, ...extra });
  const user = await appUser(sb, msg.from!.id);
  if (!user) {
    await reply(t.joinFirst, { reply_markup: { inline_keyboard: [[{ text: t.open, url: `https://t.me/${env.BOT_USERNAME}?start=app` }]] } });
    return;
  }
  await ensureMember(sb, g.id, user.id);
  try {
    if (msg.voice && msg.voice.duration > MAX_VOICE_SECONDS) return void (await reply(t.tooLong));
    if (!(await takeVoiceQuota(sb, user.id))) return void (await reply(t.limit));
    let text = (msg.text ?? '').replace(new RegExp(`@${env.BOT_USERNAME}`, 'gi'), '').trim();
    if (msg.voice) {
      await tg(env, 'sendChatAction', { chat_id: msg.chat.id, action: 'typing' });
      const file = await tg<{ file_path: string }>(env, 'getFile', { file_id: msg.voice.file_id });
      const audio = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
      text = await transcribe(env, await audio.arrayBuffer(), user.language_code === 'en' ? 'en' : 'ru');
    }
    const day = dayOf(g);
    const { members } = await chatView(sb, g, day);
    const drafts = text ? await parseGroupItems(env, text, day, members, user.id) : [];
    if (!drafts.length) return void (await reply([msg.voice && text ? t.heard(text) : '', t.nothing].filter(Boolean).join('\n\n')));
    const rows = drafts.map((d) => ({ ...d, group_id: g.id, created_by: user.id }));
    const { data: created } = await sb.from('group_items').insert(rows).select('id');
    const ids = ((created ?? []) as { id: number }[]).map((x) => x.id);
    const undoData = `gu:${ids.join(',')}`;
    const lines = drafts.map((d) => `• ${d.title} — ${describeDraft(d, members, day, t)}`);
    const body = [msg.voice ? t.heard(text) : '', `${t.added(g.title)}\n${lines.join('\n')}`].filter(Boolean).join('\n\n');
    await reply(body, { reply_markup: { inline_keyboard: [new TextEncoder().encode(undoData).length <= 64 ? [{ text: t.undo, callback_data: undoData }] : []] } });
    await postToday(env, sb, g);
  } catch (e) {
    console.error('group add failed', e);
    await reply(t.failed);
  }
}

/** «Алёна · каждый день», «по очереди: Даша → Петя · вт», «мероприятие · 3 окт, 19:00», «цель: 150 000 ₽». */
function describeDraft(d: GroupDraft, members: GroupMember[], today: string, t: Texts): string {
  const name = (id: number) => members.find((m) => m.id === id)?.name ?? '…';
  const fmt = numFmt(t);
  if (d.mode === 'goal') return t.d.goal(`${fmt.format(d.target ?? 0)}${d.unit?.currency ? ` ${d.unit.currency}` : d.unit ? ` ${d.unit.forms[2]}` : ''}`);
  const who =
    d.mode === 'one' ? t.d.anyone
    : d.mode === 'event' ? t.d.event
    : d.rotate ? t.d.turns((d.all_members ? members.map((m) => m.id) : d.assignees).map(name).join(' → '))
    : d.all_members ? t.d.each
    : d.assignees.map(name).join(', ');
  const r = d.rrule ?? '';
  const days = /BYDAY=([A-Z,]+)/.exec(r)?.[1]?.split(',') ?? [];
  const when =
    r === 'FREQ=DAILY' ? t.d.daily
    : days.join(',') === 'MO,TU,WE,TH,FR' ? t.d.weekdays
    : days.join(',') === 'SA,SU' ? t.d.weekends
    : days.length ? days.map((x) => t.d.wd[['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].indexOf(x)]).join(', ')
    : d.day === today ? t.d.today
    : new Date(`${d.day}T12:00:00Z`).toLocaleDateString(t === T.ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return [who, when + (d.time ? `, ${d.time}` : '')].join(' · ');
}

async function onCallback(env: Env, sb: SupabaseClient, q: NonNullable<GroupUpdate['callback_query']>) {
  const answer = (text?: string, extra: object = {}) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, ...(text && { text }), ...extra }).catch(() => {});
  const chatId = q.message?.chat.id;
  const g = chatId ? await groupByChat(sb, chatId) : null;
  if (!g) return void (await answer());
  const t = textsOf(g);
  const user = await appUser(sb, q.from.id);
  if (!user) {
    // Без LifeCommit отметить нельзя: открываем бота с приглашением — оттуда одной кнопкой в группу.
    const code = await inviteFor(sb, g.id, g.owner_id);
    return void (await answer(undefined, { url: `https://t.me/${env.BOT_USERNAME}?start=g_${code}` }));
  }
  await ensureMember(sb, g.id, user.id);

  if (q.data!.startsWith('gu:')) {
    const ids = q.data!.slice(3).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    // Удаляет только тот, кто добавил.
    const { data: removed } = ids.length
      ? await sb.from('group_items').update({ archived_at: new Date().toISOString() }).in('id', ids).eq('group_id', g.id).eq('created_by', user.id).select('id')
      : { data: [] };
    await answer();
    // Чужое нажатие ничего не удалило — сообщение не трогаем: иначе «Отменено» соврало бы
    // и вместе с кнопкой отняло отмену у того, кто добавил.
    if (!removed?.length) return;
    if (q.message) await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: t.undoneAll }).catch(() => {});
    await postToday(env, sb, g);
    return;
  }

  const [, itemPart, day] = q.data!.split(':');
  const itemId = Number(itemPart);
  // Нажали ещё раз на своё сделанное — снимаем отметку.
  const view = await chatView(sb, g, dayOf(g));
  const it = view.items.find((x) => x.id === itemId);
  const mine = it?.done_by.includes(user.id) ?? false;
  const res = await markItem(sb, user, g.id, itemId, !mine, day);
  await answer(res === 'forbidden' ? t.notYours : res === 'taken' ? t.taken : mine ? t.undone : t.done);
  await postToday(env, sb, g);
}

/** Действующая ссылка-приглашение группы (для людей из чата без LifeCommit). */
async function inviteFor(sb: SupabaseClient, groupId: number, ownerId: number | null): Promise<string> {
  const { data } = await sb.from('invites').select('code').eq('group_id', groupId).gt('expires_at', new Date(Date.now() + 86_400_000).toISOString()).limit(1).maybeSingle<{ code: string }>();
  if (data) return data.code;
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const code = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => abc[b % abc.length]).join('');
  await sb.from('invites').insert({ code, group_id: groupId, inviter_id: ownerId, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  return code;
}

// ── По расписанию: утром — список на день, вечером — итог ──

const MORNING = '08:00';
const EVENING = '21:00';
const inWindow = (now: string, at: string) => {
  const [h, m] = now.split(':').map(Number);
  const [ah, am] = at.split(':').map(Number);
  const d = h! * 60 + m! - (ah! * 60 + am!);
  return d >= 0 && d < 15;
};

export async function groupChatsTick(env: Env): Promise<void> {
  const sb = db(env);
  const { data } = await sb.from('groups').select(GROUP_COLS).not('tg_chat_id', 'is', null).is('archived_at', null).limit(200);
  for (const g of (data ?? []) as unknown as ChatGroup[]) {
    if (!g.owner) continue;
    const now = localTime(g.owner.timezone);
    const day = dayOf(g);
    try {
      if (inWindow(now, MORNING) && g.tg_morning_day !== day) {
        await sb.from('groups').update({ tg_morning_day: day }).eq('id', g.id);
        const view = await chatView(sb, g, day);
        if (view.items.some((it) => it.mode !== 'goal')) await postToday(env, sb, g, true);
      } else if (g.chat_digest && inWindow(now, EVENING) && g.tg_digest_day !== day) {
        await sb.from('groups').update({ tg_digest_day: day }).eq('id', g.id);
        await sendDigest(env, sb, g, day);
      }
    } catch (e) {
      console.error('group chat tick failed', g.id, e);
    }
  }
}

/** Вечерний итог: сколько сделали и что осталось — без имён тех, кто не успел. */
async function sendDigest(env: Env, sb: SupabaseClient, g: ChatGroup, day: string) {
  const t = textsOf(g);
  const msg = renderToday(g, await chatView(sb, g, day), day, env.BOT_USERNAME);
  if (!msg.planned) return;
  const lines = [`<b>${esc(t.digest(g.title))}</b>`, msg.done >= msg.planned ? t.allDone : t.madeOf(msg.done, msg.planned)];
  if (msg.left.length && msg.done < msg.planned) lines.push(t.left(msg.left.map((it) => esc(it.title)).join(', ')));
  await tg(env, 'sendMessage', { chat_id: g.tg_chat_id, text: lines.join('\n'), parse_mode: 'HTML', disable_notification: true }).catch(async (e) => {
    if (!g.tg_chat_id || !(await onChatError(sb, g.tg_chat_id, e))) throw e;
  });
}
