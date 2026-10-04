/**
 * Корень сайта — это мини-апп: так настроены BotFather и кнопки бота. Сервер не отличает Telegram от браузера
 * (параметры запуска приходят после «#»), поэтому решает страница: без признаков Telegram человека отправляем
 * на лендинг (/ru/ или /en/), в Telegram — остаёмся в мини-аппе.
 *
 * Функция самодостаточна (без импортов и замыканий): плагин Vite вставляет её текст прямо в index.html,
 * чтобы переадресация шла до загрузки приложения.
 */
export interface Launch {
  pathname: string;
  search: string;
  hash: string;
  /** navigator.language */
  language: string;
  /** Страница внутри фрейма — так мини-апп живёт в веб-клиентах Telegram. */
  inFrame: boolean;
  /** window.TelegramWebviewProxy — мост мобильных и десктопных клиентов Telegram. */
  hasProxy: boolean;
  /** sessionStorage['tapps/launchParams'] — SDK сохраняет параметры запуска, после перезагрузки «#» уже нет. */
  stored: boolean;
  /** Локальная разработка: признаком Telegram считаются и параметры подмены (?tgUserId=…). */
  dev: boolean;
}

/** Куда отправить: '/ru/' или '/en/' (с исходными параметрами адреса), null — остаться в мини-аппе. */
export function landingPath(l: Launch): string | null {
  if (l.pathname !== '/') return null;
  if (l.hash.indexOf('tgWebApp') !== -1 || l.search.indexOf('tgWebApp') !== -1) return null;
  if (l.inFrame || l.hasProxy || l.stored) return null;
  if (l.dev && /[?&](tgUserId|tgTheme|tgPlatform|tgStart)=/.test(l.search)) return null;
  const lang = l.language.toLowerCase();
  const ru = /^(ru|uk|be|kk|uz|ky|tg|hy|az|ka)\b/.test(lang);
  return (ru ? '/ru/' : '/en/') + l.search;
}
