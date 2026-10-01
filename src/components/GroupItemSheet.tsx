// Новое (или правка) групповое дело — дизайн 16H с правками круга 18:
// четыре плитки «Кто делает»; у «Назначить» и «Мероприятия» — люди мультивыбором + «Все»,
// «По очереди» появляется, когда людей двое и больше.
import { useState, type ReactNode } from 'react';
import type { GroupDayItem, GroupMember, GroupMode } from '../../shared/groups';
import { api, type GroupItemInput } from '../api';
import { useT } from '../i18n';
import { Avatar } from './groupUi';
import { DateRow, SelectRow, Sheet, TimeRow } from './Picker';

type Repeat = 'once' | 'daily' | 'weekdays' | 'weekends' | 'weekly';
const WD = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const weekday = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;

function toRRule(r: Repeat, day: string): string | null {
  if (r === 'daily') return 'FREQ=DAILY';
  if (r === 'weekdays') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (r === 'weekends') return 'FREQ=WEEKLY;BYDAY=SA,SU';
  if (r === 'weekly') return `FREQ=WEEKLY;BYDAY=${WD[weekday(day)]}`;
  return null;
}

function fromRRule(rrule: string | null): Repeat {
  if (!rrule) return 'once';
  const r = rrule.toUpperCase();
  if (r === 'FREQ=DAILY') return 'daily';
  if (r.includes('BYDAY=MO,TU,WE,TH,FR')) return 'weekdays';
  if (r.includes('BYDAY=SA,SU')) return 'weekends';
  return 'weekly';
}

const ICONS: Record<GroupMode, ReactNode> = {
  one: <path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5.2-3L3.6 14a1.5 1.5 0 0 1 2.6-1.5L7 14" />,
  assign: <path d="M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c.7-3.4 3.5-5.3 7-5.3s6.3 1.9 7 5.3" />,
  goal: <path d="M7 4h10M8 4v3l-2 3v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-9l-2-3V4M6 13h12" />,
  event: <path d="M4 6.5h16v13.5H4zM4 10.5h16M8.5 4v4M15.5 4v4" />,
};

interface Props {
  group: { id: number; title: string; members: GroupMember[] };
  me: number;
  today: string;
  /** Правим существующее; нет — новое. */
  item?: GroupDayItem;
  onSaved: () => void;
  onClose: () => void;
}

export function GroupItemSheet({ group, me, today, item, onSaved, onClose }: Props): ReactNode {
  const t = useT();
  const g = t.gr;
  const [title, setTitle] = useState(item?.title ?? '');
  const [mode, setMode] = useState<GroupMode>(item?.mode ?? 'one');
  const [all, setAll] = useState(item ? item.all_members : false);
  const [people, setPeople] = useState<Set<number>>(new Set(item?.assignees.length ? item.assignees : [me]));
  const [rotate, setRotate] = useState(item?.rotate ?? false);
  const [repeat, setRepeat] = useState<Repeat>(fromRRule(item?.rrule ?? null));
  const [day, setDay] = useState(item?.start ?? today);
  const [time, setTime] = useState<string | null>(item?.time ?? null);
  const [target, setTarget] = useState(item?.target ? String(item.target) : '');
  const [until, setUntil] = useState(item?.goal_until ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const chosen = all ? group.members.map((m) => m.id) : [...people];
  const canRotate = mode === 'assign' && chosen.length >= 2;
  const targetNum = Number(target.replace(/\s/g, '').replace(',', '.'));
  const valid = title.trim().length > 0 && (mode !== 'goal' || targetNum > 0) && ((mode !== 'assign' && mode !== 'event') || chosen.length > 0);

  const toggle = (id: number) => {
    const next = new Set(all ? group.members.map((m) => m.id) : people);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAll(false);
    setPeople(next);
  };

  const save = async () => {
    setBusy(true);
    setError(false);
    const input: GroupItemInput = {
      title: title.trim(),
      mode,
      day: mode === 'goal' ? today : day,
      time: mode === 'goal' ? null : time,
      rrule: mode === 'goal' ? null : toRRule(repeat, day),
      assignees: mode === 'assign' || mode === 'event' ? (all ? [] : [...people]) : [],
      all_members: (mode === 'assign' || mode === 'event') && all,
      rotate: canRotate && rotate,
      target: mode === 'goal' ? targetNum : null,
      goal_until: mode === 'goal' && until ? until : null,
    };
    try {
      if (item) await api.updateItem(group.id, item.id, input);
      else await api.createItem(group.id, input);
      onSaved();
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    setBusy(true);
    await api.deleteItem(group.id, item.id).catch(() => {});
    onSaved();
  };

  const placeholder = mode === 'event' ? g.eventPh : mode === 'goal' ? g.goalPh : g.itemPh;

  return (
    <Sheet title={item ? item.title : g.newItem(group.title)} onClose={onClose}>
      <input className="sheet-input" autoFocus={!item} maxLength={120} placeholder={placeholder} aria-label={placeholder} value={title} onChange={(e) => setTitle(e.target.value)} />

      <h3 className="sheet-subtitle">{g.who}</h3>
      <div className="mode-tiles" role="radiogroup" aria-label={g.who}>
        {(['one', 'assign', 'goal', 'event'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {ICONS[m]}
            </svg>
            <b>{g.modes[m]}</b>
            <small>{g.modeHints[m]}</small>
          </button>
        ))}
      </div>

      {(mode === 'assign' || mode === 'event') && (
        <div className="people-chips">
          <button className={`chip all${all ? ' on' : ''}`} aria-pressed={all} onClick={() => setAll(!all)}>
            {g.all}
          </button>
          {group.members.map((m) => (
            <button key={m.id} className={`chip${all || people.has(m.id) ? ' on' : ''}`} aria-pressed={all || people.has(m.id)} onClick={() => toggle(m.id)}>
              <Avatar member={m} size={30} />
              {m.id === me ? g.me : m.name}
            </button>
          ))}
        </div>
      )}

      {mode === 'goal' ? (
        <div className="card flat">
          <label className="row field-row">
            <span className="label">{g.target}</span>
            <input inputMode="decimal" placeholder={g.targetPh} value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d\s.,]/g, ''))} />
          </label>
          <DateRow label={g.until} value={until} min={today} placeholder="—" onChange={setUntil} />
        </div>
      ) : (
        <div className="card flat">
          {canRotate && (
            <label className="row toggle-row">
              <span className="label">
                {g.rotate}
                <small>{rotate ? g.rotateHint(chosen.map((id) => (id === me ? g.me : group.members.find((m) => m.id === id)?.name ?? '')).join(' → ')) : g.eachHint}</small>
              </span>
              <input type="checkbox" className="switch" checked={rotate} onChange={(e) => setRotate(e.target.checked)} />
            </label>
          )}
          <SelectRow label={g.repeat} value={repeat} options={(Object.keys(g.repeats) as Repeat[]).map((r) => ({ value: r, label: g.repeats[r] }))} onChange={setRepeat} />
          {repeat === 'once' || repeat === 'weekly' ? <DateRow label={g.date} value={day} min={today} clearable={false} onChange={setDay} /> : null}
          <TimeRow label={g.time} value={time} onChange={setTime} allowOff offLabel={g.allDay} offAction={g.noTime} initial="19:00" />
        </div>
      )}

      {error && <p className="error">{t.error}</p>}
      <button className="act primary wide" disabled={busy || !valid} onClick={() => void save()}>
        {item ? g.save : g.add(group.title)}
      </button>
      {item && (
        <button className="quiet-link danger" disabled={busy} onClick={() => void remove()}>
          {g.remove}
        </button>
      )}
    </Sheet>
  );
}
