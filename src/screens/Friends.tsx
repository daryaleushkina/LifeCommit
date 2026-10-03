// Друзья (допрос 03.10.2026). Список во «Вместе» (24B′), «Позвать друга» (24E), заявки (25M), экран друга
// (25L, привычки — списком с иконкой), вход по чужой ссылке и «Что показать друзьям?» (25H — плитки, «Выбрать все»).
// Дружба всегда через заявку. С другом — только смотреть: реакций и лайков нет.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { openTelegramLink, popup } from '@tma.js/sdk-react';
import { heatLevel, type FriendCard, type FriendProfile, type FriendRequest, type FriendsResponse, type Person, type PersonStatus, type TodayTask } from '../../shared/types';
import { api, ApiError } from '../api';
import { caches, load as fetchInto } from '../caches';
import { Avatar } from '../components/groupUi';
import { HeatCard } from '../components/HeatCard';
import { KindTile } from '../components/KindIcon';
import { Sheet } from '../components/Picker';
import { useT } from '../i18n';
import { useBackButton } from '../telegram/hooks';

const EMPTY: FriendsResponse = { friends: [], incoming: [], outgoing: [], link: '', prompt: false };

const asMember = (p: Person) => ({ id: p.id, name: p.first_name, photo: p.photo_url });

const Chevron = () => (
  <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** Подтверждение через окно Telegram; вне Telegram окна нет — действуем сразу. */
async function confirmed(message: string, ok: string): Promise<boolean> {
  if (!popup.show.isAvailable()) return true;
  return (await popup.show({ message, buttons: [{ id: 'ok', type: 'destructive', text: ok }, { type: 'cancel' }] })) === 'ok';
}

/** Кто сейчас показывает список друзей: свежий ответ приходит и к ним. */
const listeners = new Set<(d: FriendsResponse) => void>();
let friendsSeq = 0;

/**
 * Перечитать друзей (после заявки, принятия, блока). Всегда новым запросом: уже идущий мог уйти до правки
 * (приняли заявку и сразу «назад» — список оставался старым, 03.10.2026). Ответ старше последнего запроса не применяем.
 */
async function reloadFriends(): Promise<FriendsResponse | null> {
  const seq = ++friendsSeq;
  try {
    const d = await api.friends();
    if (seq === friendsSeq) {
      caches.friends = d;
      for (const l of listeners) l(d);
    }
  } catch {
    // нет сети — остаётся то, что было
  }
  return caches.friends;
}

// ── Список во «Вместе» ──

interface PanelProps {
  /** Мои привычки — для шторки «Что показать друзьям?». */
  habits: TodayTask[];
  onOpen: (id: number) => void;
  onRequests: () => void;
  /** Видимость привычек поменялась — перечитать «Сегодня». */
  onShown: () => void;
}

export function FriendsPanel({ habits, onOpen, onRequests, onShown }: PanelProps): ReactNode {
  const t = useT();
  const fr = t.fr;
  const [data, setData] = useState<FriendsResponse | null>(caches.friends);
  const [query, setQuery] = useState('');
  const [showing, setShowing] = useState(false);
  // Выбор «Что показать» не сохранился — шторка снова открыта с ним же и строкой ошибки.
  const [showFailed, setShowFailed] = useState<number[] | null>(null);
  const [inviting, setInviting] = useState(false);
  // Шторку «Что показать» — не больше раза за открытие, даже если сервер ещё не узнал, что её закрыли.
  const asked = useRef(false);
  useEffect(() => {
    const apply = (d: FriendsResponse) => {
      setData(d);
      // Первый друг появился — один раз спрашиваем, что ему показать.
      if (d.prompt && !asked.current) {
        asked.current = true;
        setShowing(true);
      }
    };
    listeners.add(apply);
    void reloadFriends().then((d) => setData((cur) => cur ?? d ?? EMPTY));
    return () => void listeners.delete(apply);
  }, []);

  const cancel = async (p: Person) => {
    await api.dropRequest(p.id).catch(() => {});
    await reloadFriends();
  };

  const closeShow = async (ids: number[] | null) => {
    setShowing(false);
    setShowFailed(null);
    if (ids) {
      try {
        await api.setShown(ids);
      } catch {
        setShowFailed(ids);
        setShowing(true);
        return;
      }
      onShown();
    }
    // «Назад» — служебная отметка «уже спросили»: не дошла — спросим в другой раз, ошибку не показываем.
    else await api.promptSeen().catch(() => {});
    await reloadFriends();
  };

  if (!data) return null;
  const q = query.trim().toLowerCase();
  const shown = q ? data.friends.filter((f) => f.first_name.toLowerCase().includes(q) || f.username?.toLowerCase().includes(q.replace(/^@/, ''))) : data.friends;

  return (
    <>
      {/* 27F: поиск по друзьям и «Позвать друга» — одной строкой под переключателем. */}
      <div className="friend-tools">
        <label className="friend-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <input type="search" placeholder={fr.search} aria-label={fr.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="invite-btn" aria-label={fr.invite} onClick={() => setInviting(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {data.incoming.length > 0 && (
        <button className="card requests-row" onClick={onRequests}>
          <span className="avatar-stack" aria-hidden>
            {data.incoming.slice(0, 3).map((p) => (
              <Avatar key={p.id} member={asMember(p)} size={28} />
            ))}
          </span>
          <b>{fr.requests(data.incoming.length)}</b>
          <Chevron />
        </button>
      )}

      {data.friends.length === 0 && data.outgoing.length === 0 && <p className="empty">{fr.empty}</p>}
      {q && shown.length === 0 && <p className="empty">{fr.nothingFound}</p>}

      <div className="friend-list">
        {shown.map((f) => (
          <FriendRow key={f.id} friend={f} onOpen={() => onOpen(f.id)} />
        ))}
        {!q &&
          data.outgoing.map((p) => (
            <div key={p.id} className="card friend-card waiting">
              <Avatar member={asMember(p)} size={44} />
              <span className="friend-text">
                <b>{p.first_name}</b>
                <small>{fr.waiting}</small>
              </span>
              <button className="link-btn" onClick={() => void cancel(p)}>
                {fr.cancel}
              </button>
            </div>
          ))}
      </div>

      {/* Позвали кого-то — список обновится сам (там появится «ждём ответа»). */}
      {inviting && <AddFriendSheet onClose={() => setInviting(false)} />}

      {showing && (
        <ShowSheet habits={habits} picked={showFailed ?? undefined} failed={showFailed !== null} onClose={(ids) => void closeShow(ids)} />
      )}
    </>
  );
}

function FriendRow({ friend: f, onOpen }: { friend: FriendCard; onOpen: () => void }): ReactNode {
  const fr = useT().fr;
  return (
    <button className="card friend-card" onClick={onOpen}>
      <Avatar member={asMember(f)} size={44} />
      <span className="friend-text">
        <b>{f.first_name}</b>
        {/* Общая карта за две недели — без названий. */}
        <span className="strip" aria-hidden>
          {f.days.map((score, i) => (
            <i key={i} className={`l${heatLevel(score)}`} />
          ))}
        </span>
      </span>
      {f.due > 0 && <span className={`friend-progress${f.done > 0 ? ' some' : ''}`}>{fr.progress(f.done, f.due)}</span>}
      <Chevron />
    </button>
  );
}

// ── «Позвать друга» ──

export function AddFriendSheet({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const fr = t.fr;
  const [link, setLink] = useState(caches.friends?.link ?? '');
  const [name, setName] = useState('');
  const [found, setFound] = useState<{ person: Person; status: PersonStatus } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!link) reloadFriends().then((d) => d && setLink(d.link), () => {});
  }, [link]);

  // Ищем, когда перестали печатать.
  useEffect(() => {
    setFound(null);
    setProblem(null);
    const clean = name.trim();
    if (clean.replace(/^@/, '').length < 4) return;
    const timer = setTimeout(() => {
      api.findPerson(clean).then(setFound, (e) => setProblem(e instanceof ApiError && e.code === 'bad_username' ? fr.badUsername : fr.notFound));
    }, 400);
    return () => clearTimeout(timer);
  }, [name, fr.badUsername, fr.notFound]);

  const sendLink = () => {
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(fr.shareText)}`;
    if (openTelegramLink.isAvailable()) openTelegramLink(share);
    else window.open(share, '_blank');
  };

  const call = async (p: Person) => {
    setBusy(true);
    try {
      const { status } = await api.requestFriend({ username: p.username ?? name });
      setFound({ person: p, status });
      await reloadFriends();
    } catch {
      setProblem(t.error);
    }
    setBusy(false);
  };

  return (
    <Sheet title={fr.invite} onClose={onClose}>
      <button className="act primary wide" disabled={!link} onClick={sendLink}>
        {fr.sendLink}
      </button>
      <input
        className="sheet-input find-input"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder={fr.usernamePh}
        aria-label={fr.usernamePh}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {problem && <p className="find-note">{problem}</p>}
      {found && (
        <div className="person-row">
          <Avatar member={asMember(found.person)} size={40} />
          <span className="friend-text">
            <b>{found.person.first_name}</b>
            {found.person.username && <small>@{found.person.username}</small>}
          </span>
          {found.status === 'none' || found.status === 'incoming' ? (
            <button className="act small" disabled={busy} onClick={() => void call(found.person)}>
              {fr.call}
            </button>
          ) : (
            <small className="person-status">{fr.status[found.status]}</small>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ── Заявки (25M) ──

export function Requests({ onBack }: { onBack: () => void }): ReactNode {
  const t = useT();
  const fr = t.fr;
  const [list, setList] = useState<FriendRequest[]>(caches.friends?.incoming ?? []);
  // Принять или отклонить не вышло — заявка возвращается, сверху строка ошибки.
  const [error, setError] = useState(false);
  // Уже принятые и отклонённые: ответ, ушедший до нажатия, не должен вернуть их на экран.
  const done = useRef(new Set<number>());
  useBackButton(onBack);
  useEffect(() => {
    const apply = (d: FriendsResponse) => setList(d.incoming.filter((x) => !done.current.has(x.id)));
    listeners.add(apply);
    void reloadFriends();
    return () => void listeners.delete(apply);
  }, []);

  const act = async (p: FriendRequest, accept: boolean) => {
    setError(false);
    done.current.add(p.id);
    const at = list.findIndex((x) => x.id === p.id);
    setList((cur) => cur.filter((x) => x.id !== p.id));
    try {
      await (accept ? api.acceptFriend(p.id) : api.dropRequest(p.id));
    } catch {
      done.current.delete(p.id);
      setList((cur) => [...cur.slice(0, at), p, ...cur.slice(at)]);
      setError(true);
    }
    void reloadFriends();
  };

  return (
    <>
      <header className="page-head">
        <h1>{fr.requestsTitle}</h1>
      </header>
      {error && (
        <p className="error" onClick={() => setError(false)}>
          {t.error}
        </p>
      )}
      {list.length === 0 && <p className="empty">{fr.nothingFound}</p>}
      <div className="friend-list">
        {list.map((p) => (
          <div key={p.id} className="card request-card">
            <span className="request-who">
              <Avatar member={asMember(p)} size={44} />
              <span className="friend-text">
                <b>{p.first_name}</b>
                <small>{p.via === 'link' ? fr.viaLink : p.username ? `@${p.username}` : ''}</small>
              </span>
            </span>
            <span className="request-actions">
              <button className="act primary small" onClick={() => void act(p, true)}>
                {fr.accept}
              </button>
              <button className="act small" onClick={() => void act(p, false)}>
                {fr.decline}
              </button>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Экран друга (25L) ──

export function FriendScreen({ id, onBack }: { id: number; onBack: () => void }): ReactNode {
  const t = useT();
  const fr = t.fr;
  const [f, setF] = useState<FriendProfile | null>(caches.friendProfiles.get(id) ?? null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<'month' | 'year'>('month');
  const [offset, setOffset] = useState(0);
  useBackButton(onBack);
  useEffect(() => {
    fetchInto.friend(id).then(setF, (e) => {
      // Убрали из друзей (или заблокировали) — экрана нет; моргнула сеть — остаётся как был.
      if ((e instanceof ApiError && e.status === 404) || !caches.friendProfiles.has(id)) setMissing(true);
    });
  }, [id]);

  if (missing) return <p className="empty">{fr.linkNotFound}</p>;
  if (!f) return null;

  const leave = async (block: boolean) => {
    const name = f.person.first_name;
    if (!(await confirmed(block ? fr.blockConfirm(name) : fr.removeConfirm(name), block ? fr.block : fr.remove))) return;
    await (block ? api.block(id) : api.removeFriend(id)).catch(() => {});
    caches.friendProfiles.delete(id);
    await reloadFriends();
    onBack();
  };

  return (
    <>
      <header className="friend-header">
        <Avatar member={asMember(f.person)} size={64} />
        <span className="friend-text">
          <h1>{f.person.first_name}</h1>
          {f.person.username && <small>@{f.person.username}</small>}
        </span>
      </header>

      <HeatCard days={f.heat} today={f.today} view={view} onView={setView} offset={offset} onOffset={setOffset} />

      <h2 className="section-label">{fr.habits}</h2>
      {f.habits.length === 0 ? (
        <p className="empty">{fr.noShown}</p>
      ) : (
        <ul className="card friend-habits">
          {f.habits.map((h) => {
            const note =
              h.kind === 'abstain'
                ? h.clean_days > 0
                  ? t.cleanDays(h.clean_days)
                  : null
                : h.kind === 'count'
                  ? h.value > 0
                    ? fr.countToday(t.num(h.value), t.num(h.target), h.unit)
                    : null
                  : h.value > 0
                    ? fr.doneToday
                    : null;
            const done = h.kind === 'abstain' ? h.status === 'clean' : h.value >= (h.kind === 'check' ? 1 : h.target);
            return (
              <li key={h.id} className="friend-habit">
                <KindTile kind={h.kind} title={h.title} size="sm" />
                <span className="friend-text">
                  <b>{h.title}</b>
                  {note && <small className={done ? 'done' : ''}>{note}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="quiet-links">
        <button className="quiet-link" onClick={() => void leave(false)}>
          {fr.remove}
        </button>
        <button className="quiet-link danger" onClick={() => void leave(true)}>
          {fr.block}
        </button>
      </div>
    </>
  );
}

// ── Открыли чужую ссылку ──

export function FriendLink({ code, onClose, onFriends }: { code: string; onClose: () => void; onFriends: () => void }): ReactNode {
  const t = useT();
  const fr = t.fr;
  const [who, setWho] = useState<{ person: Person; status: PersonStatus } | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  useBackButton(onClose);
  useEffect(() => {
    api.friendLink(code).then(setWho, () => setMissing(true));
  }, [code]);

  if (missing) {
    return (
      <main className="app-shell center">
        <p className="empty">{fr.linkNotFound}</p>
        <button className="act primary" onClick={onClose}>
          {fr.later}
        </button>
      </main>
    );
  }
  if (!who) return <main className="app-shell" />;

  const name = who.person.first_name;
  const ask = async () => {
    setBusy(true);
    try {
      const { status } = await api.requestFriend({ code });
      setWho({ ...who, status });
      await reloadFriends();
    } catch {
      setMissing(true);
    }
    setBusy(false);
  };
  const line = { sent: fr.linkSent(name), friends: fr.linkFriends, self: fr.linkSelf, blocked: fr.linkBlocked, none: fr.linkSub, incoming: fr.linkSub }[who.status];

  return (
    <main className="app-shell join-screen">
      <div className="join-hero">
        <Avatar member={asMember(who.person)} size={88} />
        <h1>{who.status === 'self' ? name : fr.linkTitle(name)}</h1>
        <span className="join-from">{line}</span>
      </div>
      {who.status === 'none' || who.status === 'incoming' ? (
        <button className="act primary wide" disabled={busy} onClick={() => void ask()}>
          {fr.linkBtn}
        </button>
      ) : (
        <button className="act primary wide" onClick={who.status === 'friends' || who.status === 'sent' ? onFriends : onClose}>
          {fr.open}
        </button>
      )}
      <button className="quiet-link" onClick={onClose}>
        {fr.later}
      </button>
    </main>
  );
}

// ── «Что показать друзьям?» (25H) ──

/** На весь экран: плитки привычек, тап выбирает; «Выбрать все» — обязательно (правило владелицы). Назад — ничего не меняем. */
interface ShowSheetProps {
  habits: TodayTask[];
  /** Выбор, который не сохранился: шторка открыта снова с ним, а не с тем, что на сервере. */
  picked?: number[];
  /** Сохранить не вышло — строка ошибки над «Готово». */
  failed?: boolean;
  onClose: (ids: number[] | null) => void;
}

export function ShowSheet({ habits, picked: initial, failed = false, onClose }: ShowSheetProps): ReactNode {
  const t = useT();
  const fr = t.fr;
  const [picked, setPicked] = useState<Set<number>>(() => new Set(initial ?? habits.filter((h) => h.visibility === 'friends').map((h) => h.id)));
  useBackButton(() => onClose(null));
  const all = habits.length > 0 && picked.size === habits.length;
  const toggle = (id: number) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="show-screen" role="dialog" aria-modal="true" aria-label={fr.showTitle}>
      <header className="show-head">
        <h1>{fr.showTitle}</h1>
        {habits.length > 0 && (
          <button className="link-btn" aria-pressed={all} onClick={() => setPicked(all ? new Set() : new Set(habits.map((h) => h.id)))}>
            {fr.selectAll}
          </button>
        )}
      </header>
      <div className="show-tiles">
        {habits.map((h) => (
          <button key={h.id} className={`card show-tile${picked.has(h.id) ? ' on' : ''}`} aria-pressed={picked.has(h.id)} onClick={() => toggle(h.id)}>
            <KindTile kind={h.kind} title={h.title} />
            <b>{h.title}</b>
            <span className="tick" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          </button>
        ))}
      </div>
      {failed && <p className="error">{t.error}</p>}
      <button className="act primary wide show-done" onClick={() => onClose([...picked])}>
        {t.done}
      </button>
    </div>
  );
}
