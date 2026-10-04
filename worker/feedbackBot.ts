// Жалоба боту: /bug открывает черновик, текст, скриншоты и голос копятся в нём (а не разбираются в дела), пока человек
// не нажмёт «Отправить» или не замолчит на 10 минут — тогда жалоба уходит сама, не подтверждённой (feedbackTick,
// cron раз в 5 минут). Человеку — только «Получили, спасибо!» (docs/feedback.md).
import type { SupabaseClient } from '@supabase/supabase-js';
import { takeVoiceQuota } from './api';
import { byTelegram, db, tg, type Env } from './env';
import { bugCommand, check, cleanFeedback, FEEDBACK, notifyOwner, submitFeedback } from './feedback';
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
    heard: (text: string) => `I heard: "${text}"`,
    openFirst: 'Open LifeCommit first — then you can report a problem.',
    open: 'Open LifeCommit',
  },
};
/** Язык — как в приложении; пользователя нет — как в Telegram. */
const lang = (code: string | undefined) => (code?.startsWith('en') ? texts.en : texts.ru);

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

const DRAFT_COLS = 'user_id, chat_id, text, attachments, prompt_message_id';
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
  // Новое приглашение будет внизу — у старого кнопки убираем, чтобы не было двух «Отправить».
  if (old?.prompt_message_id) await dropButtons(env, old.chat_id, old.prompt_message_id);
  const prompt = await tg<{ message_id: number }>(env, 'sendMessage', {
    chat_id: chat,
    text: t.prompt,
    reply_markup: { inline_keyboard: [[{ text: t.send, callback_data: 'fb:send' }, { text: t.cancel, callback_data: 'fb:cancel' }]] },
  });
  check(await sb.from('feedback_drafts').update({ prompt_message_id: prompt.message_id }).eq('user_id', user.id), 'prompt not saved');
  const text = cleanFeedback(rest);
  if (text) await append(sb, user.id, text, null);
}

/**
 * Дописать в черновик одним запросом (альбом скриншотов приходит несколькими апдейтами разом). dropped — вложение
 * не взяли (уже 4). Черновик закрылся, пока шло сообщение, — база отвечает null, дописывать некуда: это не ошибка.
 */
async function append(sb: SupabaseClient, userId: number, text: string, attachment: TgPhoto | null): Promise<boolean> {
  const added = check(
    await sb.rpc('append_feedback_draft', { p_user: userId, p_text: text, p_attachment: attachment, p_max_text: FEEDBACK.maxText, p_max_files: FEEDBACK.maxFiles }),
    'draft not updated',
  ) as { dropped: boolean } | null;
  return added?.dropped === true;
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
      console.error('feedback: voice not transcribed', e);
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
  if (await append(sb, userId, text, photo ? { kind: 'tg_photo', file_id: photo.file_id } : null)) {
    await say(t.tooManyFiles(FEEDBACK.maxFiles));
    return;
  }
  // Тихая отметка «взял» вместо ответа на каждое сообщение. Не поставилась — не важно, сообщение в черновике.
  await tg(env, 'setMessageReaction', { chat_id: chat, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👌' }] }).catch(() => {});
}

/**
 * Отдать черновик в жалобы: true — принята (или повтор), false — лимит. Владелице — только о новой; сообщение ей
 * уходит после ответа человеку (notify), чтобы «Получили» не ждало Telegram.
 */
async function deliver(env: Env, sb: SupabaseClient, user: FeedbackUser, draft: Draft, confirmed: boolean): Promise<{ accepted: boolean; notify: () => Promise<void> }> {
  const submitted = await submitFeedback(sb, user.id, { source: 'bot', text: draft.text, attachments: draft.attachments, context: null, confirmed });
  return {
    accepted: submitted.result === 'ok' || submitted.result === 'duplicate',
    notify: async () => {
      if (submitted.result !== 'ok') return;
      const note = { id: submitted.id, source: 'bot' as const, confirmed, text: draft.text, context: null, files: draft.attachments.length, user };
      await notifyOwner(env, sb, note, draft.attachments);
    },
  };
}

async function onButton(env: Env, q: NonNullable<FeedbackUpdate['callback_query']>, action: 'fb:send' | 'fb:cancel'): Promise<void> {
  const sb = db(env);
  // Служебный ответ Telegram (часики на кнопке); не дошёл — кнопка просто погаснет сама.
  const answer = (text?: string) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, ...(text && { text }) }).catch(() => {});
  // У очень старых сообщений Telegram может не прислать message — тогда менять нечего.
  const edit = (text: string) => q.message && tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text });
  const user = await findUser(sb, q.from.id);
  const t = lang(user?.language_code ?? q.from.language_code);
  // Забрать черновик целиком (кто первым удалил — кнопка или таймер, тот и отправляет); «Отправить» — только непустой.
  const take = sb.from('feedback_drafts').delete().eq('user_id', user?.id ?? 0);
  const draft = check(await (action === 'fb:send' ? take.or('text.neq.,attachments.neq.[]') : take).select(DRAFT_COLS).maybeSingle<Draft>(), 'draft not taken');
  if (!draft) {
    // Не забрали: черновик пустой (подсказать) или его уже нет (кнопки — прочь).
    const open = check(await sb.from('feedback_drafts').select('user_id').eq('user_id', user?.id ?? 0).maybeSingle(), 'draft not read');
    if (open) {
      await answer(t.empty);
      return;
    }
    await answer(t.gone);
    if (q.message) await dropButtons(env, q.message.chat.id, q.message.message_id);
    return;
  }
  if (action === 'fb:cancel') {
    await answer();
    await edit(t.cancelled);
    return;
  }
  const { accepted, notify } = await deliver(env, sb, user!, draft, true);
  await answer();
  await edit(accepted ? t.thanks : t.limit);
  await notify();
}

/**
 * Cron раз в 5 минут: черновики, где 10 минут тишины, уходят сами — не подтверждёнными (человек не нажал
 * «Отправить», возможно, это не баг). Пустые закрываются молча. Кнопки у приглашения убираем в обоих случаях.
 */
export async function feedbackTick(env: Env): Promise<void> {
  const sb = db(env);
  const before = new Date(Date.now() - FEEDBACK.draftMinutes * 60_000).toISOString();
  const stale = check(await sb.from('feedback_drafts').delete().lt('updated_at', before).select(DRAFT_COLS).returns<Draft[]>(), 'stale drafts not taken');
  for (const draft of stale) {
    try {
      // Приглашения может не быть, если Telegram не принял его при /bug; тогда и убирать нечего (вызов не удастся — не важно).
      await dropButtons(env, draft.chat_id, draft.prompt_message_id ?? 0);
      if (!draft.text && !draft.attachments.length) continue;
      const user = check(await sb.from('users').select(USER_COLS).eq('id', draft.user_id).single<FeedbackUser>(), 'user not read');
      const { accepted, notify } = await deliver(env, sb, user, draft, false);
      const t = lang(user.language_code);
      // Человек мог заблокировать бота — владелице жалоба всё равно нужна.
      await tg(env, 'sendMessage', { chat_id: draft.chat_id, text: accepted ? t.thanks : t.limit }).catch((e: unknown) => console.error('feedback: thanks not sent', draft.user_id, e));
      await notify();
    } catch (e) {
      // Один сбойный черновик не держит остальные. Он уже удалён — в логе, чей он, чтобы найти и спросить.
      console.error('feedback: stale draft not sent', draft.user_id, e);
    }
  }
}
