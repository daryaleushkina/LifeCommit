// Вход на компьютере (приложение для Mac и браузер, 05.10.2026): признак «открыто не в Telegram, а на компьютере» и
// ключ сессии. Ключ выдаёт Worker после того, как вход подтвердили в мини-аппе (worker/desktop.ts).

/** Что веб-часть говорит нативной оболочке Mac (macos/Sources/LifeCommit/Bridge.swift). */
export type ShellMessage =
  | { type: 'ready' }
  | { type: 'back'; visible: boolean }
  | { type: 'colors'; header: string }
  /** fallback — если адрес открыть нечем (tg:// без Telegram на Маке), открыть этот (t.me в браузере). */
  | { type: 'open'; url: string; fallback?: string }
  | { type: 'download'; url: string; name: string };

/** Оболочка Mac: WKWebView с обработчиком сообщений `lifecommit`. */
export interface Shell {
  postMessage: (message: ShellMessage) => void;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { lifecommit?: Shell } };
  }
}

/** Нативная оболочка Mac, если страница открыта в ней. */
export const shell = (): Shell | null => window.webkit?.messageHandlers?.lifecommit ?? null;

/** Мини-апп открыт на компьютере: в оболочке Mac или в браузере по адресу с ?desktop. */
export const isDesktop = (): boolean => shell() !== null || new URLSearchParams(window.location.search).has('desktop');

/** Что подписать во входе: «на Mac» или «в браузере». */
export const desktopDevice = (): 'mac' | 'web' => (shell() ? 'mac' : 'web');

const TOKEN_KEY = 'lc-desktop-token';

export function desktopToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // хранилище недоступно (приватный режим браузера) — входа нет
    return null;
  }
}

/** Запомнить ключ. Хранилище недоступно — бросает: экран входа скажет, что не получилось. */
export function saveDesktopToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function forgetDesktopToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // хранилище недоступно — ключа там и нет
  }
}

/** Ключ отозвали или он истёк: забыть и вернуться на экран входа (перезагрузкой). */
export function sessionLost(reload: () => void = () => window.location.reload()): void {
  forgetDesktopToken();
  reload();
}
