// «Войти на Mac?» — в мини-аппе по ссылке t.me/LifeCommit_bot?startapp=mac_<код>, которую открыл компьютер
// (вход на компьютере, worker/desktop.ts). Подтвердили — компьютер сам забирает ключ и входит.
import { useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { useBackButton } from '../telegram/hooks';

interface Props {
  /** Билет из ссылки: код, время выдачи и подпись (проверяет Worker). */
  ticket: string;
  device: 'mac' | 'web';
  onClose: () => void;
}

/** start_param «mac_<билет>» / «web_<билет>» → что подтверждать; другое — null. */
export function desktopLoginParam(startParam: string | null): { ticket: string; device: 'mac' | 'web' } | null {
  const m = /^(mac|web)_([A-Za-z0-9_-]{22}[0-9a-z]{7}[A-Za-z0-9_-]{22})$/.exec(startParam ?? '');
  return m ? { device: m[1] as 'mac' | 'web', ticket: m[2]! } : null;
}

const Laptop = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="5" width="16" height="11" rx="2" />
    <path d="M2 19h20" />
  </svg>
);

const Check = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export function DesktopApprove({ ticket, device, onClose }: Props): ReactNode {
  const d = useT().desktop;
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'used' | 'expired' | 'failed'>('ask');
  useBackButton(onClose);

  const approve = async () => {
    setState('busy');
    try {
      await api.desktopApprove(ticket, device);
      setState('done');
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setState(status === 409 ? 'used' : status === 410 ? 'expired' : 'failed');
    }
  };

  if (state === 'used' || state === 'expired') {
    return (
      <main className="app-shell center">
        <p className="empty">{state === 'used' ? d.used : d.linkExpired}</p>
        <button className="act primary" onClick={onClose}>
          {d.toToday}
        </button>
      </main>
    );
  }

  const done = state === 'done';
  return (
    <main className="app-shell join-screen desktop-approve">
      <div className="join-hero">
        <span className="desktop-badge">{done ? <Check /> : <Laptop />}</span>
        <h1>{done ? d.doneTitle : d.approveTitle[device]}</h1>
        <span className="join-from">{done ? d.doneSub : d.approveSub}</span>
      </div>
      {done ? (
        <button className="act primary wide" onClick={onClose}>
          {d.toToday}
        </button>
      ) : (
        <>
          {state === 'failed' && <p className="error">{d.failed}</p>}
          <button className="act primary wide" disabled={state === 'busy'} onClick={() => void approve()}>
            {d.approve}
          </button>
          <p className="note center">{d.approveNote}</p>
          <button className="quiet-link" onClick={onClose}>
            {d.notNow}
          </button>
        </>
      )}
    </main>
  );
}
