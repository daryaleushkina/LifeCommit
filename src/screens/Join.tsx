// Вступление по ссылке t.me/LifeCommit_bot?startapp=g_<код> (дизайн 16R): кто зовёт, что будет, что группа НЕ видит.
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type Invitation } from '../api';
import { caches, load as fetchInto } from '../caches';
import { Avatar, GroupBadge } from '../components/groupUi';
import { useT } from '../i18n';
import { useBackButton } from '../telegram/hooks';

interface Props {
  code: string;
  onJoined: (groupId: number) => void;
  onClose: () => void;
}

export function Join({ code, onJoined, onClose }: Props): ReactNode {
  const t = useT();
  const j = t.gr.join;
  // Приглашение подтянуто ещё на заставке — экран открывается целиком.
  const [inv, setInv] = useState<Invitation | null>(caches.invitations.get(code) ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useBackButton(onClose);

  const [error, setError] = useState(false);
  // «Не найдено» и «устарело» — только когда так ответил сервер; моргнула сеть — «попробуйте ещё раз», кнопка жива.
  const problemOf = (e: unknown): string | null =>
    e instanceof ApiError && e.code === 'invite_expired' ? j.expired : e instanceof ApiError && e.status === 404 ? j.notFound : null;
  useEffect(() => {
    fetchInto.invitation(code).then(setInv, (e: unknown) =>
      setProblem(e instanceof ApiError && e.code === 'invite_expired' ? j.expired : e instanceof ApiError && e.status === 404 ? j.notFound : t.error),
    );
  }, [code, j.expired, j.notFound, t.error]);

  if (problem) {
    return (
      <main className="app-shell center">
        <p className="empty">{problem}</p>
        <button className="act primary" onClick={onClose}>
          {j.later}
        </button>
      </main>
    );
  }
  if (!inv) return <main className="app-shell" />;

  const join = async () => {
    setBusy(true);
    setError(false);
    try {
      const { id } = await api.join(code);
      // Экран группы открывается сразу целиком, а не пустым.
      await fetchInto.group(id).catch(() => null);
      onJoined(id);
    } catch (e) {
      const p = problemOf(e);
      if (p) setProblem(p);
      else setError(true);
      setBusy(false);
    }
  };

  const points = [
    { icon: <path d="M5 12.5l4.5 4.5L19 7.5" />, title: j.p1, sub: j.p1s },
    { icon: <path d="M21 4L3 11l6 2.5L19 7l-7.5 8L18 20l3-16z" />, title: j.p2, sub: j.p2s },
    { icon: <path d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v10h-13z" />, title: j.p3, sub: j.p3s },
  ];

  return (
    <main className="app-shell join-screen">
      <div className="join-hero">
        <GroupBadge id={inv.group.id} title={inv.group.title} size={96} />
        <span className="join-from">{inv.inviter ? j.invites(inv.inviter) : j.invitesAnon}</span>
        <h1>{inv.group.title}</h1>
        <span className="join-members">
          <span className="avatar-stack" aria-hidden>
            {inv.members.slice(0, 4).map((m) => (
              <Avatar key={m.id} member={{ ...m, photo: null }} size={28} />
            ))}
          </span>
          {inv.members.map((m) => m.name).join(', ')}
        </span>
      </div>

      <h2 className="section-label">{j.what}</h2>
      <ul className="card todo-list">
        {points.map((p) => (
          <li key={p.title} className="join-point">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {p.icon}
            </svg>
            <span className="todo-text">
              <span>{p.title}</span>
              <small>{p.sub}</small>
            </span>
          </li>
        ))}
      </ul>

      {inv.member ? (
        <button className="act primary wide" onClick={() => onJoined(inv.group.id)}>
          {j.open}
        </button>
      ) : (
        <>
          {error && <p className="error">{t.error}</p>}
          <button className="act primary wide" disabled={busy} onClick={() => void join()}>
            {j.btn}
          </button>
        </>
      )}
      <button className="quiet-link" onClick={onClose}>
        {inv.member ? j.already : j.later}
      </button>
    </main>
  );
}
