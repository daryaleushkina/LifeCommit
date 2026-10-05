// Мост в оболочке Mac (macos/): «назад», цвет окна, ссылки, скачивание и «готово» уходят в нативную часть
// сообщениями (window.webkit.messageHandlers.lifecommit), а «назад» из заголовка окна приходит обратно.
import { backButton, downloadFile, init, mainButton, miniApp, openLink, openTelegramLink, requestWriteAccess, viewport } from '@tma.js/sdk-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installDesktopHost } from './host';
import type { ShellMessage } from './session';

const sent: ShellMessage[] = [];
window.webkit = { messageHandlers: { lifecommit: { postMessage: (m) => void sent.push(m) } } };
document.documentElement.lang = 'ru';
installDesktopHost();
init();
miniApp.mount();
backButton.mount();
mainButton.mount();
await viewport.mount();

// Сразу после установки моста — «назад» в заголовке окна выключен: страница могла перезагрузиться с открытого экрана.
const first = [...sent];

beforeEach(() => {
  sent.length = 0;
});

describe('оболочка Mac', () => {
  it('при загрузке страницы «назад» в заголовке окна выключается', () => {
    expect(first[0]).toEqual({ type: 'back', visible: false });
  });

  it('«назад» — в заголовке окна, не на странице; кнопка в заголовке зовёт обработчик приложения', async () => {
    const onBack = vi.fn();
    const off = backButton.onClick(onBack);
    backButton.show();
    expect(sent).toContainEqual({ type: 'back', visible: true });
    expect(document.querySelector<HTMLElement>('.host-top')!.hidden).toBe(true);
    await expect.poll(() => viewport.contentSafeAreaInsetTop()).toBe(0);
    window.lifecommitHost!.back();
    expect(onBack).toHaveBeenCalledOnce();
    backButton.hide();
    expect(sent).toContainEqual({ type: 'back', visible: false });
    off();
  });

  it('цвет шапки — цвет окна; «готово» — сигнал оболочке', () => {
    miniApp.setHeaderColor('#0F1511');
    miniApp.ready();
    expect(sent).toEqual([{ type: 'colors', header: '#0F1511' }, { type: 'ready' }]);
  });

  it('ссылки — наружу через оболочку; t.me — сразу в приложение Telegram (tg://)', async () => {
    openLink('https://lifecommit.app/privacy/');
    openTelegramLink('https://t.me/LifeCommit_bot?startapp=mac_abc');
    expect(await requestWriteAccess()).toBe('cancelled');
    openTelegramLink('https://t.me/');
    expect(sent).toEqual([
      { type: 'open', url: 'https://lifecommit.app/privacy/' },
      // Telegram на Маке может не быть — тогда оболочка откроет t.me в браузере
      { type: 'open', url: 'tg://resolve?domain=LifeCommit_bot&startapp=mac_abc', fallback: 'https://t.me/LifeCommit_bot?startapp=mac_abc' },
      { type: 'open', url: 'tg://resolve?domain=LifeCommit_bot', fallback: 'https://t.me/LifeCommit_bot' },
      // не переводится в tg:// — без запасного
      { type: 'open', url: 'https://t.me/' },
    ]);
  });

  it('скачивание — в «Загрузки» силами оболочки, полным адресом', async () => {
    await downloadFile('/share/a.jpg', 'lifecommit.jpg');
    expect(sent).toEqual([{ type: 'download', url: new URL('/share/a.jpg', window.location.href).toString(), name: 'lifecommit.jpg' }]);
  });
});
