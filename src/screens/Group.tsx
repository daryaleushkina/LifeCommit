// Экран группы (дизайн 16E/16F): дела на сегодня с отметками, люди, приглашение, вклад в общую цель.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { hapticFeedback, openTelegramLink, popup } from '@tma.js/sdk-react';
import type { GroupDayItem } from '../../shared/groups';
import { api, ApiError, type GroupDetail } from '../api';
import { GroupItemSheet } from '../components/GroupItemSheet';
import { Avatar, AvatarStack, GroupBadge, GroupItemRow } from '../components/groupUi';
import { Sheet } from '../components/Picker';
import { useT } from '../i18n';
import { useBackButton } from '../telegram/hooks';

interface Props {
  id: number;
  me: number;
  today: string;
  onBack: () => void;
  /** Что-то поменялось — «Сегодня» перечитает себя. */
  onChanged: () => void;
}

/** Порядок: несделанные по времени, потом без времени, мероприятия, сделанные вниз; цели — отдельно сверху. */
const order = (it: GroupDayItem) => (it.done ? 3 : it.mode === 'event' ? 2 : it.time ? 0 : 1);

export function Group({ id, me, today, onBack, onChanged }: Props): ReactNode {
  const t = useT();
  const g = t.gr;
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'items' | 'people'>('items');
  const [editing, setEditing] = useState<GroupDayItem | 'new' | null>(null);
  const [putting, setPutting] = useState<GroupDayItem | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useBackButton(onBack);
  const load = useCallback(() => api.group(id).then(setGroup, () => setMissing(true)), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <main className="app-shell">
        <p className="empty">{g.join.notFound}</p>
      </main>
    );
  }
  if (!group) return <main className="app-shell" />;

  const changed = () => {
    void load();
    onChanged();
  };

  const toggle = async (it: GroupDayItem) => {
    const done = !it.done;
    // Сразу на экране; если не вышло — вернём как было.
    setGroup((cur) => cur && { ...cur, items: cur.items.map((x) => (x.id === it.id ? { ...x, done, done_by: done ? [...x.done_by, me] : x.done_by.filter((u) => u !== me) } : x)) });
    if (done) hapticFeedback.notificationOccurred.ifAvailable('success');
    try {
      const res = await api.markItem(group.id, it.id, done);
      if (res.taken) setNote(g.taken);
    } catch (e) {
      setNote(e instanceof ApiError && e.code === 'not_yours' ? g.notYours : t.error);
    }
    changed();
  };

  const invite = async () => {
    const { link } = await api.invite(group.id);
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`${group.title} · LifeCommit`)}`;
    if (openTelegramLink.isAvailable()) openTelegramLink(share);
    else window.open(share, '_blank');
    setNote(g.inviteSent);
  };

  // Добавить бота в чат Telegram: тот же код приглашения, но ссылка «в группу» (startgroup).
  const connectChat = async () => {
    const { link } = await api.invite(group.id);
    const url = link.replace('?startapp=', '?startgroup=');
    if (openTelegramLink.isAvailable()) openTelegramLink(url);
    else window.open(url, '_blank');
  };

  const leave = async (remove: boolean) => {
    if (popup.show.isAvailable()) {
      const answer = await popup.show({ message: remove ? g.removeConfirm : g.leaveConfirm, buttons: [{ id: 'ok', type: 'destructive', text: remove ? g.remove_group : g.leave }, { type: 'cancel' }] });
      if (answer !== 'ok') return;
    }
    await (remove ? api.deleteGroup(group.id) : api.leaveGroup(group.id)).catch(() => {});
    onChanged();
    onBack();
  };

  const goals = group.items.filter((it) => it.mode === 'goal');
  const items = group.items.filter((it) => it.mode !== 'goal').sort((a, b) => order(a) - order(b) || (a.time ?? '').localeCompare(b.time ?? ''));
  const doneToday = (uid: number) => group.items.filter((it) => it.done_by.includes(uid)).map((it) => it.title);

  return (
    <main className="app-shell group-screen">
      <header className="group-header">
        <GroupBadge kind={group.kind} title={group.title} size={60} />
        <span>
          <h1>{group.title}</h1>
          <span className="group-sub">
            <AvatarStack members={group.members} size={20} />
            {g.people(group.members.length)}
            {group.planned > 0 && ` · ${g.progress(group.done, group.planned)}`}
          </span>
        </span>
      </header>

      <div className="segmented two" role="radiogroup">
        {(['items', 'people'] as const).map((k) => (
          <button key={k} role="radio" aria-checked={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {g.tabs[k]}
          </button>
        ))}
      </div>

      {note && (
        <p className="note" onClick={() => setNote(null)}>
          {note}
        </p>
      )}

      {tab === 'items' ? (
        <>
          {goals.length > 0 && (
            <ul className="card todo-list">
              {goals.map((it) => (
                <GroupItemRow key={it.id} item={it} members={group.members} me={me} onOpen={() => setEditing(it)} onPut={() => setPutting(it)} />
              ))}
            </ul>
          )}
          <h2 className="section-label">{g.todayLabel}</h2>
          <ul className="card todo-list">
            {items.length === 0 && <li className="todo-empty">{g.nothingToday}</li>}
            {items.map((it) => (
              <GroupItemRow key={it.id} item={it} members={group.members} me={me} onToggle={() => void toggle(it)} onOpen={() => setEditing(it)} />
            ))}
          </ul>
          <button className="fab" onClick={() => setEditing('new')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            {g.addItem}
          </button>
        </>
      ) : (
        <>
          <ul className="card todo-list">
            {group.members.map((m) => {
              const done = doneToday(m.id);
              return (
                <li key={m.id} className="member-row">
                  <Avatar member={m} size={40} />
                  <span className="todo-text">
                    <span>{m.id === me ? `${m.name} (${g.me})` : m.name}</span>
                    {done.length > 0 && <small>{g.doneBy(done.join(', '))}</small>}
                  </span>
                </li>
              );
            })}
          </ul>
          <button className="act primary wide" onClick={() => void invite()}>
            {g.invite}
          </button>
          <p className="sheet-note center">{g.inviteHint}</p>
          <button className="act wide chat-connect" onClick={() => void connectChat()}>
            {group.settings.tg_chat_title ? g.chatConnected(group.settings.tg_chat_title) : g.connectChat}
          </button>
          <p className="sheet-note center">{g.connectChatHint}</p>
          <button className="quiet-link danger" onClick={() => void leave(false)}>
            {g.leave}
          </button>
          {group.role === 'owner' && (
            <button className="quiet-link danger" onClick={() => void leave(true)}>
              {g.remove_group}
            </button>
          )}
        </>
      )}

      {editing && (
        <GroupItemSheet
          group={group}
          me={me}
          today={today}
          item={editing === 'new' ? undefined : editing}
          onSaved={() => {
            setEditing(null);
            changed();
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {putting && (
        <PutSheet
          item={putting}
          groupTitle={putting.title}
          onClose={() => setPutting(null)}
          onPut={async (amount) => {
            await api.addEntry(group.id, putting.id, amount).catch(() => setNote(t.error));
            setPutting(null);
            changed();
          }}
        />
      )}
    </main>
  );
}

/** Вклад в общую цель: одно число. Единица — от цели (если её узнали). */
function PutSheet({ item, groupTitle, onClose, onPut }: { item: GroupDayItem; groupTitle: string; onClose: () => void; onPut: (n: number) => Promise<void> }): ReactNode {
  const t = useT();
  const g = t.gr;
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(value.replace(/\s/g, '').replace(',', '.'));
  const total = item.total ?? 0;
  return (
    <Sheet title={g.putTitle(groupTitle)} onClose={onClose}>
      <input className="sheet-input big-number" autoFocus inputMode="decimal" placeholder={g.putPh} aria-label={g.putPh} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d\s.,]/g, ''))} />
      {n > 0 && item.target ? <p className="sheet-note center">{g.goalOf(t.num(total + n), t.num(item.target))}</p> : null}
      <button
        className="act primary wide"
        disabled={busy || !(n > 0)}
        onClick={async () => {
          setBusy(true);
          await onPut(n);
        }}
      >
        {g.put}
      </button>
    </Sheet>
  );
}
