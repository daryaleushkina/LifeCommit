import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { mainButton, miniApp, useSignal } from '@tma.js/sdk-react';
import type { UserSettings } from '../shared/types';
import { api } from './api';
import { Splash } from './components/Logo';
import { LangContext, dictionaries, useT, type Lang } from './i18n';
import { Archive } from './screens/Archive';
import { Onboarding } from './screens/Onboarding';
import { Profile } from './screens/Profile';
import { TaskEditor } from './screens/TaskEditor';
import { Today } from './screens/Today';

type Route = { name: 'today' } | { name: 'me' } | { name: 'task'; id: number | null } | { name: 'archive' };
type Boot = { state: 'loading' } | { state: 'error' } | { state: 'ready'; user: UserSettings; onboarding: boolean };

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

  const load = useCallback(async () => {
    setBoot({ state: 'loading' });
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Заставка успевает «напечатать» команду, даже если сеть быстрая.
      const [{ user }] = await Promise.all([api.session(timezone), new Promise((r) => setTimeout(r, 1200))]);
      const today = await api.today();
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
  const home = () => setRoute({ name: 'today' });

  let screen: ReactNode;
  if (route.name === 'task') {
    screen = (
      <TaskEditor
        id={route.id}
        onClose={() => {
          setBoot({ ...boot, onboarding: false });
          home();
        }}
      />
    );
  } else if (boot.onboarding) {
    screen = <Onboarding onDone={() => setBoot({ ...boot, onboarding: false })} onCustom={() => setRoute({ name: 'task', id: null })} />;
  } else if (route.name === 'archive') {
    screen = <Archive onClose={home} />;
  } else {
    screen = (
      <main className="app-shell with-tabs">
        {route.name === 'today' ? (
          <Today onEdit={(id) => setRoute({ name: 'task', id })} onProfile={() => setRoute({ name: 'me' })} onArchive={() => setRoute({ name: 'archive' })} />
        ) : (
          <Profile user={boot.user} onUser={(user) => setBoot({ ...boot, user })} />
        )}
        <TabBar route={route.name} onRoute={(name) => setRoute(name === 'me' ? { name: 'me' } : { name: 'today' })} />
      </main>
    );
  }

  return <LangContext.Provider value={lang}>{screen}</LangContext.Provider>;
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
