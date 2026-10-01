// Вкладка «Вместе» (дизайн 16A): мои группы с прогрессом дня и «Новая группа» (16Q).
import { useEffect, useState, type ReactNode } from 'react';
import type { GroupKind, GroupToday } from '../../shared/groups';
import { api } from '../api';
import { AvatarStack, GroupBadge } from '../components/groupUi';
import { Sheet } from '../components/Picker';
import { useT } from '../i18n';

interface Props {
  me: number;
  onOpen: (id: number) => void;
}

export function Groups({ me, onOpen }: Props): ReactNode {
  const t = useT();
  const g = t.gr;
  const [list, setList] = useState<GroupToday[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = () => api.groups().then(setList, () => setList([]));
  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <header className="page-head">
        <h1>{t.groups}</h1>
        <p>{g.subtitle}</p>
      </header>

      {list !== null && list.length === 0 && <p className="empty">{g.empty}</p>}

      <div className="group-list">
        {(list ?? []).map((group) => {
          const mine = group.items.find((it) => it.for_me && !it.done && it.mode !== 'goal' && it.mode !== 'event' && it.people.includes(me) && it.people.length === 1);
          const goal = group.items.find((it) => it.mode === 'goal');
          return (
            <button key={group.id} className="card group-card" onClick={() => onOpen(group.id)}>
              <span className="group-card-head">
                <GroupBadge kind={group.kind} title={group.title} />
                <span className="group-card-title">
                  <b>{group.title}</b>
                  <small>{g.people(group.members.length)}</small>
                </span>
                <AvatarStack members={group.members} />
              </span>
              {group.planned > 0 && (
                <span className="group-progress">
                  <span className="goal-bar" aria-hidden>
                    <i style={{ width: `${(group.done / group.planned) * 100}%` }} />
                  </span>
                  <b>{g.progress(group.done, group.planned)}</b>
                </span>
              )}
              {goal && goal.target ? (
                <small className="group-card-note">{g.goalOf(`${goal.title}: ${t.num(goal.total ?? 0)}`, t.num(goal.target))}</small>
              ) : null}
              {mine && <small className="group-card-note">{g.forYou(mine.title)}</small>}
            </button>
          );
        })}
        <button className="add-dashed" onClick={() => setCreating(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {g.newGroup}
        </button>
      </div>

      {creating && (
        <NewGroupSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      )}
    </>
  );
}

const KINDS: GroupKind[] = ['family', 'sport', 'pair', 'friends', 'work', 'other'];

/** Новая группа: название и тип (тип подсказывает значок и примеры дел). */
function NewGroupSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }): ReactNode {
  const t = useT();
  const g = t.gr;
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<GroupKind>('family');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      onCreated((await api.createGroup(title.trim(), kind)).id);
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <Sheet title={g.newGroup} onClose={onClose}>
      <input className="sheet-input" autoFocus maxLength={60} placeholder={g.namePh} aria-label={g.namePh} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="kind-grid" role="radiogroup" aria-label={g.newGroup}>
        {KINDS.map((k) => (
          <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            <GroupBadge kind={k} title={g.kinds[k]} size={36} />
            <span>
              <b>{g.kinds[k]}</b>
              <small>{g.kindHints[k]}</small>
            </span>
          </button>
        ))}
      </div>
      {error && <p className="error">{t.error}</p>}
      <button className="act primary wide" disabled={busy || !title.trim()} onClick={() => void create()}>
        {g.create}
      </button>
    </Sheet>
  );
}
