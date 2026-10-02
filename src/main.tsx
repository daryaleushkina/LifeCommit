import { StrictMode, type ReactNode } from 'react';
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
import { dictionaries } from './i18n';
// Шрифт — со своего сервера, а не с Google (02.10.2026): из России Google-домены бывают медленными, а снимки
// экрана в тестах не должны зависеть от сети.
import '@fontsource-variable/onest';
import './styles/telegram.css';
import './styles/app.css';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('Нет #root в index.html');
  const root = createRoot(container);

  if (import.meta.env.DEV) {
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

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
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
