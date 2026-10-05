// Вход на компьютере: где открыто (оболочка Mac, браузер с ?desktop, Telegram) и ключ сессии в хранилище.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopDevice, desktopToken, forgetDesktopToken, isDesktop, saveDesktopToken, sessionLost, shell } from './session';

const url = window.location.href;
beforeEach(() => localStorage.clear());
afterEach(() => {
  history.replaceState(null, '', url);
  delete window.webkit;
  vi.restoreAllMocks();
});

describe('где открыто', () => {
  it('обычная страница (Telegram) — не компьютер', () => {
    expect(isDesktop()).toBe(false);
    expect(shell()).toBeNull();
  });

  it('?desktop в адресе — браузер на компьютере', () => {
    history.replaceState(null, '', '?desktop');
    expect(isDesktop()).toBe(true);
    expect(desktopDevice()).toBe('web');
  });

  it('оболочка Mac — компьютер «mac», даже без ?desktop', () => {
    const lifecommit = { postMessage: vi.fn() };
    window.webkit = { messageHandlers: { lifecommit } };
    expect(shell()).toBe(lifecommit);
    expect(isDesktop()).toBe(true);
    expect(desktopDevice()).toBe('mac');
  });

  it('чужие обработчики WebKit без нашего — не оболочка', () => {
    window.webkit = { messageHandlers: {} };
    expect(shell()).toBeNull();
  });
});

describe('ключ', () => {
  it('сохранить, прочитать, забыть', () => {
    expect(desktopToken()).toBeNull();
    saveDesktopToken('k'.repeat(43));
    expect(desktopToken()).toBe('k'.repeat(43));
    forgetDesktopToken();
    expect(desktopToken()).toBeNull();
  });

  it('хранилище недоступно: прочитать — нет ключа, забыть — без ошибки, сохранить — ошибка (экран входа её покажет)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(desktopToken()).toBeNull();
    expect(() => forgetDesktopToken()).not.toThrow();
    expect(() => saveDesktopToken('k')).toThrow('QuotaExceededError');
  });

  it('ключ потерян (отозвали) — забыть и перезагрузить на экран входа', () => {
    saveDesktopToken('k'.repeat(43));
    const reload = vi.fn();
    sessionLost(reload);
    expect(desktopToken()).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });
});
