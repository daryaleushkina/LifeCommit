import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { mainButton, miniApp, useSignal } from '@tma.js/sdk-react';
import type { TaskKind, UserSettings } from '../shared/types';
import { api } from './api';
import { Splash } from './components/Logo';
import { LangContext, dictionaries, useT, type Lang } from './i18n';
import { Archive } from './screens/Archive';
import { Onboarding } from './screens/Onboarding';
import { Profile } from './screens/Profile';
import { TaskEditor } from './screens/TaskEditor';
import { TaskDetail } from './screens/TaskDetail';
import { Today } from './screens/Today';
import { bumpChange, currentChange, type Cache } from './useTaskLog';
import { taskScore } from './components/TaskCard';

type Route =
  | { name: 'today' }
  | { name: 'me' }
  | { name: 'pick' }
  | { name: 'detail'; id: number }
  | { name: 'task'; id: number | null; kind?: TaskKind }
  | { name: 'archive' };
type Boot = { state: 'loading' } | { state: 'error' } | { state: 'ready'; user: UserSettings; onboarding: boolean };
const EMPTY_CACHE: Cache = { today: { day: '', tasks: [], archived: [], limits: { max_tasks: null, active: 0 } }, heat: [] };

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

  const load = useCallback(async () => {
    setBoot({ state: 'loading' });
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Всё нужное первому экрану грузим, пока видна заставка: после неё ждать уже нечего.
      const { user } = await api.session(timezone);
      const seq = currentChange();
      const [today, heat] = await Promise.all([api.today(), api.heatmap(371)]);
      // Повторная загрузка не должна затереть то, что успели отметить, пока она шла.
      if (seq === currentChange()) setCache({ today, heat: heat.days });
      setBoot({ state: 'ready', user, onboarding: today.tasks.length === 0 && today.archived.length === 0 });
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
  const refresh = async () => {
    // Привычки только что изменили — ответы, запрошенные раньше, уже устарели.
    bumpChange();
    const today = await api.today().catch(() => null);
    if (today) setCache((c) => ({ ...c, today }));
  };
  const home = () => setRoute({ name: 'today' });

  let screen: ReactNode;
  const detailTask = route.name === 'detail' ? cache.today.tasks.find((x) => x.id === route.id) : undefined;
  if (route.name === 'task') {
    const editedId = route.id;
    screen = (
      <TaskEditor
        id={route.id}
        kind={route.kind}
        onSaved={async () => {
          await refresh();
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
  } else if (boot.onboarding) {
    screen = <Onboarding onPick={(kind) => setRoute({ name: 'task', id: null, kind })} />;
  } else if (route.name === 'pick') {
    screen = <Onboarding onPick={(kind) => setRoute({ name: 'task', id: null, kind })} onBack={home} />;
  } else if (route.name === 'detail' && detailTask) {
    screen = <TaskDetail task={detailTask} today={cache.today.day} setCache={setCache} onEdit={() => setRoute({ name: 'task', id: detailTask.id })} onClose={home} />;
  } else if (route.name === 'archive') {
    screen = <Archive onChanged={refresh} onClose={home} />;
  } else {
    screen = (
      <main className="app-shell with-tabs">
        {route.name !== 'me' ? (
          <Today cache={cache} setCache={setCache} onEdit={(id) => setRoute(id === null ? { name: 'pick' } : { name: 'detail', id })} onProfile={() => setRoute({ name: 'me' })} onArchive={() => setRoute({ name: 'archive' })} />
        ) : (
          <Profile theme={isDark ? 'dark' : 'light'} onTheme={setTheme} user={boot.user} onUser={(user) => setBoot({ ...boot, user })} heat={{ today: cache.today.day, days: heatWithToday(cache) }} />
        )}
        <TabBar route={route.name === 'me' ? 'me' : 'today'} onRoute={(name) => setRoute(name === 'me' ? { name: 'me' } : { name: 'today' })} />
      </main>
    );
  }

  return <LangContext.Provider value={lang}>{screen}</LangContext.Provider>;
}

/** Карта с сегодняшним днём, посчитанным из отметок на экране (без ожидания сервера). */
function heatWithToday(cache: Cache) {
  const day = cache.today.day;
  const score = cache.today.tasks.reduce((sum, x) => sum + taskScore(x), 0);
  return [...cache.heat.filter((d) => d.day !== day), { day, score }];
}

function TabBar({ route, onRoute }: { route: 'today' | 'me'; onRoute: (r: 'today' | 'me') => void }): ReactNode {
  const t = useT();
  return (
    <nav className="tabbar">
      <button className={route === 'today' ? 'active' : ''} aria-current={route === 'today' ? 'page' : undefined} onClick={() => onRoute('today')}>
        <span className="pill">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            {[3, 10, 17].flatMap((y) => [3, 10, 17].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1.4" />))}
          </svg>
        </span>
        {t.today}
      </button>
      <button className={route === 'me' ? 'active' : ''} aria-current={route === 'me' ? 'page' : undefined} onClick={() => onRoute('me')}>
        <span className="pill">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5" />
          </svg>
        </span>
        {t.me}
      </button>
    </nav>
  );
}
