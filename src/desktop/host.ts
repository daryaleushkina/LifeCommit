// Мост «как в Telegram» для компьютера (приложение для Mac и браузер, 05.10.2026).
// Мини-апп говорит с Telegram через @tma.js/sdk: события web_app_* уходят клиенту, ответы приходят событиями. На
// компьютере Telegram нет — клиентом становится этот модуль: тема, высота окна, главная кнопка, «назад»,
// подтверждения, ссылки, скачивание. Экраны приложения не меняются и не знают, где открыты.
// В оболочке Mac (macos/) «назад», ссылки, скачивание и цвет окна уходят в нативную часть, в браузере — делаются здесь.
import { emitEvent, mockTelegramEnv } from '@tma.js/sdk-react';
import { telegramAppUrl } from './links';
import { shell, type Shell } from './session';

const BOT_URL = 'https://t.me/LifeCommit_bot';

// Тема «клиента»: приложение красится своими токенами (app.css) и берёт отсюда только «светлая или тёмная».
type Theme = Record<string, `#${string}`>;
const LIGHT: Theme = { bg_color: '#F6F4EE', secondary_bg_color: '#FFFFFF', section_bg_color: '#FFFFFF', text_color: '#1F2A1F', hint_color: '#5E665B', link_color: '#237A46', button_color: '#237A46', button_text_color: '#FFFFFF', bottom_bar_bg_color: '#F6F4EE', header_bg_color: '#F6F4EE' };
const DARK: Theme = { bg_color: '#0F1511', secondary_bg_color: '#1B211C', section_bg_color: '#1B211C', text_color: '#E8EEE6', hint_color: '#A3AD9F', link_color: '#3FA968', button_color: '#3FA968', button_text_color: '#0E1A12', bottom_bar_bg_color: '#0F1511', header_bg_color: '#0F1511' };

/** Версия Bot API «клиента»: всё, что умеет мост (подтверждения, скачивание, отступы), и не больше. */
const VERSION = '8.0';

interface MainButton {
  visible: boolean;
  active: boolean;
  progress: boolean;
  text: string;
  color?: string;
  textColor?: string;
}

interface PopupButton {
  id: string;
  type: string;
  text: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (o: Record<string, unknown>, k: string): string | undefined => (typeof o[k] === 'string' ? o[k] : undefined);
const bool = (o: Record<string, unknown>, k: string): boolean | undefined => (typeof o[k] === 'boolean' ? o[k] : undefined);
const ru = () => document.documentElement.lang !== 'en';

/** Подписи стандартных кнопок подтверждения — как их пишет сам Telegram. */
const standardText = (type: string) =>
  type === 'cancel' ? (ru() ? 'Отмена' : 'Cancel') : type === 'close' ? (ru() ? 'Закрыть' : 'Close') : 'OK';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

const BACK_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>';

/**
 * Включить мост. Вызывать до init() SDK. В оболочке Mac нативная часть зовёт window.lifecommitHost.back(),
 * когда нажали «назад» в заголовке окна или ⌘[.
 */
export function installDesktopHost(): void {
  const native: Shell | null = shell();
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const theme = () => (scheme.matches ? DARK : LIGHT);

  const main: MainButton = { visible: false, active: true, progress: false, text: '' };
  let backVisible = false;
  /** Открытое подтверждение: закрыть его как «отмену» (Escape, «назад» из заголовка окна). */
  let cancelPopup: (() => void) | null = null;

  // ── Нарисованное здесь: нижняя полоса с главной кнопкой и (в браузере) полоса «назад» сверху ──
  const bar = el('div', 'host-bar');
  bar.hidden = true;
  const mainBtn = el('button', 'act primary host-main');
  mainBtn.type = 'button';
  bar.append(mainBtn);
  const top = el('div', 'host-top');
  top.hidden = true;
  const backBtn = el('button', 'host-back');
  backBtn.type = 'button';
  top.append(backBtn);
  document.body.append(top, bar);

  const back = () => {
    // «Назад» при открытом подтверждении (⌘[ в заголовке окна) — сначала закрыть подтверждение, как «Отмена».
    if (cancelPopup) cancelPopup();
    else if (backVisible) emitEvent('back_button_pressed');
  };
  mainBtn.addEventListener('click', () => emitEvent('main_button_pressed'));
  backBtn.addEventListener('click', back);
  window.lifecommitHost = { back };
  // Escape — «назад», если не открыта шторка (её Escape закрывает сама) и человек не печатает: в поле Escape
  // не должен уводить с экрана и терять написанное (и в наборе через IME он значит своё).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing || cancelPopup || document.querySelector('.sheet-backdrop')) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.matches('input, textarea, select') || t.isContentEditable)) return;
    back();
  });
  // Страница перезагрузилась — «назад» в заголовке окна от прошлой страницы не должен остаться.
  native?.postMessage({ type: 'back', visible: false });

  const emitTheme = () => emitEvent('theme_changed', { theme_params: theme() });
  const topInset = () => (!native && backVisible ? top.offsetHeight : 0);
  const emitViewport = () => {
    emitEvent('viewport_changed', {
      height: window.innerHeight - (main.visible ? bar.offsetHeight : 0),
      width: window.innerWidth,
      is_expanded: true,
      is_state_stable: true,
    });
  };
  const emitInsets = () => {
    emitEvent('safe_area_changed', { top: 0, bottom: 0, left: 0, right: 0 });
    emitEvent('content_safe_area_changed', { top: topInset(), bottom: 0, left: 0, right: 0 });
  };

  const renderMain = () => {
    bar.hidden = !main.visible;
    mainBtn.disabled = !main.active || main.progress;
    mainBtn.classList.toggle('busy', main.progress);
    mainBtn.setAttribute('aria-busy', String(main.progress));
    mainBtn.textContent = main.text;
    mainBtn.style.background = main.color ?? '';
    mainBtn.style.color = main.textColor ?? '';
    emitViewport();
  };
  const renderBack = () => {
    if (native) native.postMessage({ type: 'back', visible: backVisible });
    else {
      top.hidden = !backVisible;
      backBtn.innerHTML = `${BACK_ICON}<span>${ru() ? 'Назад' : 'Back'}</span>`;
      emitInsets();
    }
  };

  // ── Наружу: ссылки и файлы ──
  const openExternal = (url: string) => {
    if (native) native.postMessage({ type: 'open', url });
    else window.open(url, '_blank', 'noopener');
  };
  // В оболочке — сразу в приложение Telegram (tg://); нет его на Маке — та же ссылка t.me в браузере.
  const openTelegram = (url: string) => {
    if (!native) return openExternal(url);
    const app = telegramAppUrl(url);
    native.postMessage(app === url ? { type: 'open', url } : { type: 'open', url: app, fallback: url });
  };

  const download = async (url: string, name: string) => {
    const href = new URL(url, window.location.href).toString();
    if (native) {
      native.postMessage({ type: 'download', url: href, name });
      return;
    }
    const res = await fetch(href);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name;
    a.click();
    // Не сразу: Safari и Firefox отменяют скачивание, если ссылку на файл отозвать, пока оно начинается.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  // ── Подтверждение: шторка снизу, как остальные шторки приложения ──
  const showPopup = (params: Record<string, unknown>) => {
    const raw = Array.isArray(params.buttons) ? params.buttons.filter(isRecord) : [];
    const buttons: PopupButton[] = (raw.length ? raw : [{ type: 'close' }]).map((b) => {
      const type = str(b, 'type') ?? 'default';
      return { id: str(b, 'id') ?? '', type, text: str(b, 'text') ?? standardText(type) };
    });
    const backdrop = el('div', 'sheet-backdrop host-popup');
    const sheet = el('div', 'sheet');
    sheet.setAttribute('role', 'alertdialog');
    sheet.setAttribute('aria-modal', 'true');
    const title = str(params, 'title');
    const message = el('p', 'host-popup-message');
    message.id = 'host-popup-message';
    message.textContent = str(params, 'message') ?? '';
    // Имя для читалок экрана — заголовок, а без него (так зовёт приложение) — сам вопрос.
    if (title) {
      const h = el('h2', '');
      h.id = 'host-popup-title';
      h.textContent = title;
      sheet.append(h);
      sheet.setAttribute('aria-labelledby', h.id);
      sheet.setAttribute('aria-describedby', message.id);
    } else sheet.setAttribute('aria-labelledby', message.id);
    sheet.append(message);
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Пока спрашиваем, страница под шторкой недоступна с клавиатуры (Tab не уходит на «Сохранить» под ней).
    const behind = [document.getElementById('root'), bar, top].filter((x): x is HTMLElement => x !== null);
    behind.forEach((x) => (x.inert = true));

    const close = (buttonId: string | undefined) => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      behind.forEach((x) => (x.inert = false));
      cancelPopup = null;
      before?.focus();
      emitEvent('popup_closed', buttonId === undefined ? {} : { button_id: buttonId });
    };
    // Escape — «отмена», и дальше не идёт: шторку, из которой спросили, он не закрывает.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close(undefined);
    };
    for (const b of buttons) {
      const btn = el('button', `act wide ${b.type === 'destructive' ? 'danger' : b.type === 'cancel' || b.type === 'close' ? 'soft' : 'primary'}`);
      btn.type = 'button';
      btn.textContent = b.text;
      btn.addEventListener('click', () => close(b.id));
      sheet.append(btn);
    }
    backdrop.addEventListener('click', (e) => e.target === backdrop && close(undefined));
    backdrop.append(sheet);
    document.body.append(backdrop);
    cancelPopup = () => close(undefined);
    window.addEventListener('keydown', onKey, true);
    // Фокус — на безопасное: «Отмена», если она есть (привычный Return не должен удалить), иначе первая кнопка.
    const safe = buttons.findIndex((b) => b.type === 'cancel' || b.type === 'close');
    sheet.querySelectorAll('button')[safe === -1 ? 0 : safe]?.focus();
  };

  mockTelegramEnv({
    launchParams: new URLSearchParams([
      ['tgWebAppThemeParams', JSON.stringify(theme())],
      ['tgWebAppVersion', VERSION],
      ['tgWebAppPlatform', native ? 'macos' : 'web'],
    ]),
    onEvent(event) {
      const p = isRecord(event.params) ? event.params : {};
      switch (event.name) {
        case 'web_app_request_theme':
          return emitTheme();
        case 'web_app_request_viewport':
        case 'web_app_expand':
          return emitViewport();
        case 'web_app_request_safe_area':
        case 'web_app_request_content_safe_area':
          return emitInsets();
        case 'web_app_ready':
          return native?.postMessage({ type: 'ready' });
        case 'web_app_setup_main_button':
          main.visible = bool(p, 'is_visible') ?? main.visible;
          main.active = bool(p, 'is_active') ?? main.active;
          main.progress = bool(p, 'is_progress_visible') ?? main.progress;
          main.text = str(p, 'text') ?? main.text;
          main.color = str(p, 'color') ?? main.color;
          main.textColor = str(p, 'text_color') ?? main.textColor;
          return renderMain();
        case 'web_app_setup_back_button':
          backVisible = bool(p, 'is_visible') ?? backVisible;
          return renderBack();
        case 'web_app_set_header_color': {
          const color = str(p, 'color');
          if (!color) return;
          if (native) native.postMessage({ type: 'colors', header: color });
          else top.style.background = color;
          return;
        }
        case 'web_app_set_bottom_bar_color': {
          bar.style.background = str(p, 'color') ?? '';
          return;
        }
        case 'web_app_open_link': {
          const url = str(p, 'url');
          if (url) openExternal(url);
          return;
        }
        case 'web_app_open_tg_link': {
          const path = str(p, 'path_full');
          if (path) openTelegram(`https://t.me${path}`);
          return;
        }
        case 'web_app_open_popup':
          return showPopup(p);
        case 'web_app_request_write_access':
          // Разрешить боту писать можно только в Telegram: открываем чат с ботом — там «Запустить».
          openTelegram(BOT_URL);
          return emitEvent('write_access_requested', { status: 'cancelled' });
        case 'web_app_request_file_download': {
          // Не скачалось — «отказ»: «Сохранить» в приложении покажет ошибку, а не промолчит.
          const url = str(p, 'url');
          const done = (ok: boolean) => emitEvent('file_download_requested', { status: ok ? 'downloading' : 'cancelled' });
          if (!url) return done(false);
          download(url, str(p, 'file_name') ?? 'lifecommit.jpg').then(
            () => done(true),
            (e: unknown) => {
              console.warn('download failed', e);
              done(false);
            },
          );
          return;
        }
        case 'web_app_send_prepared_message':
          return emitEvent('prepared_message_failed', { error: 'UNSUPPORTED' });
        case 'web_app_invoke_custom_method':
          return emitEvent('custom_method_invoked', { req_id: str(p, 'req_id') ?? '', error: 'UNSUPPORTED' });
        default:
          // хаптика, свайпы, подтверждение закрытия, цвет фона — на компьютере показывать нечего
          return;
      }
    },
  });

  window.addEventListener('resize', emitViewport);
  scheme.addEventListener('change', emitTheme);
}

declare global {
  interface Window {
    /** Для нативной оболочки Mac: «назад» из заголовка окна и меню. */
    lifecommitHost?: { back: () => void };
  }
}
