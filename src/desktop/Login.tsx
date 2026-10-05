// Вход на компьютере (приложение для Mac и браузер): «Войти через Telegram» открывает мини-апп в Telegram с вопросом
// «Войти на Mac?», а этот экран ждёт подтверждения и сам забирает ключ (worker/desktop.ts).
import { useEffect, useState, type ReactNode } from 'react';
import { openTelegramLink } from '@tma.js/sdk-react';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { useT } from '../i18n';
import { desktopDevice, saveDesktopToken } from './session';

/** Ссылка на подтверждение живёт 10 минут (как подтверждение на сервере). */
const WAIT_MS = 10 * 60_000;

type State = { step: 'idle'; note?: 'expired' | 'failed' } | { step: 'waiting'; secret: string; link: string; until: number };

const Plane = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 4L3 11l6 2.5L19 7l-7.5 8L18 20l3-16z" />
  </svg>
);

/** pollMs — как часто спрашивать сервер, подтвердили ли вход. */
export function DesktopLogin({ onDone, pollMs = 2000 }: { onDone: () => void; pollMs?: number }): ReactNode {
  const d = useT().desktop;
  const [state, setState] = useState<State>({ step: 'idle' });
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const { secret, link } = await api.desktopLogin(desktopDevice());
      setState({ step: 'waiting', secret, link, until: Date.now() + WAIT_MS });
      openTelegramLink(link);
    } catch {
      setState({ step: 'idle', note: 'failed' });
    } finally {
      setBusy(false);
    }
  };

  const secret = state.step === 'waiting' ? state.secret : null;
  const until = state.step === 'waiting' ? state.until : 0;
  useEffect(() => {
    if (!secret) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (Date.now() > until) return setState({ step: 'idle', note: 'expired' });
      // Связь моргнула — спросим ещё раз; не подтвердили за 10 минут — «время вышло».
      const res = await api.desktopPoll(secret).catch(() => null);
      if (!alive) return;
      if (res?.status === 'ok') {
        try {
          saveDesktopToken(res.token);
        } catch {
          // хранилище недоступно (приватный режим браузера) — войти не выйдет
          return setState({ step: 'idle', note: 'failed' });
        }
        return onDone();
      }
      timer = setTimeout(() => void tick(), pollMs);
    };
    timer = setTimeout(() => void tick(), pollMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [secret, until, pollMs, onDone]);

  if (state.step === 'waiting') {
    return (
      <main className="app-shell center desktop-login">
        <Logo />
        <h1>{d.waiting}</h1>
        <p className="muted">{d.waitingSub}</p>
        <button className="act soft wide" onClick={() => openTelegramLink(state.link)}>
          {d.openAgain}
        </button>
        <button className="quiet-link" onClick={() => setState({ step: 'idle' })}>
          {d.cancel}
        </button>
      </main>
    );
  }

  return (
    <main className="app-shell center desktop-login">
      <Logo />
      <span className="brand">
        Life<b>Commit</b>
      </span>
      <p className="muted">{d.signInSub}</p>
      {state.note && <p className="error">{state.note === 'expired' ? d.expired : d.failed}</p>}
      <button className="act primary wide with-icon" disabled={busy} onClick={() => void start()}>
        <Plane />
        {d.signIn}
      </button>
    </main>
  );
}
