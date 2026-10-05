import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  backButton,
  closingBehavior,
  init,
  initData,
  mainButton,
  miniApp,
  secondaryButton,
  swipeBehavior,
  themeParams,
  viewport,
} from '@tma.js/sdk-react';
import { App } from './App';
import { installDesktopHost } from './desktop/host';
import { DesktopLogin } from './desktop/Login';
import { desktopToken, isDesktop } from './desktop/session';
import { LangContext, dictionaries } from './i18n';
// Шрифт — со своего сервера, а не с Google (02.10.2026): из России Google-домены бывают медленными, а снимки
// экрана в тестах не должны зависеть от сети.
import '@fontsource-variable/onest';
import './styles/telegram.css';
import './styles/app.css';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('Нет #root в index.html');
  const root = createRoot(container);

  // На компьютере (приложение для Mac, браузер с ?desktop) Telegram'а нет — его роль играет мост src/desktop/host.ts.
  const desktop = isDesktop();
  if (desktop) installDesktopHost();
  else if (import.meta.env.DEV) {
    const { mockTelegramEnvForDev } = await import('./telegram/mockEnv');
    await mockTelegramEnvForDev();
  }

  try {
    init();
  } catch {
    root.render(<OpenInTelegram />);
    return;
  }

  themeParams.mount();
  miniApp.mount();
  themeParams.bindCssVars();
  miniApp.bindCssVars();
  initData.restore();

  backButton.mount.ifAvailable();
  mainButton.mount.ifAvailable();
  secondaryButton.mount.ifAvailable();
  swipeBehavior.mount.ifAvailable();
  closingBehavior.mount.ifAvailable();

  if (viewport.mount.isAvailable()) {
    try {
      await viewport.mount({ timeout: 3000 });
      viewport.bindCssVars();
      viewport.expand.ifAvailable();
    } catch (e) {
      console.warn('viewport.mount не удался', e);
    }
  }

  root.render(<StrictMode>{desktop ? <DesktopGate /> : <App />}</StrictMode>);
}

/** На компьютере без ключа — экран входа; вошли — приложение целиком, как в Telegram. */
function DesktopGate(): ReactNode {
  const [signedIn, setSignedIn] = useState(() => desktopToken() !== null);
  if (signedIn) return <App />;
  // Тема и язык до входа — системные (выбранную в профиле тему App поставит сам).
  document.documentElement.dataset.colorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return (
    <LangContext.Provider value={navigator.language.startsWith('ru') ? 'ru' : 'en'}>
      <DesktopLogin onDone={() => setSignedIn(true)} />
    </LangContext.Provider>
  );
}

function OpenInTelegram(): ReactNode {
  const t = navigator.language.startsWith('ru') ? dictionaries.ru : dictionaries.en;
  return (
    <main className="app-shell center">
      <p>{t.openInTelegram}</p>
      <a className="act primary" style={{ textDecoration: 'none' }} href="https://t.me/LifeCommit_bot">
        @LifeCommit_bot
      </a>
    </main>
  );
}

void bootstrap();
