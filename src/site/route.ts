/**
 * Корень сайта — лендинг, мини-апп живёт на /app/ (решение владелицы 04.10.2026: без /ru и /en в адресе).
 * Но BotFather, кнопки бота в старых сообщениях и ссылки t.me/…?startapp открывают корень. Сервер запуск из Telegram
 * не видит (параметры приходят после «#»), поэтому решает страница: есть параметры запуска — уходим в мини-апп,
 * забирая адрес и «#» целиком; нет — это человек из браузера, остаёмся на лендинге.
 *
 * Признаки — только сами параметры запуска (или их копия, которую SDK сохраняет перед перезагрузкой). Мост
 * TelegramWebviewProxy и фрейм признаком не считаются: мост есть и во встроенном браузере Telegram, куда попадает
 * обычная ссылка на lifecommit.app из чата, — с ним корень раньше оставался мини-аппом без данных и не работал.
 *
 * Функция самодостаточна (без импортов и замыканий): плагин Vite вставляет её текст прямо в <head> лендинга,
 * чтобы переход шёл до загрузки страницы.
 */
export interface Launch {
  pathname: string;
  search: string;
  hash: string;
  /** sessionStorage['tapps/launchParams'] — SDK сохраняет параметры запуска, после перезагрузки «#» уже нет. */
  stored: boolean;
  /** Локальная разработка: признаком Telegram считаются и параметры подмены (?tgUserId=…). */
  dev: boolean;
}

/** Куда уйти: '/app/' с исходными параметрами адреса и «#», null — остаться на лендинге. */
export function appPath(l: Launch): string | null {
  if (l.pathname !== '/') return null;
  const telegram =
    l.hash.indexOf('tgWebApp') !== -1 ||
    l.search.indexOf('tgWebApp') !== -1 ||
    l.stored ||
    (l.dev && /[?&](tgUserId|tgTheme|tgPlatform|tgStart)=/.test(l.search));
  return telegram ? '/app/' + l.search + l.hash : null;
}
