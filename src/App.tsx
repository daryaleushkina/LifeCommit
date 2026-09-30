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
import { Today, type Cache } from './screens/Today';
import { taskScore } from './components/TaskCard';

type Route = { name: 'today' } | { name: 'me' } | { name: 'task'; id: number | null; kind?: TaskKind } | { name: 'archive' };
type Boot = { state: 'loading' } | { state: 'error' } | { state: 'ready'; user: UserSettings; onboarding: boolean };
const EMPTY_CACHE: Cache = { today: { day: '', tasks: [], archived: [], limits: { max_tasks: null, active: 0 } }, heat: [] };

/** Фон приложения (стиль A) — им же красим шапку и низ Telegram. */
const BG = { light: '#F6F4EE', dark: '#121613' } as const;
/** Главная кнопка Telegram — в нашем зелёном, а не в синем цвете темы. */
const MAIN = { light: { bgColor: '#237A46', textColor: '#FFFFFF' }, dark: { bgColor: '#3FA968', textColor: '#0E1A12' } } as const;
const guessLang = (): Lang => (navigator.language.startsWith('ru') ? 'ru' : 'en');

export function App(): ReactNode {
  const isDark = useSignal(miniApp.isDark);
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
      const [today, heat] = await Promise.all([api.today(), api.heatmap(371)]);
      setCache({ today, heat: heat.days });
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

  if (boot.state === 'loading') return <Splash lang={guessLang()} />;
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
    const today = await api.today().catch(() => null);
    if (today) setCache((c) => ({ ...c, today }));
  };
  const home = () => setRoute({ name: 'today' });

  let screen: ReactNode;
  if (route.name === 'task') {
    screen = (
      <TaskEditor
        id={route.id}
        kind={route.kind}
        onSaved={async () => {
          await refresh();
          // Первое дело сохранено — онбординг пройден; «Назад» без сохранения возвращает к нему.
          setBoot((b) => (b.state === 'ready' ? { ...b, onboarding: false } : b));
        }}
        onClose={home}
      />
    );
  } else if (boot.onboarding) {
    screen = <Onboarding onPick={(kind) => setRoute({ name: 'task', id: null, kind })} />;
  } else if (route.name === 'archive') {
    screen = <Archive onChanged={refresh} onClose={home} />;
  } else {
    screen = (
      <main className="app-shell with-tabs">
        {route.name === 'today' ? (
          <Today cache={cache} setCache={setCache} onEdit={(id) => setRoute({ name: 'task', id })} onProfile={() => setRoute({ name: 'me' })} onArchive={() => setRoute({ name: 'archive' })} />
        ) : (
          <Profile user={boot.user} onUser={(user) => setBoot({ ...boot, user })} heat={{ today: cache.today.day, days: heatWithToday(cache) }} />
        )}
        <TabBar route={route.name} onRoute={(name) => setRoute(name === 'me' ? { name: 'me' } : { name: 'today' })} />
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
