import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hapticFeedback, openTelegramLink } from '@tma.js/sdk-react';
import { MAX_VOICE_SECONDS, VOICE_DAILY_LIMIT, FREE_TASK_LIMIT, type TaskInput } from '../../shared/types';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { repeatLabel } from '../repeat';
import { useBackButton } from '../telegram/hooks';
import { canRecord, Recorder } from '../voice/recorder';
import { KindTile } from './KindIcon';

/** Что получилось из сказанного. Живёт в App: пока человек правит привычку в редакторе, шторка закрыта. */
export interface VoicePreview {
  text: string;
  habits: TaskInput[];
}

type Phase = 'recording' | 'parsing' | 'nothing' | 'nomic' | 'failed' | 'limit';

/** Короче не отправляем: это случайное касание, а попытка из дневного лимита ушла бы. */
const MIN_SECONDS = 0.8;
const BARS = 17;

interface Props {
  preview: VoicePreview | null;
  setPreview: (p: VoicePreview | null) => void;
  /** Сколько ещё привычек помещается бесплатно; null — без ограничения. */
  room: number | null;
  onEdit: (index: number) => void;
  onAdd: (habits: TaskInput[]) => Promise<void>;
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
 * Голос в мини-аппе: запись → «Разбираю…» с расслышанной фразой → список привычек → «Добавить N».
 * В базу до нажатия «Добавить» ничего не пишется. Нет записи в WebView — ведём в чат с ботом.
 */
export function VoiceSheet({ preview, setPreview, room, onEdit, onAdd, onManual, onClose }: Props): ReactNode {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('recording');
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
      const actions = await api.voice(audio, (text) => {
        said = text;
        if (alive.current) setHeard(text);
      });
      if (!alive.current) return;
      const habits = actions.filter((a) => a.type === 'create_habit').map((a) => a.habit);
      if (habits.length === 0) return setPhase('nothing');
      hapticFeedback.notificationOccurred.ifAvailable('success');
      setPreview({ text: said, habits });
    } catch (e) {
      if (!alive.current) return;
      setPhase(e instanceof ApiError && e.code === 'voice_limit' ? 'limit' : 'failed');
    }
  }, [setPreview]);

  // Открыли шторку без готового списка — сразу слушаем.
  useEffect(() => {
    alive.current = true;
    if (!preview) void record();
    return () => {
      alive.current = false;
      recorder.current?.cancel();
      recorder.current = null;
    };
    // Только при открытии шторки.
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

  const add = async (habits: TaskInput[]) => {
    setBusy(true);
    setMessage(null);
    try {
      await onAdd(habits);
    } catch (e) {
      setMessage(e instanceof ApiError && e.code === 'task_limit' ? t.limitReached(FREE_TASK_LIMIT) : t.error);
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (preview) {
    const fit = room === null ? preview.habits.length : Math.min(room, preview.habits.length);
    body = (
      <>
        <h2>{t.voice.previewTitle}</h2>
        <p className="voice-hint">{t.voice.previewHint}</p>
        <ul className="voice-list">
          {preview.habits.map((h, i) => (
            <li key={`${i}-${h.title}`} className={i >= fit ? 'wont-fit' : undefined}>
              <button className="voice-row" onClick={() => onEdit(i)}>
                <KindTile kind={h.kind} title={h.title} />
                <span>
                  <b>{h.title}</b>
                  <small>{describe(t, h)}</small>
                </span>
              </button>
              <button
                className="voice-x"
                aria-label={t.voice.remove(h.title)}
                onClick={() => {
                  const habits = preview.habits.filter((_, j) => j !== i);
                  if (habits.length) setPreview({ ...preview, habits });
                  else void record();
                }}
              >
                <Cross />
              </button>
            </li>
          ))}
        </ul>
        {fit < preview.habits.length && <p className="voice-hint">{t.voice.wontFit(fit, FREE_TASK_LIMIT)}</p>}
        {message && <p className="error">{message}</p>}
        <button className="act primary wide" disabled={busy || fit === 0} onClick={() => void add(preview.habits.slice(0, fit))}>
          {t.voice.addN(fit)}
        </button>
        <button className="voice-link" onClick={() => void record()}>
          <MicIcon size={18} />
          {t.voice.again}
        </button>
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
    body = (
      <>
        <h2>{t.voice.parsing}</h2>
        <div className={`voice-quote${heard ? '' : ' pending'}`}>{heard ? `«${heard}»` : <span className="skel-line" />}</div>
        <div className="voice-skel" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ opacity: 1 - i * 0.3 }}>
              <i />
              <span>
                <b />
                <small />
              </span>
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
