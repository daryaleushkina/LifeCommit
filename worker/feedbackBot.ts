// Жалоба боту: /bug открывает черновик, текст, скриншоты и голос копятся в нём (а не разбираются в дела), пока человек
// не нажмёт «Отправить» или не замолчит на 10 минут — тогда жалоба уходит сама, не подтверждённой (feedbackTick,
// cron раз в 5 минут). Человеку — только «Получили, спасибо!» (docs/feedback.md).
import type { SupabaseClient } from '@supabase/supabase-js';
import { takeVoiceQuota } from './api';
import { byTelegram, db, tg, type Env } from './env';
import { bugCommand, check, cleanFeedback, FEEDBACK, notifyOwner, type Submitted } from './feedback';
import { transcribe } from './voice';

interface TgFrom {
  id: number;
  is_bot?: boolean;
  language_code?: string;
}

export interface FeedbackUpdate {
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: TgFrom;
    text?: string;
    caption?: string;
    photo?: { file_id: string; width: number }[];
    voice?: { file_id: string; duration: number };
  };
  callback_query?: { id: string; from: TgFrom; data?: string; message?: { message_id: number; chat: { id: number } } };
}

const texts = {
  ru: {
    prompt: 'Что случилось? Напиши, скажи голосом или пришли скриншоты — можно несколькими сообщениями. Когда всё, нажми «Отправить».',
    send: 'Отправить',
    cancel: 'Отмена',
    thanks: 'Получили, спасибо!',
    cancelled: 'Отменено — ничего не отправили.',
    empty: 'Сначала напиши, что случилось',
    gone: 'Этой жалобы уже нет — отправлена или отменена.',
    limit: 'Уже много за сегодня — завтра примем ещё.',
    tooManyFiles: (n: number) => `Больше ${n} скриншотов не возьму — этот не приложил.`,
    unsupported: 'Возьму текст, голосовое или скриншот (картинкой).',
    voiceTooLong: 'Слишком длинное голосовое — до двух минут.',
    voiceLimit: 'Голосовых на сегодня хватит — напиши, пожалуйста, текстом.',
    voiceFailed: 'Не получилось разобрать голосовое — напиши, пожалуйста, текстом.',
    failed: 'Не получилось отправить — нажми ещё раз',
    notSaved: 'Не получилось записать — пришли это ещё раз.',
    closed: 'Жалоба уже ушла. Чтобы добавить ещё, пришли /bug.',
    heard: (text: string) => `Расслышал: «${text}»`,
    openFirst: 'Сначала открой LifeCommit — потом можно сообщить о проблеме.',
    open: 'Открыть LifeCommit',
  },
  en: {
    prompt: 'What happened? Write, say it by voice or send screenshots — several messages are fine. When you are done, tap «Send».',
    send: 'Send',
    cancel: 'Cancel',
    thanks: 'Got it, thank you!',
    cancelled: 'Cancelled — nothing was sent.',
    empty: 'First tell me what happened',
    gone: 'This report is no longer open — it was sent or cancelled.',
    limit: "That's a lot for today — we'll take more tomorrow.",
    tooManyFiles: (n: number) => `I take up to ${n} screenshots — this one is not attached.`,
    unsupported: 'I take text, voice messages or screenshots (as pictures).',
    voiceTooLong: 'That voice message is too long — keep it under two minutes.',
    voiceLimit: "That's enough voice for today — please write it as text.",
    voiceFailed: 'Could not make out the voice message — please write it as text.',
    failed: 'Could not send — tap again',
    notSaved: 'Could not save that — please send it again.',
    closed: 'The report has already gone. To add more, send /bug.',
    heard: (text: string) => `I heard: "${text}"`,
    openFirst: 'Open LifeCommit first — then you can report a problem.',
    open: 'Open LifeCommit',
  },
};
/** Язык — как в приложении; пользователя нет — как в Telegram. */
const lang = (code: string | undefined) => (code?.startsWith('ru') ? texts.ru : texts.en);

interface FeedbackUser {
  id: number;
  first_name: string;
  username: string | null;
  language_code: string;
}

/** Скриншот из бота — file_id Telegram (картинку храним только там). */
type TgPhoto = { kind: 'tg_photo'; file_id: string };

interface Draft {
  user_id: number;
  chat_id: number;
  text: string;
  attachments: TgPhoto[];
  prompt_message_id: number | null;
}

const USER_COLS = 'id, first_name, username, language_code';

async function findUser(sb: SupabaseClient, telegramId: number): Promise<FeedbackUser | null> {
  return check(await sb.from('users').select(USER_COLS).or(byTelegram(telegramId)).limit(1).maybeSingle<FeedbackUser>(), 'user not read');
}

/** Убрать кнопки у приглашения. Сообщение старое или удалено — не важно, черновик уже закрыт. */
const dropButtons = (env: Env, chat: number, messageId: number) =>
  tg(env, 'editMessageReplyMarkup', { chat_id: chat, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});

/**
 * Апдейты жалоб: кнопки «Отправить» / «Отмена», команда /bug и сообщения в личку, пока черновик открыт.
 * true — апдейт забран; false — это не про жалобы, дальше как обычно (привычки и дела).
 */
export async function handleFeedbackUpdate(env: Env, update: FeedbackUpdate, appUrl: string): Promise<boolean> {
  const q = update.callback_query;
  if (q?.data === 'fb:send' || q?.data === 'fb:cancel') {
    await onButton(env, q, q.data);
    return true;
  }
  const msg = update.message;
  if (!msg?.from || msg.from.is_bot || msg.chat.type !== 'private') return false;
  const rest = bugCommand(msg.text, env.BOT_USERNAME);
  if (rest !== null) {
    await openDraft(env, msg.chat.id, msg.from, rest, appUrl);
    return true;
  }
  // Другие команды (/start и прочие) — как раньше, даже при открытом черновике.
  if (msg.text?.startsWith('/')) return false;
  const sb = db(env);
  const draft = check(
    await sb.from('feedback_drafts').select('user_id, users(language_code)').eq('chat_id', msg.chat.id).maybeSingle<{ user_id: number; users: { language_code: string } }>(),
    'draft not read',
  );
  if (!draft) return false;
  await collect(env, sb, draft.user_id, draft.users.language_code, msg);
  return true;
}

/** /bug: открыть черновик (уже открыт — собранное остаётся) и прислать приглашение с кнопками. */
async function openDraft(env: Env, chat: number, from: TgFrom, rest: string, appUrl: string): Promise<void> {
  const sb = db(env);
  const user = await findUser(sb, from.id);
  if (!user) {
    const t = lang(from.language_code);
    await tg(env, 'sendMessage', { chat_id: chat, text: t.openFirst, reply_markup: { inline_keyboard: [[{ text: t.open, web_app: { url: appUrl } }]] } });
    return;
  }
  const t = lang(user.language_code);
  const old = check(await sb.from('feedback_drafts').select('chat_id, prompt_message_id').eq('user_id', user.id).maybeSingle<{ chat_id: number; prompt_message_id: number | null }>(), 'draft not read');
  check(await sb.from('feedback_drafts').upsert({ user_id: user.id, chat_id: chat, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }), 'draft not opened');
  // Текст после /bug — в черновик сразу, до приглашения: не ушло приглашение — текст всё равно не потерян.
  const text = cleanFeedback(rest);
  if (text) await append(sb, user.id, text, null);
  // Новое приглашение будет внизу — у старого кнопки убираем, чтобы не было двух «Отправить».
  if (old?.prompt_message_id) await dropButtons(env, old.chat_id, old.prompt_message_id);
  const prompt = await tg<{ message_id: number }>(env, 'sendMessage', {
    chat_id: chat,
    text: t.prompt,
    reply_markup: { inline_keyboard: [[{ text: t.send, callback_data: 'fb:send' }, { text: t.cancel, callback_data: 'fb:cancel' }]] },
  });
  check(await sb.from('feedback_drafts').update({ prompt_message_id: prompt.message_id }).eq('user_id', user.id), 'prompt not saved');
}

/**
 * Дописать в черновик одним запросом (альбом скриншотов приходит несколькими апдейтами разом).
 * added — легло; dropped — вложение не взяли (уже 4); closed — черновик ушёл (кнопка, таймер), пока шло сообщение.
 */
async function append(sb: SupabaseClient, userId: number, text: string, attachment: TgPhoto | null): Promise<'added' | 'dropped' | 'closed'> {
  const res = check(
    await sb.rpc('append_feedback_draft', { p_user: userId, p_text: text, p_attachment: attachment, p_max_text: FEEDBACK.maxText, p_max_files: FEEDBACK.maxFiles }),
    'draft not updated',
  ) as { dropped: boolean } | null;
  if (!res) return 'closed';
  return res.dropped ? 'dropped' : 'added';
}

/** Сообщение при открытом черновике: текст или подпись, самый крупный скриншот, голос — расшифровкой. */
async function collect(env: Env, sb: SupabaseClient, userId: number, language: string, msg: NonNullable<FeedbackUpdate['message']>): Promise<void> {
  const t = lang(language);
  const chat = msg.chat.id;
  const say = (text: string) => tg(env, 'sendMessage', { chat_id: chat, text });
  let text = cleanFeedback(msg.text ?? msg.caption ?? '');
  const photo = msg.photo?.reduce((a, b) => (b.width > a.width ? b : a));
  if (msg.voice) {
    if (msg.voice.duration > FEEDBACK.maxVoiceSeconds) {
      await say(t.voiceTooLong);
      return;
    }
    // Лимит общий с голосом в приложении: расшифровка стоит одинаково.
    if (!(await takeVoiceQuota(sb, userId))) {
      await say(t.voiceLimit);
      return;
    }
    try {
      const file = await tg<{ file_path: string }>(env, 'getFile', { file_id: msg.voice.file_id });
      const audio = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
      text = cleanFeedback(await transcribe(env, await audio.arrayBuffer(), t === texts.en ? 'en' : 'ru'));
    } catch (e) {
      console.error('feedback: voice not transcribed', userId, { duration: msg.voice.duration }, e);
      text = '';
    }
    if (!text) {
      await say(t.voiceFailed);
      return;
    }
    await say(t.heard(text));
  }
  if (!text && !photo) {
    await say(t.unsupported);
    return;
  }
  let added: Awaited<ReturnType<typeof append>>;
  try {
    added = await append(sb, userId, text, photo ? { kind: 'tg_photo', file_id: photo.file_id } : null);
  } catch (e) {
    // Не записалось — человек должен знать, иначе жалоба уйдёт без этого куска.
    console.error('feedback: draft not appended', userId, { photo: !!photo, chars: text.length }, e);
    await say(t.notSaved);
    return;
  }
  if (added !== 'added') {
    await say(added === 'dropped' ? t.tooManyFiles(FEEDBACK.maxFiles) : t.closed);
    return;
  }
  // Тихая отметка «взял» вместо ответа на каждое сообщение. Не поставилась — не важно, сообщение в черновике.
  await tg(env, 'setMessageReaction', { chat_id: chat, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👌' }] }).catch(() => {});
}

/** Что вернула база на «отправить черновик» (миграция 20261004000003). */
type Sent = { result: 'empty'; draft?: Draft } | (Submitted & { draft: Draft });

/**
 * Забрать черновик и записать жалобу — одной транзакцией в базе: сбой откатывает всё, черновик остаётся.
 * null — черновика нет. before — для таймера: только если черновик всё ещё молчит с того времени.
 */
async function sendDraft(sb: SupabaseClient, userId: number, confirmed: boolean, before: string | null): Promise<Sent | null> {
  const sent = check(
    await sb.rpc('send_feedback_draft', {
      p_user: userId,
      p_confirmed: confirmed,
      p_before: before,
      p_per_hour: FEEDBACK.perHour,
      p_per_day: FEEDBACK.perDay,
      p_project_day: FEEDBACK.projectDay,
    }),
    'draft not sent',
  );
  return sent as Sent | null;
}

const accepted = (sent: Sent) => sent.result === 'ok' || sent.result === 'duplicate';

/** Новая жалоба — владелице; повтор и лимит — нет. */
async function notifyNew(env: Env, sb: SupabaseClient, user: FeedbackUser, sent: Sent, confirmed: boolean): Promise<void> {
  if (sent.result !== 'ok') return;
  const { draft } = sent;
  await notifyOwner(env, sb, { id: sent.id, source: 'bot', confirmed, text: draft.text, context: null, files: draft.attachments.length, user }, draft.attachments);
}

async function onButton(env: Env, q: NonNullable<FeedbackUpdate['callback_query']>, action: 'fb:send' | 'fb:cancel'): Promise<void> {
  const sb = db(env);
  // Служебный ответ Telegram (часики на кнопке); не дошёл — кнопка просто погаснет сама.
  const answer = (text?: string) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, ...(text && { text }) }).catch(() => {});
  const user = await findUser(sb, q.from.id);
  // У очень старых сообщений Telegram может не прислать message — тогда менять нечего. Правка не удалась — это не
  // повод не сказать владелице о жалобе: в лог и дальше.
  const edit = async (text: string) => {
    if (q.message) await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text }).catch((e: unknown) => console.error('feedback: prompt not edited', user?.id, e));
  };
  const t = lang(user?.language_code ?? q.from.language_code);
  const gone = async () => {
    await answer(t.gone);
    if (q.message) await dropButtons(env, q.message.chat.id, q.message.message_id);
  };
  if (!user) return gone();
  if (action === 'fb:cancel') {
    const dropped = check(await sb.from('feedback_drafts').delete().eq('user_id', user.id).select('user_id').maybeSingle(), 'draft not cancelled');
    if (!dropped) return gone();
    await answer();
    await edit(t.cancelled);
    return;
  }
  let sent: Sent | null;
  try {
    sent = await sendDraft(sb, user.id, true, null);
  } catch (e) {
    // Черновик на месте (транзакция откатилась) — человек нажмёт ещё раз.
    console.error('feedback: draft not sent', user.id, e);
    await answer(t.failed);
    return;
  }
  if (!sent) return gone();
  if (sent.result === 'empty') {
    await answer(t.empty);
    return;
  }
  await answer();
  await edit(accepted(sent) ? t.thanks : t.limit);
  await notifyNew(env, sb, user, sent, true);
}

/**
 * Cron раз в 5 минут: черновики, где 10 минут тишины, уходят сами — не подтверждёнными (человек не нажал
 * «Отправить», возможно, это не баг). Пустые закрываются молча. Кнопки у приглашения убираем в обоих случаях.
 * Сбой базы на одном черновике оставляет его на месте до следующего тика и не держит остальные.
 */
export async function feedbackTick(env: Env): Promise<void> {
  const sb = db(env);
  const before = new Date(Date.now() - FEEDBACK.draftMinutes * 60_000).toISOString();
  const stale = check(
    await sb.from('feedback_drafts').select(`user_id, users(${USER_COLS})`).lt('updated_at', before).returns<{ user_id: number; users: FeedbackUser }[]>(),
    'stale drafts not listed',
  );
  for (const { users: user } of stale) {
    try {
      const sent = await sendDraft(sb, user.id, false, before);
      // Пока шёл тик, черновик отправили кнопкой или в него написали — не наш.
      if (!sent?.draft) continue;
      // Приглашения может не быть, если Telegram не принял его при /bug; тогда и убирать нечего (вызов не удастся — не важно).
      await dropButtons(env, sent.draft.chat_id, sent.draft.prompt_message_id ?? 0);
      if (sent.result === 'empty') continue;
      const t = lang(user.language_code);
      // Человек мог заблокировать бота — владелице жалоба всё равно нужна.
      await tg(env, 'sendMessage', { chat_id: sent.draft.chat_id, text: accepted(sent) ? t.thanks : t.limit }).catch((e: unknown) => console.error('feedback: thanks not sent', user.id, e));
      await notifyNew(env, sb, user, sent, false);
    } catch (e) {
      console.error('feedback: stale draft not sent', user.id, e);
    }
  }
}
