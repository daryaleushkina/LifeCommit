/**
 * Хуки нативных кнопок Telegram для React. Копируются в src/telegram/hooks.ts.
 * Сверено с @tma.js/sdk-react 3.0.23: onClick возвращает отписку,
 * ifAvailable() — объект { ok, data }. Проверено в StrictMode: двойной вызов
 * эффектов не удваивает обработчики.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { backButton, mainButton } from '@tma.js/sdk-react';

export type SubmitState = 'idle' | 'submitting' | 'blocked';

/** Главная кнопка Telegram как конечный автомат. */
export function useMainButton(text: string, state: SubmitState, onPress: () => void): void {
  // Обработчик держим в ref: иначе новая функция на каждый рендер
  // переподписывала бы кнопку. Обновляем в эффекте — запись в ref во время
  // рендера ругается линтер React.
  const handler = useRef(onPress);
  useLayoutEffect(() => {
    handler.current = onPress;
  });

  useEffect(() => {
    mainButton.setParams.ifAvailable({
      text, // по умолчанию клиент пишет «Continue» — текст задаём всегда
      isVisible: true,
      isEnabled: state === 'idle',
      isLoaderVisible: state === 'submitting',
    });
  }, [text, state]);

  useEffect(() => {
    const sub = mainButton.onClick.ifAvailable(() => handler.current());
    return () => {
      if (sub.ok) sub.data(); // onClick возвращает отписку; без неё обработчики копятся
      mainButton.setParams.ifAvailable({ isVisible: false });
    };
  }, []);
}

/** Кнопка «назад» в шапке Telegram, привязанная к экрану. */
export function useBackButton(onBack: (() => void) | null): void {
  const handler = useRef(onBack);
  useLayoutEffect(() => {
    handler.current = onBack;
  });
  const visible = onBack !== null;

  useEffect(() => {
    if (!visible) {
      backButton.hide.ifAvailable();
      return;
    }
    backButton.show.ifAvailable();
    const sub = backButton.onClick.ifAvailable(() => handler.current?.());
    return () => {
      if (sub.ok) sub.data();
    };
  }, [visible]);
}
