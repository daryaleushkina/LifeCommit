// Общие кусочки экранов групп: аватарки, значок группы, строка группового дела.
import type { ReactNode } from 'react';
import type { GroupDayItem, GroupKind, GroupMember } from '../../shared/groups';
import { plural } from '../../shared/groups';
import { useT } from '../i18n';
import { Check } from './TodoList';

/** Цвета аватарок — по id, чтобы у человека был один цвет везде. */
const AVATAR = [
  ['#DCEBDD', '#1F4A2C'],
  ['#DDE3F0', '#23365C'],
  ['#F1E3C8', '#5A4214'],
  ['#EBDCE6', '#5A2748'],
  ['#E3E0F2', '#3A2F6B'],
  ['#D9ECEC', '#1E4B4B'],
] as const;

/** Значок группы по типу: фон и цвет буквы. */
export const KIND_COLORS: Record<GroupKind, readonly [string, string]> = {
  family: ['#F5EBD3', '#6E4F0E'],
  sport: ['#E6F2E9', '#237A46'],
  pair: ['#E3E9F6', '#2B4579'],
  friends: ['#EBDCE6', '#5A2748'],
  work: ['#E3E0F2', '#3A2F6B'],
  other: ['#ECEAE3', '#4A5449'],
};

export function Avatar({ member, size = 28 }: { member: Pick<GroupMember, 'id' | 'name' | 'photo'>; size?: number }): ReactNode {
  const [bg, fg] = AVATAR[Math.abs(member.id) % AVATAR.length]!;
  return member.photo ? (
    <img className="avatar" src={member.photo} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="avatar" aria-hidden style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.42) }}>
      {(member.name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AvatarStack({ members, size = 24, max = 4 }: { members: GroupMember[]; size?: number; max?: number }): ReactNode {
  return (
    <span className="avatar-stack" aria-hidden>
      {members.slice(0, max).map((m) => (
        <Avatar key={m.id} member={m} size={size} />
      ))}
      {members.length > max && <span className="avatar more" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>+{members.length - max}</span>}
    </span>
  );
}

export function GroupBadge({ kind, title, size = 48 }: { kind: GroupKind; title: string; size?: number }): ReactNode {
  const [bg, fg] = KIND_COLORS[kind] ?? KIND_COLORS.other;
  return (
    <span className="group-badge" aria-hidden style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.42), borderRadius: Math.round(size * 0.33) }}>
      {title.slice(0, 1).toUpperCase()}
    </span>
  );
}

const nameOf = (members: GroupMember[], id: number, me: number, meLabel: string) => (id === me ? meLabel : members.find((m) => m.id === id)?.name ?? '…');

/** Число цели: «62 400» и, если единица известна, «₽» или «книг». */
export function goalNumber(n: number, it: Pick<GroupDayItem, 'unit'>, fmt: (n: number) => string): string {
  if (!it.unit) return fmt(n);
  if (it.unit.currency) return `${fmt(n)} ${it.unit.currency}`;
  return `${fmt(n)} ${plural(n, it.unit.forms)}`;
}

interface RowProps {
  item: GroupDayItem;
  members: GroupMember[];
  me: number;
  onToggle?: () => void;
  onOpen?: () => void;
  onPut?: () => void;
}

/** Строка группового дела: галочка (если моё), название, кто делает / кто сделал. */
export function GroupItemRow({ item: it, members, me, onToggle, onOpen, onPut }: RowProps): ReactNode {
  const t = useT();
  const g = t.gr;
  const name = (id: number) => nameOf(members, id, me, g.me);
  const meta: ReactNode[] = [];
  if (it.time) meta.push(<b key="time" className="group-time">{it.time}</b>);
  if (it.mode === 'event') meta.push(<span key="m" className="badge gray">{g.event}</span>);
  else if (it.mode === 'one') meta.push(<span key="m" className="badge gray">{g.anyone}</span>);
  else if (it.mode === 'assign') {
    if (it.turn !== null) meta.push(<span key="m" className={`badge ${it.turn === me ? 'me' : 'gray'}`}>{it.turn === me ? g.yourTurn : g.turnOf(name(it.turn))}</span>);
    else if (it.people.length === 1) meta.push(<span key="m" className={`badge ${it.people[0] === me ? 'me' : 'amber'}`}>{it.people[0] === me ? g.toYou : name(it.people[0]!)}</span>);
    else meta.push(<span key="m" className="badge blue">{g.toAll}</span>);
  }
  if (it.done_by.length > 0 && it.mode !== 'goal') meta.push(<span key="d">{g.doneBy(it.done_by.map(name).join(', '))}</span>);
  const fmt = t.num;

  if (it.mode === 'goal') {
    const total = it.total ?? 0;
    const target = it.target ?? 1;
    return (
      <li className="group-goal">
        <button className="todo-main" onClick={onOpen}>
          <span className="todo-text">
            <span>{it.title}</span>
            <small>{g.goalOf(goalNumber(total, it, fmt), goalNumber(target, it, fmt))}</small>
            <span className="goal-bar" aria-hidden>
              <i style={{ width: `${Math.min(100, (total / target) * 100)}%` }} />
            </span>
          </span>
        </button>
        {onPut && (
          <button className="goal-put" onClick={onPut}>
            + {g.put}
          </button>
        )}
      </li>
    );
  }

  return (
    <li className={it.done ? 'done' : undefined}>
      {it.mode === 'event' ? (
        <span className="todo-event" aria-hidden />
      ) : it.can_mark ? (
        <button className="todo-check" aria-pressed={it.done} aria-label={it.done ? t.todo.uncheck(it.title) : t.todo.check(it.title)} onClick={onToggle}>
          <Check />
        </button>
      ) : (
        <span className={`todo-check ${it.done ? 'filled' : 'ghost'}`} aria-hidden>
          <Check />
        </span>
      )}
      <button className="todo-main" onClick={onOpen}>
        <span className="todo-text">
          <span>{it.title}</span>
          {meta.length > 0 && <small className="group-meta">{meta}</small>}
        </span>
      </button>
    </li>
  );
}
