import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { feedbackContext, shrinkImage } from '../feedback';
import { LangContext, useT } from '../i18n';
import { canRecord, Recorder } from '../voice/recorder';
import { Sheet } from './Picker';

/** Столько скриншотов принимает сервер (worker/feedback.ts → FEEDBACK.maxFiles). */
const MAX_SHOTS = 4;

interface Shot {
  blob: Blob;
  url: string;
}

interface Props {
  theme: 'light' | 'dark';
  onClose: () => void;
}

/**
 * «Сообщить о проблеме» (docs/feedback.md): что случилось — текстом или голосом (расшифровка дописывается в поле, её
 * видно и можно поправить), до 4 скриншотов (ужимаются на телефоне), версия и экран — сами. После отправки —
 * только «Получили, спасибо!»: о разборе и починке человеку не пишем.
 */
export function FeedbackSheet({ theme, onClose }: Props): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const [text, setText] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [phase, setPhase] = useState<'edit' | 'sending' | 'sent'>('edit');
  // starting — ждём микрофон (getUserMedia): кнопка в это время не нажимается, иначе заведётся второй.
  const [mic, setMic] = useState<'off' | 'starting' | 'recording' | 'hearing'>('off');
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const urls = useRef<string[]>([]);
  const alive = useRef(true);

  // Закрыли шторку — микрофон отпускаем, превью скриншотов освобождаем.
  useEffect(
    () => () => {
      alive.current = false;
      recorder.current?.cancel();
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const addShots = async (files: File[]) => {
    setError(null);
    const room = MAX_SHOTS - shots.length;
    if (files.length > room) setError(t.fb.tooMany);
    for (const file of files.slice(0, room)) {
      try {
        const blob = await shrinkImage(file);
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        setShots((cur) => (cur.length >= MAX_SHOTS ? cur : [...cur, { blob, url }]));
      } catch {
        setError(t.fb.badImage);
      }
    }
  };

  const removeShot = (shot: Shot) => {
    URL.revokeObjectURL(shot.url);
    setShots((cur) => cur.filter((s) => s !== shot));
  };

  const toggleMic = async () => {
    setError(null);
    const rec = recorder.current;
    if (rec) {
      recorder.current = null;
      setMic('hearing');
      try {
        const said = await api.feedbackVoice((await rec.stop()).audio);
        if (!said) setError(t.fb.voiceFailed);
        else setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n${said}` : said));
      } catch (e) {
        setError(e instanceof ApiError && e.code === 'voice_limit' ? t.fb.voiceLimit : t.fb.voiceFailed);
      }
      setMic('off');
      return;
    }
    if (!canRecord()) return setError(t.fb.noMic);
    const next = new Recorder();
    setMic('starting');
    try {
      await next.start();
      // Шторку закрыли, пока микрофон включался, — сразу отпускаем его.
      if (!alive.current) return next.cancel();
      recorder.current = next;
      setMic('recording');
    } catch {
      next.cancel();
      setMic('off');
      setError(t.fb.noMic);
    }
  };

  const send = async () => {
    setError(null);
    setPhase('sending');
    try {
      await api.feedback(text.trim(), feedbackContext({ lang, theme, screen: 'me' }), shots.map((s) => s.blob));
      setPhase('sent');
    } catch (e) {
      setPhase('edit');
      setError(e instanceof ApiError && (e.code === 'feedback_limit' || e.code === 'feedback_busy') ? t.fb.limit : t.error);
    }
  };

  if (phase === 'sent') {
    return (
      <Sheet title={t.fb.thanks} onClose={onClose}>
        <button className="act primary wide" onClick={onClose}>
          {t.done}
        </button>
      </Sheet>
    );
  }

  const empty = !text.trim() && !shots.length;
  return (
    <Sheet title={t.fb.title} onClose={onClose}>
      <div className="feedback-field">
        <textarea className="sheet-input feedback-text" value={text} maxLength={2000} rows={5} aria-label={t.fb.title} placeholder={t.fb.placeholder} onChange={(e) => setText(e.target.value)} />
        <button
          type="button"
          className={`feedback-mic${mic === 'recording' ? ' on' : ''}`}
          aria-label={mic === 'recording' ? t.fb.micStop : t.fb.mic}
          disabled={mic === 'starting' || mic === 'hearing' || phase === 'sending'}
          onClick={() => void toggleMic()}
        >
          {mic === 'recording' ? <StopIcon /> : <MicIcon />}
        </button>
      </div>
      {mic !== 'off' && <p className="sheet-note">{mic === 'hearing' ? t.fb.hearing : t.fb.recording}</p>}
      <div className="feedback-shots">
        {shots.map((shot) => (
          <div key={shot.url} className="feedback-shot">
            <img src={shot.url} alt="" />
            <button type="button" aria-label={t.fb.removeShot} onClick={() => removeShot(shot)}>
              ×
            </button>
          </div>
        ))}
        {shots.length < MAX_SHOTS && (
          <label className="feedback-add">
            {t.fb.addShot}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                // Сбросить выбор: тот же файл можно выбрать ещё раз (после «Убрать»).
                e.target.value = '';
                void addShots(files);
              }}
            />
          </label>
        )}
      </div>
      <p className="sheet-note">{t.fb.attach}</p>
      {error && <p className="error">{error}</p>}
      <button className="act primary wide" disabled={empty || mic !== 'off' || phase === 'sending'} onClick={() => void send()}>
        {t.fb.send}
      </button>
    </Sheet>
  );
}

const MicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <rect x="5" y="5" width="14" height="14" rx="3" />
  </svg>
);
