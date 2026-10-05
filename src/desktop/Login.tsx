// Вход на компьютере (приложение для Mac и браузер): «Войти через Telegram» открывает мини-апп в Telegram с вопросом
// «Войти на Mac?», а этот экран ждёт подтверждения и сам забирает ключ (worker/desktop.ts).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { openTelegramLink } from '@tma.js/sdk-react';
import { api, ApiError } from '../api';
import { Logo } from '../components/Logo';
import { useT } from '../i18n';
import { desktopDevice, saveDesktopToken } from './session';

/** Ссылка на подтверждение живёт 10 минут (как подтверждение на сервере). */
const WAIT_MS = 10 * 60_000;
/** Столько ответов сервера с ошибкой подряд — и честно «не получилось», а не 10 минут «ждём». */
const MAX_SERVER_ERRORS = 3;

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
  // onDone — в ref: новая функция от родителя не должна перезапускать опрос (ответ «ok» посреди перезапуска
  // приняли бы за «Отмена» и ключ погасили бы).
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });

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
    let serverErrors = 0;
    const tick = async () => {
      if (Date.now() > until) return setState({ step: 'idle', note: 'expired' });
      // Связь моргнула — спросим ещё раз; не подтвердили за 10 минут — «время вышло». Сервер отвечает ошибкой
      // несколько раз подряд — это не «ждём»: говорим «не получилось».
      const res = await api.desktopPoll(secret).then(
        (r) => {
          serverErrors = 0;
          return r;
        },
        (e: unknown) => {
          console.warn('desktop poll failed', e);
          if (e instanceof ApiError) serverErrors += 1;
          return null;
        },
      );
      if (!alive) {
        // Нажали «Отмена», пока ждали ответа, а вход как раз подтвердили — ключ не сохраняем и гасим.
        if (res?.status === 'ok') api.dropDesktopKey(res.token).catch((e: unknown) => console.warn('desktop key drop failed', e));
        return;
      }
      // Ключ по этому входу уже выдан, а до нас не дошёл (сеть оборвалась на ответе) — честно «не получилось».
      if (serverErrors >= MAX_SERVER_ERRORS || res?.status === 'claimed') return setState({ step: 'idle', note: 'failed' });
      if (res?.status === 'ok') {
        try {
          saveDesktopToken(res.token);
        } catch {
          // хранилище недоступно (приватный режим браузера) — войти не выйдет; ключ гасим, чтобы не висел в «Компьютерах»
          api.dropDesktopKey(res.token).catch((e: unknown) => console.warn('desktop key drop failed', e));
          return setState({ step: 'idle', note: 'failed' });
        }
        return done.current();
      }
      timer = setTimeout(() => void tick(), pollMs);
    };
    timer = setTimeout(() => void tick(), pollMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [secret, until, pollMs]);

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
