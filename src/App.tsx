import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { mainButton, miniApp, useSignal } from '@tma.js/sdk-react';
import type { TaskKind, TodayResponse, UserSettings } from '../shared/types';
import { api } from './api';
import { caches, load as fetchInto, logicalDayOf, warm } from './caches';
import { RemovalHost } from './removal';
import { Splash } from './components/Logo';
import { LangContext, dictionaries, useT, type Lang } from './i18n';
import { Archive } from './screens/Archive';
import { Calendar } from './screens/Calendar';
import { Onboarding } from './screens/Onboarding';
import { Profile } from './screens/Profile';
import { TaskEditor } from './screens/TaskEditor';
import { TaskDetail } from './screens/TaskDetail';
import { Today } from './screens/Today';
import { bumpChange, currentChange, type Cache } from './useTaskLog';
import { taskScore } from './components/TaskCard';
import { MicIcon, VoiceSheet, type VoicePreview } from './components/VoiceSheet';
import { Group } from './screens/Group';
import { Groups } from './screens/Groups';
import { Join } from './screens/Join';
import { FriendLink, FriendScreen, Requests } from './screens/Friends';

type Route =
  | { name: 'today' }
  | { name: 'me' }
  // sheet — сразу открыть «Календари» (вернулись из входа Google по ссылке t.me/…?startapp=calendars).
  | { name: 'calendar'; sheet?: boolean }
  | { name: 'pick' }
  | { name: 'detail'; id: number }
  | { name: 'task'; id: number | null; kind?: TaskKind }
  | { name: 'archive' }
  // section — сразу «Друзья» (пришли со ссылки друга).
  | { name: 'groups'; section?: 'friends' }
  // Экран группы; back — вкладка, откуда пришли.
  | { name: 'group'; id: number; back: Tab }
  // Вступление по ссылке t.me/…?startapp=g_<код>.
  | { name: 'join'; code: string }
  // Друзья (во «Вместе»): экран друга и заявки; чужая ссылка «Позвать друга» — t.me/…?startapp=f_<код>.
  | { name: 'friend'; id: number }
  | { name: 'requests' }
  | { name: 'friendLink'; code: string }
  // Правка привычки из голосового разбора; back — вкладка, с которой открыли шторку.
  | { name: 'draft'; index: number; back: Tab };
type Tab = 'today' | 'calendar' | 'groups' | 'me';
type Boot = { state: 'loading' } | { state: 'error' } | { state: 'ready'; user: UserSettings; onboarding: boolean };
const EMPTY_CACHE: Cache = { today: { day: '', tasks: [], archived: [], limits: { max_tasks: null, active: 0 }, todos: [], todos_later: 0, groups: [] }, heat: [], loadedAt: 0 };

/** Фон приложения (стиль A) — им же красим шапку и низ Telegram. */
const BG = { light: '#F6F4EE', dark: '#0F1511' } as const;
/** Главная кнопка Telegram — в нашем зелёном, а не в синем цвете темы. */
const MAIN = { light: { bgColor: '#237A46', textColor: '#FFFFFF' }, dark: { bgColor: '#3FA968', textColor: '#0E1A12' } } as const;
export type Theme = 'light' | 'dark';
const THEME_KEY = 'lc-theme';
/** Тема хранится на устройстве; пока её не выбирали — как в Telegram. */
function savedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}
const guessLang = (): Lang => (navigator.language.startsWith('ru') ? 'ru' : 'en');

export function App(): ReactNode {
  const tgDark = useSignal(miniApp.isDark);
  const [theme, setThemeState] = useState<Theme | null>(savedTheme);
  const isDark = theme === null ? tgDark : theme === 'dark';
  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // хранилище недоступно — тема продержится до закрытия
    }
  };
  useEffect(() => {
    document.documentElement.dataset.colorScheme = isDark ? 'dark' : 'light';
    const bg = isDark ? BG.dark : BG.light;
    miniApp.setHeaderColor.ifAvailable(bg);
    miniApp.setBgColor.ifAvailable(bg);
    miniApp.setBottomBarColor.ifAvailable(bg);
    mainButton.setParams.ifAvailable(isDark ? MAIN.dark : MAIN.light);
  }, [isDark]);

  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [route, setRoute] = useState<Route>({ name: 'today' });
  const [cache, setCache] = useState<Cache>(EMPTY_CACHE);
  // Шторка голоса и её список — здесь, а не в шторке: пока привычку из списка правят в редакторе, шторки нет.
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voicePreview, setVoicePreview] = useState<VoicePreview | null>(null);
  // Голосом добавили в группу, на экране которой стоим, — экран пересоздаётся из свежего кэша (без мигания).
  const [groupRev, setGroupRev] = useState(0);

  const load = useCallback(async () => {
    setBoot({ state: 'loading' });
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Всё нужное первому экрану грузим, пока видна заставка: после неё ждать уже нечего.
      const { user, start_param } = await api.session(timezone);
      const seq = currentChange();
      // Куда ведёт ссылка запуска — её экран тоже грузим заранее, чтобы он открылся целиком.
      const joinParam = new URLSearchParams(window.location.search).get('join');
      const joinCode = start_param?.startsWith('g_') ? start_param.slice(2) : joinParam && /^[a-z0-9]{6,20}$/.test(joinParam) ? joinParam : null;
      const groupId = start_param?.startsWith('grp_') ? Number(start_param.slice(4)) : null;
      const friendCode = start_param?.startsWith('f_') ? start_param.slice(2) : null;
      const day = logicalDayOf(user.timezone, user.day_start_hour);
      const quiet = (p: Promise<unknown>) => p.catch(() => null);
      const [today, heat] = await Promise.all([
        api.today(),
        api.heatmap(371),
        // Вкладка «Календарь» и шторка календарей открываются сразу, уже с подключёнными календарями.
        quiet(fetchInto.accounts()),
        day ? quiet(fetchInto.range(day, day)) : null,
        joinCode ? quiet(fetchInto.invitation(joinCode)) : null,
        groupId ? quiet(fetchInto.group(groupId)) : null,
        // Друзья во «Вместе» открываются сразу, с заявками.
        quiet(fetchInto.friends()),
        // Шрифт — до показа: иначе текст сначала системным шрифтом, потом перескакивает (но не дольше 1,5 с).
        Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]),
      ]);
      // Повторная загрузка не должна затереть то, что успели отметить, пока она шла.
      if (seq === currentChange()) setCache({ today, heat: heat.days, loadedAt: Date.now() });
      warmAfter(today);
      // Календари телефона подтягиваем в фоне при каждом входе — не задерживая экран; что пришло — тихо дочитываем.
      void api.syncCalendars().then(
        async () => {
          warm(fetchInto.accounts());
          if (day) warm(fetchInto.range(day, day));
          const fresh = await api.today().catch(() => null);
          if (fresh && seq === currentChange()) setCache((c) => ({ ...c, today: fresh, loadedAt: Date.now() }));
        },
        () => {},
      );
      const empty = today.tasks.length === 0 && today.archived.length === 0 && today.todos.length === 0 && today.todos_later === 0 && today.groups.length === 0;
      setBoot({ state: 'ready', user, onboarding: empty && !onboardingSkipped() });
      // Из бота кнопкой web_app start_param нет — приглашение тогда в адресе (?join=<код>).
      if (start_param === 'calendars') setRoute({ name: 'calendar', sheet: true });
      else if (joinCode) setRoute({ name: 'join', code: joinCode });
      else if (groupId) setRoute({ name: 'group', id: groupId, back: 'groups' });
      else if (friendCode) setRoute({ name: 'friendLink', code: friendCode });
    } catch {
      setBoot({ state: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Заглушку Telegram убираем, когда на экране уже наша заставка.
    miniApp.ready.ifAvailable();
  }, []);

  if (boot.state === 'loading') return <Splash />;
  if (boot.state === 'error') {
    const t = dictionaries[guessLang()];
    return (
      <main className="app-shell center">
        <p className="muted">{t.loadError}</p>
        <button className="act primary" onClick={() => void load()}>
          {t.retry}
        </button>
      </main>
    );
  }

  const lang: Lang = boot.user.language_code === 'en' ? 'en' : 'ru';
  /** Перечитать «Сегодня» до возврата на экран — чтобы он открылся уже со свежими данными. */
  const refresh = async (deleted = false) => {
    // Привычки только что изменили — ответы, запрошенные раньше, уже устарели.
    bumpChange();
    // Удалённая привычка забирает с карты и прошлые дни — карту перечитываем в фоне, не задерживая экран.
    if (deleted) api.heatmap(371).then((h) => setCache((c) => ({ ...c, heat: h.days })), () => {});
    const today = await api.today().catch(() => null);
    if (today) {
      setCache((c) => ({ ...c, today, loadedAt: Date.now() }));
      warmAfter(today);
    }
  };
  const home = () => setRoute({ name: 'today' });

  const tab = (name: Tab): Route => ({ name });
  // Экран группы живёт внутри вкладки, откуда его открыли: нижняя панель и микрофон остаются (02.10.2026).
  const currentTab: Tab =
    route.name === 'group' ? route.back : route.name === 'friend' || route.name === 'requests' ? 'groups' : route.name === 'me' || route.name === 'calendar' || route.name === 'groups' ? route.name : 'today';
  const openGroup = (id: number) => setRoute({ name: 'group', id, back: currentTab });
  const closeVoice = () => {
    setVoiceOpen(false);
    setVoicePreview(null);
  };
  const limits = cache.today.limits;

  let screen: ReactNode;
  const detailTask = route.name === 'detail' ? cache.today.tasks.find((x) => x.id === route.id) : undefined;
  if (route.name === 'task') {
    const editedId = route.id;
    screen = (
      <TaskEditor
        task={editedId === null ? null : cache.today.tasks.find((x) => x.id === editedId)}
        day={cache.today.day}
        kind={route.kind}
        onSaved={async (deleted) => {
          await refresh(deleted);
          // Первая привычка сохранена — онбординг пройден; «Назад» без сохранения возвращает к нему.
          setBoot((b) => (b.state === 'ready' ? { ...b, onboarding: false } : b));
        }}
        // Существующую привычку открывают с её экрана — туда и возвращаемся
        // (если её отложили или удалили, экран привычки сам уйдёт на главную).
        onClose={editedId === null ? home : () => setRoute({ name: 'detail', id: editedId })}
        // «Назад» у новой привычки — к выбору намерения (на первом запуске это и есть главный экран).
        onBack={editedId !== null ? () => setRoute({ name: 'detail', id: editedId }) : boot.onboarding ? home : () => setRoute({ name: 'pick' })}
      />
    );
  } else if (route.name === 'draft' && voicePreview?.habits[route.index]) {
    const { index, back } = route;
    screen = (
      <TaskEditor
        key={`draft-${index}`}
        task={null}
        day={cache.today.day}
        draft={voicePreview.habits[index]}
        onDraft={(input) => {
          setVoicePreview((p) => p && { ...p, habits: p.habits.map((h, i) => (i === index ? input : h)) });
          setRoute(tab(back));
        }}
        onSaved={async () => {}}
        onClose={() => setRoute(tab(back))}
        onBack={() => setRoute(tab(back))}
      />
    );
  } else if (route.name === 'join') {
    screen = <Join code={route.code} onJoined={(id) => {
      void refresh();
      setBoot((b) => (b.state === 'ready' ? { ...b, onboarding: false } : b));
      setRoute({ name: 'group', id, back: 'groups' });
    }} onClose={home} />;
  } else if (route.name === 'friendLink') {
    screen = <FriendLink code={route.code} onClose={home} onFriends={() => setRoute({ name: 'groups', section: 'friends' })} />;
  } else if (boot.onboarding) {
    screen = (
      <Onboarding
        onPick={(kind) => setRoute({ name: 'task', id: null, kind })}
        onSkip={() => {
          rememberSkip();
          setBoot((b) => (b.state === 'ready' ? { ...b, onboarding: false } : b));
          setRoute({ name: 'today' });
        }}
      />
    );
  } else if (route.name === 'pick') {
    screen = <Onboarding onPick={(kind) => setRoute({ name: 'task', id: null, kind })} onBack={home} />;
  } else if (route.name === 'detail' && detailTask) {
    screen = <TaskDetail task={detailTask} today={cache.today.day} setCache={setCache} onEdit={() => setRoute({ name: 'task', id: detailTask.id })} onClose={home} />;
  } else if (route.name === 'archive') {
    screen = <Archive archived={cache.today.archived} onChanged={refresh} onClose={home} />;
  } else {
    screen = (
      <main className="app-shell with-tabs">
        {route.name === 'group' ? (
          <Group key={`${route.id}:${groupRev}`} id={route.id} me={boot.user.id} today={cache.today.day} onBack={() => setRoute(tab(currentTab))} onChanged={() => void refresh()} />
        ) : route.name === 'friend' ? (
          <FriendScreen key={route.id} id={route.id} onBack={() => setRoute(tab('groups'))} />
        ) : route.name === 'requests' ? (
          <Requests onBack={() => setRoute(tab('groups'))} />
        ) : currentTab === 'me' ? (
          <Profile theme={isDark ? 'dark' : 'light'} onTheme={setTheme} user={boot.user} onUser={(user) => setBoot({ ...boot, user })} heat={{ today: cache.today.day, days: heatWithToday(cache) }} />
        ) : currentTab === 'groups' ? (
          <Groups
            me={boot.user.id}
            initial={cache.today.groups}
            onOpen={openGroup}
            habits={cache.today.tasks}
            onOpenFriend={(id) => setRoute({ name: 'friend', id })}
            onRequests={() => setRoute({ name: 'requests' })}
            onShown={() => void refresh()}
            section={route.name === 'groups' ? route.section : undefined}
          />
        ) : currentTab === 'calendar' ? (
          <Calendar today={cache.today.day} openSheet={route.name === 'calendar' && route.sheet} onChanged={() => void refresh()} me={boot.user.id} onOpenGroup={openGroup} />
        ) : (
          <Today cache={cache} setCache={setCache} me={boot.user.id} onOpenGroup={openGroup} onEdit={(id) => setRoute(id === null ? { name: 'pick' } : { name: 'detail', id })} onArchive={() => setRoute({ name: 'archive' })} onDeleted={() => refresh(true)} />
        )}
        <TabBar route={currentTab} onRoute={(name) => setRoute(tab(name))} onMic={() => setVoiceOpen(true)} />
        {voiceOpen && (
          <VoiceSheet
            preview={voicePreview}
            setPreview={setVoicePreview}
            room={limits.max_tasks === null ? null : Math.max(0, limits.max_tasks - limits.active)}
            onEdit={(index) => setRoute({ name: 'draft', index, back: currentTab })}
            today={cache.today.day}
            groupId={route.name === 'group' ? route.id : null}
            // Список с вкладки «Вместе» свежее: новую группу он знает сразу, «Сегодня» — после перечитывания.
            groups={caches.groupList ?? cache.today.groups}
            onAdd={async (todos, habits, groupItems) => {
              await Promise.all([
                todos.length ? api.createTodos(todos) : null,
                habits.length ? api.createTasks(habits) : null,
                ...groupItems.map((a) => api.createItem(a.group.id, a.item)),
              ]);
              await refresh();
              closeVoice();
              // Всё ушло в одну группу — туда и ведём (там это и видно); иначе — на «Сегодня».
              const only = new Set(groupItems.map((a) => a.group.id));
              if (!todos.length && !habits.length && only.size === 1) {
                const id = [...only][0]!;
                await fetchInto.group(id).catch(() => null);
                setGroupRev((n) => n + 1);
                setRoute({ name: 'group', id, back: currentTab });
              } else setRoute({ name: 'today' });
            }}
            onManual={() => {
              closeVoice();
              setRoute({ name: 'pick' });
            }}
            onClose={closeVoice}
          />
        )}
      </main>
    );
  }

  return (
    <LangContext.Provider value={lang}>
      {screen}
      {/* «Удалено · Вернуть» и вопрос про общее дело — поверх любого экрана. */}
      <RemovalHost />
    </LangContext.Provider>
  );
}

/**
 * После запуска и после каждого обновления «Сегодня» — в фоне подтягиваем то, что откроют следующим:
 * экраны групп, историю привычек, «Потом». Список групп берём прямо из «Сегодня» — он свежее старого.
 */
function warmAfter(today: TodayResponse) {
  caches.groupList = today.groups;
  for (const g of today.groups) warm(fetchInto.group(g.id));
  for (const task of today.tasks.slice(0, 30)) if (!caches.history.has(task.id)) warm(fetchInto.history(task.id));
  if (today.todos_later > 0) warm(fetchInto.later());
  else caches.later = [];
}

/** «Пропустить» на первом экране — запоминаем на этом устройстве, чтобы не спрашивать при каждом входе. */
const SKIP_KEY = 'lc-onboarding-skipped';
function onboardingSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberSkip() {
  try {
    localStorage.setItem(SKIP_KEY, '1');
  } catch {
    // не запомнили — спросим в следующий раз, это не страшно
  }
}

/** Карта с сегодняшним днём, посчитанным из отметок на экране (без ожидания сервера). */
function heatWithToday(cache: Cache) {
  const day = cache.today.day;
  // Сделанное дело на день зеленит клетку так же, как привычка; события из календаря — нет.
  const score = cache.today.tasks.reduce((sum, x) => sum + taskScore(x), 0) + cache.today.todos.filter((d) => d.done && !d.source).length;
  return [...cache.heat.filter((d) => d.day !== day), { day, score }];
}

const TABS: { name: Tab; icon: ReactNode }[] = [
  {
    name: 'today',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        {[3, 10, 17].flatMap((y) => [3, 10, 17].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1.4" />))}
      </svg>
    ),
  },
  {
    name: 'calendar',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    name: 'groups',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 19.5c.6-3 3.2-4.8 6.5-4.8s5.9 1.8 6.5 4.8M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.9c2.3.5 3.8 2.1 4.2 4.6" />
      </svg>
    ),
  },
  {
    name: 'me',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5" />
      </svg>
    ),
  },
];

/** Нижняя панель: Сегодня · Календарь · микрофон · Вместе · Я. */
function TabBar({ route, onRoute, onMic }: { route: Tab; onRoute: (r: Tab) => void; onMic: () => void }): ReactNode {
  const t = useT();
  const tabButton = ({ name, icon }: (typeof TABS)[number]) => (
    <button key={name} className={route === name ? 'active' : ''} aria-current={route === name ? 'page' : undefined} onClick={() => onRoute(name)}>
      <span className="pill">{icon}</span>
      {t[name]}
    </button>
  );
  return (
    <nav className="tabbar">
      {TABS.slice(0, 2).map(tabButton)}
      {/* Голос — главное действие приложения: крупная кнопка, чуть выступает над панелью. */}
      <button className="tab-mic" aria-label={t.voice.mic} onClick={onMic}>
        <MicIcon size={28} />
      </button>
      {TABS.slice(2).map(tabButton)}
    </nav>
  );
}
