/**
 * Точка входа мини-аппа: порядок инициализации @tma.js/sdk-react 3.x.
 * Копируется в src/main.tsx и дописывается под проект. Сверено с
 * @tma.js/sdk 3.3.0 / @tma.js/sdk-react 3.0.23 (типы и исходник пакета).
 */
import { StrictMode, useEffect, type ReactNode } from 'react';
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
  useSignal,
  viewport,
} from '@tma.js/sdk-react';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('Нет #root в index.html');
  const root = createRoot(container);

  // Подмена окружения — только в dev и только динамическим импортом:
  // ветка вырезается из сборки вместе с подменной темой.
  if (import.meta.env.DEV) {
    const { mockTelegramEnvForDev } = await import('./telegram/mockEnv');
    await mockTelegramEnvForDev();
  }

  try {
    // Вне Telegram бросает: параметров запуска нет. Это не баг, а сигнал.
    init();
  } catch {
    root.render(<OpenInTelegram />);
    return;
  }

  // Тема — первой: miniApp и нижние кнопки берут из неё цвета по умолчанию.
  themeParams.mount();
  miniApp.mount();
  // bindCssVars повторно бросает CSSVarsBoundError — поэтому здесь, а не в эффекте
  // (StrictMode вызывает эффекты дважды).
  themeParams.bindCssVars();
  miniApp.bindCssVars();
  initData.restore(); // без этого сигналы initData.* пустые

  backButton.mount.ifAvailable();
  mainButton.mount.ifAvailable();
  secondaryButton.mount.ifAvailable(); // Bot API 7.10+
  swipeBehavior.mount.ifAvailable(); // Bot API 7.7+
  closingBehavior.mount.ifAvailable();

  if (viewport.mount.isAvailable()) {
    try {
      // Асинхронно: на iOS/Android размеры и отступы спрашиваются у клиента.
      await viewport.mount();
      viewport.bindCssVars();
    } catch (e) {
      // Клиент не ответил — живём на запасных значениях CSS, но не падаем.
      console.warn('viewport.mount не удался', e);
    }
  }

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

function App(): ReactNode {
  // Тёмная ли тема — считает SDK по bg_color; отдаём это браузеру, чтобы
  // полосы прокрутки и нативные поля совпали с темой Telegram, а не ОС.
  const isDark = useSignal(miniApp.isDark);
  useEffect(() => {
    document.documentElement.dataset.colorScheme = isDark ? 'dark' : 'light';
  }, [isDark]);

  useEffect(() => {
    // После первого кадра с содержимым (или скелетом): раньше — заглушка
    // Telegram сменится пустым экраном.
    miniApp.ready.ifAvailable();
  }, []);

  return <main className="app-shell">{/* роутер и экраны */}</main>;
}

function OpenInTelegram(): ReactNode {
  return <p className="app-shell">Откройте приложение в Telegram.</p>;
}

void bootstrap();
