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

// Кто сейчас держит «назад»: экран, поверх него — шторка голоса и т. п. Нажатие получает верхний; кнопка видна,
// пока стек не пуст (04.10.2026: шторка голоса, закрываясь, прятала кнопку — с экрана группы было не уйти).
const backStack: { current: (() => void) | null }[] = [];
let backSub: (() => void) | null = null;

function syncBackButton() {
  if (backStack.length) {
    backButton.show.ifAvailable();
    if (!backSub) {
      const sub = backButton.onClick.ifAvailable(() => backStack.at(-1)?.current?.());
      if (sub.ok) backSub = sub.data;
    }
  } else {
    backButton.hide.ifAvailable();
    backSub?.();
    backSub = null;
  }
}

/** Кнопка «назад» в шапке Telegram, привязанная к экрану. null — на этом экране «назад» нет. */
export function useBackButton(onBack: (() => void) | null): void {
  const handler = useRef(onBack);
  useLayoutEffect(() => {
    handler.current = onBack;
  });
  const visible = onBack !== null;

  useEffect(() => {
    if (!visible) {
      syncBackButton();
      return;
    }
    backStack.push(handler);
    syncBackButton();
    return () => {
      backStack.splice(backStack.lastIndexOf(handler), 1);
      syncBackButton();
    };
  }, [visible]);
}
