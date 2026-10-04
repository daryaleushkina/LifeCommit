// Общее для страниц сайта: тема (по системе или выбор человека), шапка становится матовой при прокрутке,
// кнопки сторов, пока приложений нет, никуда не ведут (решение владелицы 04.10.2026: «кнопка как бы рабочая»).
// Тему и data-os ещё до отрисовки ставит встроенный скрипт в <head> (THEME_BOOT в каждой странице).

export type Theme = 'light' | 'dark';
const KEY = 'lc-site-theme';

export function currentTheme(): Theme {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Подписка на смену темы — и кнопкой, и в настройках системы. */
export function onTheme(fn: (t: Theme) => void): void {
  window.addEventListener('lc-theme', () => fn(currentTheme()));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => fn(currentTheme()));
}

function setTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // приватный режим: тема просто не запомнится
  }
  window.dispatchEvent(new Event('lc-theme'));
}

export function initCommon(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((b) => {
    const label = () => {
      const dark = currentTheme() === 'dark';
      const ru = document.documentElement.lang === 'ru';
      b.setAttribute('aria-label', ru ? (dark ? 'Светлая тема' : 'Тёмная тема') : dark ? 'Light theme' : 'Dark theme');
    };
    label();
    onTheme(label);
    b.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  });

  const top = document.querySelector('.site-top');
  if (top) {
    const solid = () => top.classList.toggle('solid', window.scrollY > 24);
    window.addEventListener('scroll', solid, { passive: true });
    solid();
  }

  document.querySelectorAll<HTMLAnchorElement>('a.store[data-soon]').forEach((a) => {
    a.addEventListener('click', (e) => e.preventDefault());
  });
}
