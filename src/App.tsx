import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { miniApp, useSignal } from '@tma.js/sdk-react';
import type { UserSettings } from '../shared/types';
import { api } from './api';
import { Splash } from './components/Logo';
import { LangContext, dictionaries, useT, type Lang } from './i18n';
import { Onboarding } from './screens/Onboarding';
import { Profile } from './screens/Profile';
import { TaskEditor } from './screens/TaskEditor';
import { Today } from './screens/Today';

export type Route = { name: 'today' } | { name: 'me' } | { name: 'task'; id: number | null };

type Boot = { state: 'loading' } | { state: 'error' } | { state: 'ready'; user: UserSettings; onboarding: boolean };

export function App(): ReactNode {
  const isDark = useSignal(miniApp.isDark);
  useEffect(() => {
    document.documentElement.dataset.colorScheme = isDark ? 'dark' : 'light';
  }, [isDark]);

  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [route, setRoute] = useState<Route>({ name: 'today' });

  const load = useCallback(async () => {
    setBoot({ state: 'loading' });
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { user } = await api.session(timezone);
      const tasks = await api.today();
      setBoot({ state: 'ready', user, onboarding: tasks.tasks.length === 0 });
    } catch {
      setBoot({ state: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Заставку Telegram убираем, когда на экране уже что-то своё (наш логотип).
    miniApp.ready.ifAvailable();
  }, []);

  const lang: Lang = boot.state === 'ready' && boot.user.language_code === 'en' ? 'en' : 'ru';

  if (boot.state === 'loading') return <Splash />;
  if (boot.state === 'error') {
    const t = dictionaries[navigator.language.startsWith('ru') ? 'ru' : 'en'];
    return (
      <main className="app-shell center">
        <p className="muted">{t.loadError}</p>
        <button className="btn primary" onClick={() => void load()}>
          {t.retry}
        </button>
      </main>
    );
  }

  const setUser = (user: UserSettings) => setBoot({ ...boot, user });

  return (
    <LangContext.Provider value={lang}>
      {boot.onboarding ? (
        <Onboarding onDone={() => setBoot({ ...boot, onboarding: false })} />
      ) : route.name === 'task' ? (
        <TaskEditor id={route.id} onClose={() => setRoute({ name: 'today' })} />
      ) : (
        <main className="app-shell with-tabs">
          {route.name === 'today' ? (
            <Today onEdit={(id) => setRoute({ name: 'task', id })} />
          ) : (
            <Profile user={boot.user} onUser={setUser} />
          )}
          <TabBar route={route} onRoute={setRoute} />
        </main>
      )}
    </LangContext.Provider>
  );
}

function TabBar({ route, onRoute }: { route: Route; onRoute: (r: Route) => void }): ReactNode {
  const t = useT();
  return (
    <nav className="tabbar">
      <button className={route.name === 'today' ? 'active' : ''} onClick={() => onRoute({ name: 'today' })}>
        <GridIcon />
        {t.today}
      </button>
      <button className={route.name === 'me' ? 'active' : ''} onClick={() => onRoute({ name: 'me' })}>
        <PersonIcon />
        {t.me}
      </button>
    </nav>
  );
}

const GridIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    {[3, 10, 17].flatMap((y) => [3, 10, 17].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1.4" />))}
  </svg>
);

const PersonIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="12" cy="8" r="4.2" />
    <path d="M4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5c0 .6-.4.9-1 .9H5c-.6 0-1-.3-1-.9Z" />
  </svg>
);
