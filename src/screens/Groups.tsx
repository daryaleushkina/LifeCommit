// Вкладка «Вместе» (дизайн 16A, друзья — 24B′): «Группы · Друзья». Группы — с прогрессом дня и «Новая группа» (16Q),
// друзья — списком (Friends.tsx; «Позвать друга» — плюс рядом с поиском, 27F). Последний выбор помним на устройстве.
import { useEffect, useState, type ReactNode } from 'react';
import type { GroupToday } from '../../shared/groups';
import type { TodayTask } from '../../shared/types';
import { api } from '../api';
import { caches, load as fetchInto } from '../caches';
import { AvatarStack, GroupBadge } from '../components/groupUi';
import { Sheet } from '../components/Picker';
import { useT } from '../i18n';
import { FriendsPanel } from './Friends';

export type Section = 'groups' | 'friends';
const SECTION_KEY = 'lc-together';
function savedSection(): Section {
  try {
    return localStorage.getItem(SECTION_KEY) === 'friends' ? 'friends' : 'groups';
  } catch {
    return 'groups';
  }
}

interface Props {
  me: number;
  /** Группы из «Сегодня» — чтобы вкладка открылась сразу, без ожидания. */
  initial: GroupToday[];
  onOpen: (id: number) => void;
  /** Мои привычки — для «Что показать друзьям?». */
  habits: TodayTask[];
  onOpenFriend: (id: number) => void;
  onRequests: () => void;
  /** Видимость привычек поменялась — перечитать «Сегодня». */
  onShown: () => void;
  /** Открыть сразу этот раздел (пришли со ссылки друга — к друзьям). */
  section?: Section;
}

export function Groups({ me, initial, onOpen, habits, onOpenFriend, onRequests, onShown, section: start }: Props): ReactNode {
  const t = useT();
  const g = t.gr;
  const [section, setSection] = useState<Section>(start ?? savedSection);
  const choose = (next: Section) => {
    setSection(next);
    try {
      localStorage.setItem(SECTION_KEY, next);
    } catch {
      // не запомнили — в следующий раз откроются группы
    }
  };
  // Список обновляется вместе с «Сегодня» (после любых правок) — первым кадром он уже свежий.
  const [list, setList] = useState<GroupToday[] | null>(caches.groupList ?? initial);
  const [creating, setCreating] = useState(false);
  const load = () => fetchInto.groupList().then(setList, () => setList((cur) => cur ?? []));
  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <header className="page-head">
        <h1>{t.groups}</h1>
      </header>

      <div className="segmented two together-switch" role="radiogroup">
        {(['groups', 'friends'] as const).map((k) => (
          <button key={k} role="radio" aria-checked={section === k} className={section === k ? 'on' : ''} onClick={() => choose(k)}>
            {t.fr.tabs[k]}
          </button>
        ))}
      </div>

      {section === 'friends' ? (
        <FriendsPanel habits={habits} onOpen={onOpenFriend} onRequests={onRequests} onShown={onShown} />
      ) : (
        <>
          {list !== null && list.length === 0 && <p className="empty">{g.empty}</p>}

          <div className="group-list">
            {(list ?? []).map((group) => {
              const mine = group.items.find((it) => it.for_me && !it.done && it.mode !== 'goal' && it.mode !== 'event' && it.people.includes(me) && it.people.length === 1);
              const goal = group.items.find((it) => it.mode === 'goal');
              return (
                <button key={group.id} className="card group-card" onClick={() => onOpen(group.id)}>
                  <span className="group-card-head">
                    <GroupBadge id={group.id} title={group.title} />
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
        </>
      )}

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

/** Новая группа: только название — тип не нужен, значок и цвет берутся из самой группы. */
function NewGroupSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }): ReactNode {
  const t = useT();
  const g = t.gr;
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const { id } = await api.createGroup(title.trim(), 'other');
      // Экран новой группы — сразу целиком, и в списке она уже есть, когда вернутся.
      const detail = await fetchInto.group(id).catch(() => null);
      if (detail) caches.groupList = [...(caches.groupList ?? []).filter((x) => x.id !== id), detail];
      onCreated(id);
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <Sheet title={g.newGroup} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && !busy) void create();
        }}
      >
        <input className="sheet-input" autoFocus maxLength={60} enterKeyHint="done" placeholder={g.namePh} aria-label={g.namePh} value={title} onChange={(e) => setTitle(e.target.value)} />
      </form>
      {error && <p className="error">{t.error}</p>}
      <button className="act primary wide" disabled={busy || !title.trim()} onClick={() => void create()}>
        {g.create}
      </button>
    </Sheet>
  );
}
