// Блоки групп на «Сегодня» (дизайн 16B): под личным — мои дела каждой группы; заголовок ведёт в группу.
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { hapticFeedback } from '@tma.js/sdk-react';
import type { GroupDayItem, GroupToday } from '../../shared/groups';
import { api } from '../api';
import { caches } from '../caches';
import { useT } from '../i18n';
import { bumpChange, type Cache } from '../useTaskLog';
import { AvatarStack, GroupItemRow } from './groupUi';

interface Props {
  groups: GroupToday[];
  me: number;
  setCache: Dispatch<SetStateAction<Cache>>;
  onOpen: (id: number) => void;
  /** Сегодняшний логический день: «убрать только сегодня» у повторяющегося. */
  today: string;
}

/** Что из группы показывать на «Сегодня»: моё, «кто-то один», мероприятия и цели. */
const mine = (it: GroupDayItem) => it.for_me;
const rank = (it: GroupDayItem) => (it.mode === 'goal' ? -1 : it.done ? 3 : it.mode === 'event' ? 2 : it.time ? 0 : 1);

export function GroupBlocks({ groups, me, setCache, onOpen, today }: Props): ReactNode {
  const t = useT();
  /** После удаления свайпом — свежие «Сегодня» и экран группы. */
  const reload = async (groupId: number) => {
    caches.groups.delete(groupId);
    const fresh = await api.today().catch(() => null);
    if (fresh) setCache((c) => ({ ...c, today: fresh, loadedAt: Date.now() }));
  };

  const toggle = async (group: GroupToday, it: GroupDayItem) => {
    const done = !it.done;
    const patch = (fn: (x: GroupDayItem) => GroupDayItem) =>
      setCache((c) => ({ ...c, today: { ...c.today, groups: c.today.groups.map((g) => (g.id === group.id ? { ...g, items: g.items.map((x) => (x.id === it.id ? fn(x) : x)) } : g)) } }));
    bumpChange();
    patch((x) => ({ ...x, done, done_by: done ? [...x.done_by, me] : x.done_by.filter((u) => u !== me) }));
    if (done) hapticFeedback.notificationOccurred.ifAvailable('success');
    try {
      await api.markItem(group.id, it.id, done);
    } catch {
      patch(() => it);
    }
    // Счётчики «5 из 8» и чужие отметки — с сервера.
    const today = await api.today().catch(() => null);
    if (today) setCache((c) => ({ ...c, today, loadedAt: Date.now() }));
  };

  return (
    <>
      {groups.map((group) => {
        const items = group.items.filter(mine).sort((a, b) => rank(a) - rank(b) || (a.time ?? '').localeCompare(b.time ?? ''));
        if (items.length === 0) return null;
        return (
          <section key={group.id} className="group-block">
            <button className="group-block-head" onClick={() => onOpen(group.id)}>
              <b>{group.title}</b>
              <AvatarStack members={group.members} size={22} />
              <span className="spacer" />
              {group.planned > 0 && <small>{t.gr.progress(group.done, group.planned)}</small>}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <ul className="card todo-list">
              {items.map((it) => (
                <GroupItemRow key={it.id} item={it} members={group.members} me={me} onToggle={() => void toggle(group, it)} onOpen={() => onOpen(group.id)} onPut={() => onOpen(group.id)} swipe={{ groupId: group.id, day: today, after: () => reload(group.id) }} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
