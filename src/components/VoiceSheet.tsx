import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hapticFeedback, openTelegramLink } from '@tma.js/sdk-react';
import { MAX_VOICE_SECONDS, VOICE_DAILY_LIMIT, FREE_TASK_LIMIT, type TaskInput, type TodoInput, type VoiceAction } from '../../shared/types';
import { api, ApiError } from '../api';
import { LangContext, useT } from '../i18n';
import { repeatLabel } from '../repeat';
import { useBackButton } from '../telegram/hooks';
import { canRecord, Recorder } from '../voice/recorder';
import { KindTile } from './KindIcon';
import { todoWhen } from '../todoDates';
import { Check, endTime } from './TodoList';
import { TodoSheet } from './TodoSheet';

/** Что получилось из сказанного. Живёт в App: пока человек правит привычку в редакторе, шторка закрыта. */
export interface VoicePreview {
  text: string;
  habits: TaskInput[];
  todos: TodoInput[];
  /** Дела в группы — как их понял разбор: себе или в группу и кому в ней. */
  groupItems: GroupVoiceItem[];
}

export type GroupVoiceItem = Extract<VoiceAction, { type: 'create_group_item' }>;

type Phase = 'recording' | 'parsing' | 'nothing' | 'nomic' | 'failed' | 'limit';

/** Короче не отправляем: это случайное касание, а попытка из дневного лимита ушла бы. */
const MIN_SECONDS = 0.8;
const BARS = 17;

interface Props {
  preview: VoicePreview | null;
  setPreview: (p: VoicePreview | null) => void;
  /** Сколько ещё привычек помещается бесплатно; null — без ограничения. */
  room: number | null;
  /** Сегодняшний логический день: от него подписи «сегодня», «завтра». */
  today: string;
  onEdit: (index: number) => void;
  onAdd: (todos: TodoInput[], habits: TaskInput[], groupItems: GroupVoiceItem[]) => Promise<void>;
  /** Микрофон нажали на экране группы — сказанное без названия группы пойдёт в неё. */
  groupId?: number | null;
  onManual: () => void;
  onClose: () => void;
}

export const MicIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </svg>
);

const Cross = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M7 7l10 10M17 7L7 17" />
  </svg>
);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Голос в мини-аппе: запись → «Разбираю…» с расслышанной фразой → список дел и привычек → «Добавить».
 * В базу до нажатия «Добавить» ничего не пишется. Нет записи в WebView — ведём в чат с ботом.
 */
export function VoiceSheet({ preview, setPreview, room, today, groupId = null, onEdit, onAdd, onManual, onClose }: Props): ReactNode {
  const t = useT();
  const locale = useContext(LangContext) === 'ru' ? 'ru-RU' : 'en-US';
  // Дело из списка правится в маленькой шторке поверх этой; привычка — в полном редакторе.
  const [editingTodo, setEditingTodo] = useState<number | null>(null);
  // Записывать нечем — сразу так и показываем, без мелькания экрана записи.
  const [phase, setPhase] = useState<Phase>(() => (canRecord() ? 'recording' : 'nomic'));
  const [heard, setHeard] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recorder = useRef<Recorder | null>(null);
  // Шторку закрыли, пока шёл разбор, — ответ уже никому не нужен.
  const alive = useRef(true);

  const close = useCallback(() => {
    recorder.current?.cancel();
    recorder.current = null;
    onClose();
  }, [onClose]);
  useBackButton(close);

  const record = useCallback(async () => {
    setPreview(null);
    setHeard(null);
    setMessage(null);
    setSeconds(0);
    if (!canRecord()) return setPhase('nomic');
    const rec = new Recorder();
    try {
      await rec.start();
    } catch {
      return setPhase('nomic');
    }
    if (!alive.current) return rec.cancel();
    recorder.current = rec;
    setPhase('recording');
  }, [setPreview]);

  const stop = useCallback(async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    const { audio, seconds: length } = await rec.stop();
    if (length < MIN_SECONDS || audio.size === 0) {
      setHeard('');
      return setPhase('nothing');
    }
    setPhase('parsing');
    try {
      let said = '';
      const actions = await api.voice(
        audio,
        (text) => {
          said = text;
          if (alive.current) setHeard(text);
        },
        groupId,
      );
      if (!alive.current) return;
      const habits = actions.flatMap((a) => (a.type === 'create_habit' ? [a.habit] : []));
      const todos = actions.flatMap((a) => (a.type === 'create_todo' ? [a.todo] : []));
      const groupItems = actions.filter((a): a is GroupVoiceItem => a.type === 'create_group_item');
      if (habits.length === 0 && todos.length === 0 && groupItems.length === 0) return setPhase('nothing');
      hapticFeedback.notificationOccurred.ifAvailable('success');
      setPreview({ text: said, habits, todos, groupItems });
    } catch (e) {
      if (!alive.current) return;
      setPhase(e instanceof ApiError && e.code === 'voice_limit' ? 'limit' : 'failed');
    }
  }, [setPreview, groupId]);

  // Открыли шторку без готового списка — сразу слушаем.
  useEffect(() => {
    alive.current = true;
    if (!preview) void record();
    return () => {
      alive.current = false;
      recorder.current?.cancel();
      recorder.current = null;
    };
    // Только при открытии шторки: повторную запись (t.voice.again) кнопка начинает сама, а перезапуск эффекта по preview/record
    // отменял бы только что начатую запись в своей очистке.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- намеренно один раз, см. выше
  }, []);

  // Таймер записи; на пределе останавливаемся сами.
  useEffect(() => {
    if (phase !== 'recording' || preview) return;
    const id = window.setInterval(() => {
      const s = recorder.current?.seconds ?? 0;
      setSeconds(s);
      if (s >= MAX_VOICE_SECONDS) void stop();
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, preview, stop]);

  const add = async (todos: TodoInput[], habits: TaskInput[], groupItems: GroupVoiceItem[]) => {
    setBusy(true);
    setMessage(null);
    try {
      await onAdd(todos, habits, groupItems);
    } catch (e) {
      setMessage(e instanceof ApiError && e.code === 'task_limit' ? t.limitReached(FREE_TASK_LIMIT ?? 0) : t.error);
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (preview) {
    const fit = room === null ? preview.habits.length : Math.min(room, preview.habits.length);
    // Убрали последнюю строку — список пуст, слушаем заново.
    const drop = (next: VoicePreview) => (next.habits.length || next.todos.length || next.groupItems.length ? setPreview(next) : void record());
    const both = preview.todos.length > 0 && preview.habits.length > 0;
    // Есть дела в группы — личное подписываем «Себе», чтобы было видно, что куда.
    const groupsShown = [...new Map(preview.groupItems.map((a) => [a.group.id, a.group])).values()];
    const todoDraft = editingTodo !== null ? preview.todos[editingTodo] : undefined;
    body = (
      <>
        <h2>{t.voice.previewTitle}</h2>
        <p className="voice-hint">{t.voice.previewHint}</p>
        {groupsShown.map((g) => (
          <section key={g.id}>
            <h3 className="voice-section">{t.voice.toGroup(g.title)}</h3>
            <ul className="voice-list">
              {preview.groupItems.map((a, i) =>
                a.group.id !== g.id ? null : (
                  <li key={`g${i}-${a.item.title}`}>
                    <span className="voice-row">
                      <span className="todo-tile group" aria-hidden>
                        <Check />
                      </span>
                      <span className="voice-text">
                        <b>{a.item.title}</b>
                        <small>{groupItemLine(t, a, today, locale)}</small>
                      </span>
                    </span>
                    <button className="voice-x" aria-label={t.voice.remove(a.item.title)} onClick={() => drop({ ...preview, groupItems: preview.groupItems.filter((_, j) => j !== i) })}>
                      <Cross />
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
        {preview.todos.length > 0 && (
          <>
            {(both || groupsShown.length > 0) && <h3 className="voice-section">{groupsShown.length > 0 && !both ? t.voice.mine : t.voiceTodos}</h3>}
            <ul className="voice-list">
              {preview.todos.map((d, i) => (
                <li key={`t${i}-${d.title}`}>
                  <button className="voice-row" onClick={() => setEditingTodo(i)}>
                    <span className="todo-tile" aria-hidden>
                      <Check />
                    </span>
                    <span className="voice-text">
                      <b>{d.title}</b>
                      <small>{[todoWhen(t, d.day || today, today, locale) ?? t.todo.today.toLowerCase(), d.time && d.duration_min ? [d.time, endTime(d.time, d.duration_min)].filter(Boolean).join('–') : d.time, d.location].filter(Boolean).join(' · ')}</small>
                    </span>
                  </button>
                  <button className="voice-x" aria-label={t.voice.remove(d.title)} onClick={() => drop({ ...preview, todos: preview.todos.filter((_, j) => j !== i) })}>
                    <Cross />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {preview.habits.length > 0 && (
          <>
            {both && <h3 className="voice-section">{t.voiceHabits}</h3>}
            <ul className="voice-list">
              {preview.habits.map((h, i) => (
                <li key={`h${i}-${h.title}`} className={i >= fit ? 'wont-fit' : undefined}>
                  <button className="voice-row" onClick={() => onEdit(i)}>
                    <KindTile kind={h.kind} title={h.title} />
                    <span className="voice-text">
                      <b>{h.title}</b>
                      <small>{describe(t, h)}</small>
                    </span>
                  </button>
                  <button className="voice-x" aria-label={t.voice.remove(h.title)} onClick={() => drop({ ...preview, habits: preview.habits.filter((_, j) => j !== i) })}>
                    <Cross />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {fit < preview.habits.length && <p className="voice-hint">{t.voice.wontFit(fit, FREE_TASK_LIMIT ?? 0)}</p>}
        {message && <p className="error">{message}</p>}
        <button
          className="act primary wide"
          disabled={busy || fit + preview.todos.length + preview.groupItems.length === 0}
          onClick={() => void add(preview.todos, preview.habits.slice(0, fit), preview.groupItems)}
        >
          {t.voice.addN(preview.todos.length + preview.groupItems.length, fit)}
        </button>
        <button className="voice-link" onClick={() => void record()}>
          <MicIcon size={18} />
          {t.voice.again}
        </button>
        {todoDraft && (
          <TodoSheet
            title={todoDraft.title}
            day={todoDraft.day || today}
            time={todoDraft.time ?? null}
            details={todoDraft.location ? { location: todoDraft.location } : null}
            today={today}
            onSave={(edit) => setPreview({ ...preview, todos: preview.todos.map((d, j) => (j === editingTodo ? { ...d, ...edit } : d)) })}
            onClose={() => setEditingTodo(null)}
          />
        )}
      </>
    );
  } else if (phase === 'recording') {
    body = (
      <div className="voice-rec">
        <p className="voice-listening">{t.voice.listening}</p>
        <Wave recorder={recorder} />
        <p className="voice-timer">{clock(seconds)}</p>
        <button className="voice-stop" aria-label={t.voice.stop} onClick={() => void stop()}>
          <i />
        </button>
        <p className="voice-example">{t.voice.example}</p>
        <button className="voice-link" onClick={close}>
          {t.voice.cancel}
        </button>
      </div>
    );
  } else if (phase === 'parsing') {
    // «Список пишется» (выбор владелицы 01.10.2026): невидимое перо выводит строки будущего списка.
    // Пока фразы нет — три строки; пришла фраза — она сверху, перо продолжает писать под ней.
    body = (
      <>
        <h2>{t.voice.parsing}</h2>
        <p className="voice-hint">{heard ? t.voice.subParse : t.voice.subTranscribe}</p>
        {heard && (
          <div className="voice-quote" aria-label={heard}>
            «<Decode text={heard} />»
          </div>
        )}
        <div className="parse-list" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="parse-row" style={{ '--i': i } as CSSProperties}>
              <span className="parse-box" />
              <span className="parse-ink" />
            </div>
          ))}
        </div>
      </>
    );
  } else {
    const content: Record<Exclude<Phase, 'recording' | 'parsing'>, { title: string; hint: string }> = {
      nothing: { title: t.voice.nothingTitle, hint: t.voice.nothingHint },
      nomic: { title: t.voice.noMicTitle, hint: t.voice.noMicHint },
      failed: { title: t.voice.failedTitle, hint: t.voice.failedHint },
      limit: { title: t.voice.limitTitle, hint: t.voice.limitHint(VOICE_DAILY_LIMIT) },
    };
    const { title, hint } = content[phase];
    body = (
      <>
        <h2>{title}</h2>
        {phase === 'nothing' && (
          <div className="voice-quote">
            <small>{t.voice.heard}</small>
            {heard ? `«${heard}»` : t.voice.heardNothing}
          </div>
        )}
        <p className="voice-hint">{hint}</p>
        {phase === 'nomic' ? (
          // Ссылку открываем прямо из нажатия: после await Telegram может счесть её не ответом на жест.
          <button className="act primary wide" onClick={() => openTelegramLink.ifAvailable(`https://t.me/${BOT}`)}>
            {t.voice.openBot}
          </button>
        ) : phase !== 'limit' ? (
          <button className="act primary wide with-icon" onClick={() => void record()}>
            <MicIcon size={20} />
            {t.voice.again}
          </button>
        ) : null}
        <button className={phase === 'limit' ? 'act primary wide' : 'voice-link'} onClick={onManual}>
          {t.voice.manual}
        </button>
      </>
    );
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={phase === 'recording' && !preview ? undefined : close}>
      <div className="sheet voice-sheet" role="dialog" aria-modal="true" aria-label={t.voice.mic} onClick={(e) => e.stopPropagation()}>
        <span className="sheet-handle" aria-hidden />
        {body}
      </div>
    </div>,
    document.body,
  );
}

const BOT = 'LifeCommit_bot';

/** Строка под названием: «20 страниц в день · каждый день», «3 раза в неделю», «бросить». */
/** «Алёне · завтра 18:00», «каждому · будни», «кто-то один · сегодня». */
function groupItemLine(t: ReturnType<typeof useT>, a: GroupVoiceItem, today: string, locale: string): string {
  const g = t.gr;
  const it = a.item;
  const turns = it.rotate ? g.rotate.toLowerCase() : '';
  const who =
    it.mode === 'goal'
      ? `${g.modes.goal} · ${t.num(it.target ?? 0)}`
      : it.mode === 'event'
        ? g.event
        : it.mode === 'one'
          ? g.anyone
          : it.all_members
            ? turns || g.toAll
            : [a.names.map((n) => n || g.toYou).join(', '), turns].filter(Boolean).join(' · ');
  const rule = it.rrule ?? '';
  const when = !rule
    ? it.mode === 'goal'
      ? ''
      : (todoWhen(t, it.day, today, locale) ?? t.todo.today.toLowerCase())
    : /DAILY/.test(rule)
      ? g.repeats.daily
      : /BYDAY=MO,TU,WE,TH,FR$/.test(rule)
        ? g.repeats.weekdays
        : /BYDAY=SA,SU$/.test(rule)
          ? g.repeats.weekends
          : g.repeats.weekly;
  return [who, when, it.time].filter(Boolean).join(' · ');
}

function describe(t: ReturnType<typeof useT>, h: TaskInput): string {
  if (h.kind === 'abstain') return t.voice.quit;
  const when = repeatLabel(t, h.schedule ?? 'daily', h.weekdays ?? 127, h.per_week ?? null);
  if (h.kind !== 'count') return when;
  return `${t.num(h.target)}${h.unit ? ` ${h.unit}` : ''} ${t.voice.perDay} · ${when.toLowerCase()}`;
}

/** Волна громкости: высоту палочек меняем прямо в DOM, без перерисовки React 60 раз в секунду. */
function Wave({ recorder }: { recorder: { current: Recorder | null } }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const bars = Array.from(box.current?.children ?? []) as HTMLElement[];
    const tick = () => {
      const levels = recorder.current?.levels();
      bars.forEach((bar, i) => {
        // Середина волны — средние частоты голоса, края — тише.
        const d = Math.abs(i - (BARS - 1) / 2);
        const bin = levels ? levels[Math.min(levels.length - 1, 1 + Math.round(d * 0.8))]! / 255 : 0;
        const shape = 1 - d / BARS;
        bar.style.transform = `scaleY(${(0.18 + bin * 0.82 * shape).toFixed(3)})`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recorder]);
  return (
    <div className="wave" ref={box} aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

const GLYPHS = 'абвгдежзиклмнопрстуфхцчшщыэюя';
const DECODE_MS = 900;

/**
 * Расшифровка (из каталога лоадеров, понравилась владелице): фраза за секунду «проявляется»
 * из перебирающихся букв слева направо — видно, что голос стал текстом.
 */
function Decode({ text }: { text: string }): ReactNode {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const done = Math.floor(((now - start) / DECODE_MS) * text.length);
      if (done >= text.length) {
        el.textContent = text;
        return;
      }
      let out = text.slice(0, done);
      for (let i = done; i < text.length; i++) out += /[\s.,!?«»-]/.test(text[i]!) ? text[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.textContent = out;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return (
    <span ref={box} aria-hidden>
      {text}
    </span>
  );
}
