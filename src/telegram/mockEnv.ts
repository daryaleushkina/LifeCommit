/**
 * Подмена окружения Telegram для разработки и скриншотов вне клиента.
 *
 * Копируется в `src/telegram/mockEnv.ts` и вызывается ТОЛЬКО из ветки
 * `if (import.meta.env.DEV)` через динамический импорт — тогда в боевую сборку
 * не попадает ни код, ни цвета подменной темы (см. assets/bootstrap.tsx).
 *
 * Основа — официальный способ @tma.js/sdk: `mockTelegramEnv` + `emitEvent`
 * (docs.telegram-mini-apps.com/packages/tma-js-bridge/environment и шаблон
 * github.com/Telegram-Mini-Apps/reactjs-template, MIT, © 2024 Telegram Mini Apps).
 *
 * Идеи «рисовать нативные кнопки настоящим DOM, чтобы они были на скриншоте»,
 * «Escape = кнопка назад» и «хранилища поверх localStorage» взяты
 * из assets/miniapp-mock.js навыка github.com/yaniv-golan/telegram-webapps-skill
 * (MIT, © 2026 Yaniv Golan). Код переписан: тот мок подменяет
 * window.Telegram.WebApp, а @tma.js/sdk этим объектом не пользуется вовсе —
 * он говорит с клиентом через window.TelegramWebviewProxy.postEvent и
 * события, поэтому подменять надо мост, а не объект.
 *
 * Тексты лицензий — в licenses/ рядом с навыком.
 *
 * Параметры берутся из адреса страницы, чтобы Playwright снимал разные случаи
 * без правки кода:
 *   ?tgTheme=light|dark          тема (по умолчанию dark)
 *   ?tgPlatform=ios|android|tdesktop|macos|weba|web  (по умолчанию ios)
 *   ?tgVersion=10.1              версия Bot API клиента; ниже — проверка isAvailable()
 *   ?tgInsets=59,34,46,0         safe top, safe bottom, content top, content bottom
 *   ?tgChrome=0                  не рисовать заглушки нативных кнопок
 *   ?tgStart=abc                 start_param
 *   ?tgUserId=900001             id пользователя Telegram (по умолчанию 1): у каждого e2e-теста — свой,
 *                                чтобы тесты шли параллельно и не видели данных друг друга
 */
import { emitEvent, isTMA, mockTelegramEnv } from '@tma.js/sdk-react';

type Rgb = `#${string}`;
type Theme = Record<string, Rgb>;

// ⚠️ Это НЕ палитра приложения, а подмена того, что прислал бы клиент.
// Тёмная — пример из документации tma.js (реальная тема Telegram Desktop).
// Светлая — из miniapp-mock.js (yaniv-golan), с живым клиентом не сверена.
// Ключей bottom_bar_bg_color и section_separator_color в тёмной нет нарочно:
// клиент тоже может их не прислать, и запасные значения в CSS должны это пережить.
const DARK_THEME: Theme = {
  accent_text_color: '#6ab2f2',
  bg_color: '#17212b',
  button_color: '#5288c1',
  button_text_color: '#ffffff',
  destructive_text_color: '#ec3942',
  header_bg_color: '#17212b',
  hint_color: '#708499',
  link_color: '#6ab3f3',
  secondary_bg_color: '#232e3c',
  section_bg_color: '#17212b',
  section_header_text_color: '#6ab3f3',
  subtitle_text_color: '#708499',
  text_color: '#f5f5f5',
};
const LIGHT_THEME: Theme = {
  accent_text_color: '#2481cc',
  bg_color: '#ffffff',
  bottom_bar_bg_color: '#ffffff',
  button_color: '#2481cc',
  button_text_color: '#ffffff',
  destructive_text_color: '#ff3b30',
  header_bg_color: '#ffffff',
  hint_color: '#999999',
  link_color: '#2481cc',
  secondary_bg_color: '#f1f1f1',
  section_bg_color: '#ffffff',
  section_header_text_color: '#6d6d71',
  subtitle_text_color: '#999999',
  text_color: '#222222',
};

// Высота нижней панели — как у отладочной панели в telegram-web-app.js:
// 58 px на ряд, +51 px, если вторичная кнопка стоит сверху или снизу.
const BAR_ROW = 58;
const BAR_EXTRA_ROW = 51;

interface ButtonState {
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  text: string;
  color?: string;
  textColor?: string;
  position?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function str(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}
function bool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}

export async function mockTelegramEnvForDev(): Promise<void> {
  // 'complete' шлёт настоящий запрос и ждёт ответа. Простой isTMA() здесь не
  // годится: подмена кладёт параметры запуска в sessionStorage, и после
  // перезагрузки он скажет «это Telegram», хотя моста уже нет.
  if (await isTMA('complete')) return;

  const q = new URLSearchParams(window.location.search);
  const theme = q.get('tgTheme') === 'light' ? LIGHT_THEME : DARK_THEME;
  const platform = q.get('tgPlatform') ?? 'ios';
  const version = q.get('tgVersion') ?? '10.1';
  const drawChrome = q.get('tgChrome') !== '0';
  const [safeTop = 0, safeBottom = 0, contentTop = 0, contentBottom = 0] = (q.get('tgInsets') ?? '')
    .split(',')
    .map((n) => Number.parseInt(n, 10) || 0);

  const buttons: Record<'main' | 'secondary', ButtonState> = {
    main: { isVisible: false, isActive: true, isProgressVisible: false, text: '' },
    secondary: { isVisible: false, isActive: true, isProgressVisible: false, text: '', position: 'left' },
  };
  let backVisible = false;

  const barHeight = (): number => {
    const { main, secondary } = buttons;
    if (!main.isVisible && !secondary.isVisible) return 0;
    const stacked = main.isVisible && secondary.isVisible
      && (secondary.position === 'top' || secondary.position === 'bottom');
    return stacked ? BAR_ROW + BAR_EXTRA_ROW : BAR_ROW;
  };
  const emitViewport = (): void => {
    emitEvent('viewport_changed', {
      height: window.innerHeight - (drawChrome ? barHeight() : 0),
      width: window.innerWidth,
      is_expanded: true,
      is_state_stable: true,
    });
  };

  // ── Заглушки нативных элементов: в браузере их нет, а на скриншоте нужны ──
  const chrome = drawChrome ? createChrome() : undefined;
  const render = (): void => {
    if (!chrome) return;
    chrome.back.hidden = !backVisible;
    renderButton(chrome.main, buttons.main);
    renderButton(chrome.secondary, buttons.secondary);
    const { position } = buttons.secondary;
    chrome.bar.style.flexDirection = position === 'top' ? 'column-reverse'
      : position === 'bottom' ? 'column'
      : position === 'right' ? 'row' : 'row-reverse';
    chrome.bar.hidden = barHeight() === 0;
    emitViewport();
  };
  chrome?.main.addEventListener('click', () => emitEvent('main_button_pressed'));
  chrome?.secondary.addEventListener('click', () => emitEvent('secondary_button_pressed'));
  chrome?.back.addEventListener('click', () => emitEvent('back_button_pressed'));
  // Escape — «назад» для удобства отладки; срабатывает, только когда кнопка видна
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backVisible) emitEvent('back_button_pressed');
  });
  window.addEventListener('resize', emitViewport);

  const store = (prefix: string, area: Storage) => ({
    get: (key: string): string | null => area.getItem(prefix + key),
    set: (key: string, value: string | null): void => {
      if (value === null) area.removeItem(prefix + key);
      else area.setItem(prefix + key, value);
    },
    keys: (): string[] => Object.keys(area).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
    clear(): void {
      this.keys().forEach((k) => area.removeItem(prefix + k));
    },
  });
  const cloud = store('tg-mock-cloud:', localStorage);
  const device = store('tg-mock-device:', localStorage);
  const secure = store('tg-mock-secure:', sessionStorage);

  mockTelegramEnv({
    launchParams: new URLSearchParams([
      ['tgWebAppThemeParams', JSON.stringify(theme)],
      ['tgWebAppData', new URLSearchParams([
        ['auth_date', String(Math.floor(Date.now() / 1000))], // секунды, не миллисекунды
        ['hash', 'mock-hash-not-valid-for-backend'],
        ['signature', 'mock-signature'],
        ['user', JSON.stringify({ id: Number(q.get('tgUserId') ?? 1), first_name: 'Тест', language_code: 'ru' })],
        ...(q.get('tgStart') ? [['start_param', q.get('tgStart') ?? '']] : []),
      ]).toString()],
      ['tgWebAppVersion', version],
      ['tgWebAppPlatform', platform],
    ]),
    onEvent(event) {
      const p: Record<string, unknown> = isRecord(event.params) ? event.params : {};
      const reqId = str(p, 'req_id') ?? '';
      switch (event.name) {
        case 'web_app_request_theme':
          return emitEvent('theme_changed', { theme_params: theme });
        case 'web_app_request_viewport':
        case 'web_app_expand':
          return emitViewport();
        case 'web_app_request_safe_area':
          return emitEvent('safe_area_changed', { top: safeTop, bottom: safeBottom, left: 0, right: 0 });
        case 'web_app_request_content_safe_area':
          return emitEvent('content_safe_area_changed', { top: contentTop, bottom: contentBottom, left: 0, right: 0 });
        case 'web_app_setup_main_button':
        case 'web_app_setup_secondary_button': {
          const b = buttons[event.name === 'web_app_setup_main_button' ? 'main' : 'secondary'];
          b.isVisible = bool(p, 'is_visible') ?? b.isVisible;
          b.isActive = bool(p, 'is_active') ?? b.isActive;
          b.isProgressVisible = bool(p, 'is_progress_visible') ?? b.isProgressVisible;
          b.text = str(p, 'text') ?? b.text;
          b.color = str(p, 'color') ?? b.color;
          b.textColor = str(p, 'text_color') ?? b.textColor;
          b.position = str(p, 'position') ?? b.position;
          return render();
        }
        case 'web_app_setup_back_button':
          backVisible = bool(p, 'is_visible') ?? backVisible;
          return render();
        case 'web_app_open_link': {
          const url = str(p, 'url');
          if (url) window.open(url, '_blank', 'noopener');
          return;
        }
        case 'web_app_open_popup': {
          // Нативного окна нет — отвечаем сразу, иначе popup.show() повиснет.
          // Playwright по умолчанию закрывает confirm отказом, поэтому здесь без диалогов.
          const list = Array.isArray(p.buttons) ? p.buttons.filter(isRecord) : [];
          const first = list.find((b) => str(b, 'type') !== 'cancel' && str(b, 'type') !== 'close');
          return emitEvent('popup_closed', { button_id: first ? str(first, 'id') : undefined });
        }
        case 'web_app_device_storage_get_key':
          return emitEvent('device_storage_key_received', { req_id: reqId, value: device.get(str(p, 'key') ?? '') });
        case 'web_app_device_storage_save_key': {
          const v = p.value;
          device.set(str(p, 'key') ?? '', typeof v === 'string' ? v : null);
          return emitEvent('device_storage_key_saved', { req_id: reqId });
        }
        case 'web_app_device_storage_clear':
          device.clear();
          return emitEvent('device_storage_cleared', { req_id: reqId });
        case 'web_app_secure_storage_get_key':
          return emitEvent('secure_storage_key_received', {
            req_id: reqId, value: secure.get(str(p, 'key') ?? ''), can_restore: false,
          });
        case 'web_app_secure_storage_save_key': {
          const v = p.value;
          secure.set(str(p, 'key') ?? '', typeof v === 'string' ? v : null);
          return emitEvent('secure_storage_key_saved', { req_id: reqId });
        }
        case 'web_app_secure_storage_clear':
          secure.clear();
          return emitEvent('secure_storage_cleared', { req_id: reqId });
        case 'web_app_invoke_custom_method':
          // Через этот метод @tma.js/sdk ходит в CloudStorage
          return emitEvent('custom_method_invoked', { req_id: reqId, result: cloudResult(p, cloud) });
        default:
          // ready, haptics, closing behavior, цвета шапки — в браузере показывать нечего
          if (import.meta.env.DEV) console.debug('[tg-mock]', event.name, event.params);
      }
    },
  });

  console.info('[tg-mock] Окружение Telegram подменено: мост, тема, параметры запуска. initData НЕ пройдёт проверку на сервере.');
}

function cloudResult(p: Record<string, unknown>, cloud: {
  get: (k: string) => string | null; set: (k: string, v: string | null) => void; keys: () => string[];
}): unknown {
  const method = str(p, 'method');
  const params: Record<string, unknown> = isRecord(p.params) ? p.params : {};
  const keysOf = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : typeof v === 'string' ? [v] : [];
  switch (method) {
    case 'getStorageValues':
      return Object.fromEntries(keysOf(params.keys).map((k) => [k, cloud.get(k) ?? '']));
    case 'saveStorageValue':
      cloud.set(str(params, 'key') ?? '', str(params, 'value') ?? '');
      return true;
    case 'deleteStorageValues':
      keysOf(params.keys).forEach((k) => cloud.set(k, null));
      return true;
    case 'getStorageKeys':
      return cloud.keys();
    default:
      return undefined;
  }
}

interface Chrome { bar: HTMLElement; main: HTMLButtonElement; secondary: HTMLButtonElement; back: HTMLButtonElement }

function createChrome(): Chrome {
  const style = document.createElement('style');
  // Цвета — только переменные темы: заглушка должна выглядеть как клиент в той же теме
  style.textContent = `
    #tg-mock-bar { position: fixed; inset: auto 0 0 0; z-index: 2147483647; display: flex; gap: 7px;
      padding: 7px; box-sizing: border-box;
      background: var(--tg-bottom-bar-color, var(--tg-theme-bottom-bar-bg-color, var(--tg-theme-secondary-bg-color))); }
    #tg-mock-bar[hidden], #tg-mock-back[hidden], #tg-mock-bar button[hidden] { display: none; }
    #tg-mock-bar button { flex: 1; height: 44px; border: 0; border-radius: 10px; font: 600 15px system-ui, sans-serif; }
    #tg-mock-bar button:disabled { opacity: .6; }
    #tg-mock-back { position: fixed; top: 8px; left: 8px; z-index: 2147483647; border: 0; border-radius: 16px;
      padding: 6px 12px; font: 500 14px system-ui, sans-serif;
      background: var(--tg-theme-secondary-bg-color); color: var(--tg-theme-link-color); }`;
  document.head.append(style);
  const bar = document.createElement('div');
  bar.id = 'tg-mock-bar';
  bar.hidden = true;
  const main = document.createElement('button');
  const secondary = document.createElement('button');
  bar.append(main, secondary);
  const back = document.createElement('button');
  back.id = 'tg-mock-back';
  back.textContent = '‹ Назад';
  back.hidden = true;
  const attach = (): void => document.body.append(bar, back);
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach, { once: true });
  return { bar, main, secondary, back };
}

function renderButton(el: HTMLButtonElement, s: ButtonState): void {
  el.hidden = !s.isVisible;
  el.disabled = !s.isActive || s.isProgressVisible;
  el.textContent = s.isProgressVisible ? '…' : s.text;
  el.style.background = s.color ?? 'var(--tg-theme-button-color)';
  el.style.color = s.textColor ?? 'var(--tg-theme-button-text-color)';
}
