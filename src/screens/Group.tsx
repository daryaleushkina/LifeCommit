// Экран группы (дизайн 16E/16F): дела на сегодня с отметками, люди, приглашение, вклад в общую цель.
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { hapticFeedback, openTelegramLink, popup } from '@tma.js/sdk-react';
import type { GroupDayItem } from '../../shared/groups';
import { api, ApiError, type GroupDetail } from '../api';
import { caches, load as fetchInto, trackEdit } from '../caches';
import { GroupItemSheet } from '../components/GroupItemSheet';
import { Avatar, AvatarStack, GroupBadge, GroupItemRow } from '../components/groupUi';
import { Sheet } from '../components/Picker';
import { LangContext, useT } from '../i18n';
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
  const locale = useContext(LangContext) === 'ru' ? 'ru-RU' : 'en-US';
  // Экран группы подтянут заранее (при запуске и после каждого обновления) — открывается сразу, свежее подтягивается тихо.
  const [group, setGroupState] = useState<GroupDetail | null>(caches.groups.get(id) ?? null);
  // Что показали — запоминаем: вернулись на экран — он открывается сразу.
  const setGroup = useCallback((next: GroupDetail | null | ((cur: GroupDetail | null) => GroupDetail | null)) => {
    setGroupState((cur) => {
      const v = typeof next === 'function' ? next(cur) : next;
      if (v) caches.groups.set(id, v);
      return v;
    });
  }, [id]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'items' | 'people'>('items');
  const [editing, setEditing] = useState<GroupDayItem | 'new' | null>(null);
  const [putting, setPutting] = useState<GroupDayItem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 3500);
    return () => window.clearTimeout(id);
  }, [note]);

  useBackButton(onBack);
  const load = useCallback(
    () =>
      fetchInto.group(id).then(setGroup, (e) => {
        // «Не найдено» — только когда группы правда нет (404) или показать нечего; моргнула сеть — экран остаётся как был.
        if ((e instanceof ApiError && e.status === 404) || !caches.groups.has(id)) setMissing(true);
      }),
    [id, setGroup],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // Правка на экране (отметка, имя, «только админы»): перечитки, начатые раньше или во время неё, её не затрут.
  const edit = <T,>(run: () => Promise<T>): Promise<T> => trackEdit(run());
  // Чат ещё жив? Проверяем в фоне раз за открытие: удалённый в Telegram чат пропадает из настроек сразу.
  const chatChecked = useRef(false);
  useEffect(() => {
    if (chatChecked.current || !group?.settings.tg_chat_title) return;
    chatChecked.current = true;
    api.checkGroupChat(id).then(
      ({ tg_chat_title }) => setGroup((cur) => cur && { ...cur, settings: { ...cur.settings, tg_chat_title } }),
      () => {},
    );
  }, [id, group?.settings.tg_chat_title, setGroup]);

  if (missing) {
    return (
      <p className="empty">{g.join.notFound}</p>
    );
  }
  if (!group) return null;

  // Ждём перечитку: после удаления свайпом строка не должна мелькнуть обратно.
  const changed = async () => {
    onChanged();
    await load();
  };

  const toggle = async (it: GroupDayItem) => {
    const done = !it.done;
    // Сразу на экране; если не вышло — вернём как было.
    setGroup((cur) => cur && { ...cur, items: cur.items.map((x) => (x.id === it.id ? { ...x, done, done_by: done ? [...x.done_by, me] : x.done_by.filter((u) => u !== me) } : x)) });
    if (done) hapticFeedback.notificationOccurred.ifAvailable('success');
    try {
      const res = await edit(() => api.markItem(group.id, it.id, done));
      if (res.taken) setNote(g.taken);
    } catch (e) {
      setNote(e instanceof ApiError && e.code === 'not_yours' ? g.notYours : t.error);
    }
    void changed();
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

  // «Отключить» чат: бот прощается и выходит; на экране — сразу «Подключить чат Telegram».
  const disconnectChat = async () => {
    const title = group.settings.tg_chat_title ?? '';
    if (popup.show.isAvailable()) {
      const answer = await popup.show({ message: g.chatOffConfirm(title), buttons: [{ id: 'ok', type: 'destructive', text: g.chatOff }, { type: 'cancel' }] });
      if (answer !== 'ok') return;
    }
    setGroup((cur) => cur && { ...cur, settings: { ...cur.settings, tg_chat_title: null } });
    await api.disconnectGroupChat(group.id).catch(() => void load());
  };

  const leave = async (remove: boolean) => {
    if (popup.show.isAvailable()) {
      const answer = await popup.show({ message: remove ? g.removeConfirm : g.leaveConfirm, buttons: [{ id: 'ok', type: 'destructive', text: remove ? g.remove_group : g.leave }, { type: 'cancel' }] });
      if (answer !== 'ok') return;
    }
    try {
      await (remove ? api.deleteGroup(group.id) : api.leaveGroup(group.id));
    } catch {
      // Сервер не выпустил — остаёмся на экране группы, подсказка поверх (шторку настроек закрываем, чтобы её было видно).
      setSettingsOpen(false);
      setNote(t.error);
      return;
    }
    caches.groups.delete(group.id);
    caches.groupList = caches.groupList?.filter((x) => x.id !== group.id) ?? null;
    onChanged();
    onBack();
  };

  const goals = group.items.filter((it) => it.mode === 'goal');
  const items = group.items.filter((it) => it.mode !== 'goal').sort((a, b) => order(a) - order(b) || (a.time ?? '').localeCompare(b.time ?? ''));
  // «Скоро» — разовые дела и мероприятия; повторяющиеся и так видны каждый день.
  const soon = group.upcoming.map((b) => ({ ...b, items: b.items.filter((it) => !it.recurring || it.mode === 'event') })).filter((b) => b.items.length > 0);
  const doneToday = (uid: number) => group.items.filter((it) => it.done_by.includes(uid)).map((it) => it.title);

  return (
    <div className="group-screen">
      {/* Подсказка после действия — поверх, над нижней панелью: список под ней не съезжает. */}
      {note && (
        <p className="toast" role="status" onClick={() => setNote(null)}>
          {note}
        </p>
      )}
      <header className="group-header">
        <GroupBadge id={group.id} title={group.title} size={60} />
        <span className="group-header-text">
          <h1>{group.title}</h1>
          <span className="group-sub">
            <AvatarStack members={group.members} size={20} />
            {g.people(group.members.length)}
            {group.planned > 0 && ` · ${g.progress(group.done, group.planned)}`}
          </span>
        </span>
        <button className="icon-btn" aria-label={g.settings} onClick={() => setSettingsOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </header>

      <div className="segmented two" role="radiogroup">
        {(['items', 'people'] as const).map((k) => (
          <button key={k} role="radio" aria-checked={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {g.tabs[k]}
          </button>
        ))}
      </div>


      {tab === 'items' ? (
        <>
          {goals.length > 0 && (
            <ul className="card todo-list">
              {goals.map((it) => (
                <GroupItemRow key={it.id} item={it} members={group.members} me={me} onOpen={() => setEditing(it)} onPut={() => setPutting(it)} swipe={{ groupId: group.id, day: today, after: changed }} />
              ))}
            </ul>
          )}
          <h2 className="section-label">{g.todayLabel}</h2>
          <ul className="card todo-list">
            {items.length === 0 && <li className="todo-empty">{g.nothingToday}</li>}
            {items.map((it) => (
              <GroupItemRow key={it.id} item={it} members={group.members} me={me} onToggle={() => void toggle(it)} onOpen={() => setEditing(it)} swipe={{ groupId: group.id, day: today, after: changed }} />
            ))}
          </ul>
          {soon.length > 0 && (
            <>
              <h2 className="section-label">{g.soon}</h2>
              {soon.map((b) => (
                <section key={b.day} className="later-day">
                  <h3>{new Date(`${b.day}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                  <ul className="card todo-list flat">
                    {b.items.map((it) => (
                      <GroupItemRow key={it.id} item={{ ...it, can_mark: false }} members={group.members} me={me} onOpen={() => setEditing(it)} swipe={{ groupId: group.id, day: b.day, after: changed }} />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
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
        </>
      )}

      {settingsOpen && (
        <GroupSettingsSheet
          group={group}
          onClose={() => setSettingsOpen(false)}
          onRenamed={(title) => {
            setGroup((cur) => cur && { ...cur, title });
            onChanged();
          }}
          onAdminsOnly={(on) => setGroup((cur) => cur && { ...cur, settings: { ...cur.settings, admins_only_edit: on } })}
          onFailed={() => setNote(t.error)}
          edit={edit}
          onConnectChat={() => void connectChat()}
          onDisconnectChat={() => void disconnectChat()}
          onLeave={() => void leave(false)}
          onDelete={() => void leave(true)}
        />
      )}
      {editing && (
        <GroupItemSheet
          group={group}
          me={me}
          today={today}
          item={editing === 'new' ? undefined : editing}
          onSaved={() => {
            setEditing(null);
            void changed();
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
            void changed();
          }}
        />
      )}
    </div>
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
        onClick={() => {
          setBusy(true);
          void onPut(n);
        }}
      >
        {g.put}
      </button>
    </Sheet>
  );
}

/** Настройки группы: название, «только админы заводят дела», чат Telegram, выйти, удалить. */
function GroupSettingsSheet({
  group,
  onClose,
  onRenamed,
  onAdminsOnly,
  onConnectChat,
  onDisconnectChat,
  onLeave,
  onDelete,
  onFailed,
  edit,
}: {
  group: GroupDetail;
  onClose: () => void;
  onRenamed: (title: string) => void;
  onAdminsOnly: (on: boolean) => void;
  /** Сервер не сохранил настройку — подсказка на экране группы (видна, когда шторка закрыта). */
  onFailed: () => void;
  /** Запрос правки к серверу: см. edit в Group — начатые раньше перечитки её не затрут. */
  edit: <T>(run: () => Promise<T>) => Promise<T>;
  onConnectChat: () => void;
  onDisconnectChat: () => void;
  onLeave: () => void;
  onDelete: () => void;
}): ReactNode {
  const t = useT();
  const g = t.gr;
  const canManage = group.role !== 'member';
  const [title, setTitle] = useState(group.title);
  // Сервер не сохранил имя или «только админы» — вернуть как было и сказать: в шторке, а если она уже закрыта — на экране группы.
  const [error, setError] = useState(false);
  const failed = () => {
    setError(true);
    onFailed();
  };
  const save = async () => {
    const next = title.trim();
    if (!next || next === group.title) return;
    setError(false);
    try {
      await edit(() => api.updateGroup(group.id, { title: next }));
    } catch {
      setTitle(group.title);
      failed();
      return;
    }
    onRenamed(next);
  };
  const setAdminsOnly = async (on: boolean) => {
    setError(false);
    onAdminsOnly(on);
    try {
      await edit(() => api.updateGroup(group.id, { admins_only_edit: on }));
    } catch {
      onAdminsOnly(!on);
      failed();
    }
  };
  return (
    <Sheet title={g.settings} onClose={() => { void save(); onClose(); }}>
      {canManage ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <input className="sheet-input" maxLength={60} enterKeyHint="done" aria-label={g.name} placeholder={g.namePh} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void save()} />
        </form>
      ) : (
        <p className="sheet-note first">{group.title}</p>
      )}
      {error && <p className="error">{t.error}</p>}
      {canManage && (
        <div className="card flat">
          <label className="row toggle-row">
            <span className="label">{g.adminsOnly}</span>
            <input
              type="checkbox"
              className="switch"
              checked={group.settings.admins_only_edit}
              onChange={(e) => void setAdminsOnly(e.target.checked)}
            />
          </label>
        </div>
      )}
      {/* Чат Telegram (решения 02.10.2026): подключённый — строкой с названием, админам — «Другой чат · Отключить»;
          без чата админам — кнопка «Подключить», остальным — ничего (подключают только админы). */}
      {group.settings.tg_chat_title ? (
        <div className="card flat chat-row">
          <span className="chat-icon" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 4L3 11l6 2.5M21 4l-3 16-9-6.5M21 4L9 13.5V19l3-3.5" />
            </svg>
          </span>
          <div className="chat-text">
            <small>{g.chatLabel}</small>
            <b>{group.settings.tg_chat_title}</b>
            {canManage && (
              <span className="chat-actions">
                <button onClick={onConnectChat}>{g.chatOther}</button>
                <span aria-hidden>·</span>
                <button className="danger" onClick={onDisconnectChat}>
                  {g.chatOff}
                </button>
              </span>
            )}
          </div>
        </div>
      ) : (
        canManage && (
          <>
            <button className="act wide chat-connect" onClick={onConnectChat}>
              {g.connectChat}
            </button>
            <p className="sheet-note center">{g.connectChatHint}</p>
          </>
        )
      )}
      <button className="quiet-link danger" onClick={onLeave}>
        {g.leave}
      </button>
      {group.role === 'owner' && (
        <button className="quiet-link danger" onClick={onDelete}>
          {g.remove_group}
        </button>
      )}
    </Sheet>
  );
}
