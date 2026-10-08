// Нативные кнопки Telegram: главная (как конечный автомат) и «назад»; подписка одна, отписка при уходе с экрана.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

const tg = vi.hoisted(() => {
  const sub = () => {
    const off = vi.fn();
    let handler: (() => void) | null = null;
    const ifAvailable = vi.fn((h: () => void): { ok: boolean; data?: () => void } => {
      handler = h;
      return { ok: true, data: off };
    });
    return { ifAvailable, off, press: () => handler?.() };
  };
  return {
    main: { setParams: vi.fn(), click: sub() },
    back: { show: vi.fn(), hide: vi.fn(), click: sub() },
  };
});

vi.mock('@tma.js/sdk-react', () => ({
  mainButton: { setParams: { ifAvailable: tg.main.setParams }, onClick: { ifAvailable: tg.main.click.ifAvailable } },
  backButton: { show: { ifAvailable: tg.back.show }, hide: { ifAvailable: tg.back.hide }, onClick: { ifAvailable: tg.back.click.ifAvailable } },
}));

import { useBackButton, useMainButton, type SubmitState } from './hooks';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMainButton', () => {
  it('текст и состояние: idle — можно нажать, submitting — крутилка, blocked — нельзя', async () => {
    const { rerender } = await renderHook((p?: { text: string; state: SubmitState }) => useMainButton(p!.text, p!.state, () => {}), {
      initialProps: { text: 'Сохранить', state: 'idle' },
    });
    expect(tg.main.setParams).toHaveBeenLastCalledWith({ text: 'Сохранить', isVisible: true, isEnabled: true, isLoaderVisible: false });
    await rerender({ text: 'Сохранить', state: 'submitting' });
    expect(tg.main.setParams).toHaveBeenLastCalledWith({ text: 'Сохранить', isVisible: true, isEnabled: false, isLoaderVisible: true });
    await rerender({ text: 'Готово', state: 'blocked' });
    expect(tg.main.setParams).toHaveBeenLastCalledWith({ text: 'Готово', isVisible: true, isEnabled: false, isLoaderVisible: false });
  });

  it('нажатие зовёт последний обработчик, а подписка одна на всё время экрана', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = await renderHook((p?: { fn: () => void }) => useMainButton('Ок', 'idle', p!.fn), { initialProps: { fn: first } });
    await rerender({ fn: second });
    tg.main.click.press();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(tg.main.click.ifAvailable).toHaveBeenCalledTimes(1);
  });

  it('уход с экрана — отписка и кнопка прячется', async () => {
    const { unmount } = await renderHook(() => useMainButton('Ок', 'idle', () => {}));
    await unmount();
    expect(tg.main.click.off).toHaveBeenCalledTimes(1);
    expect(tg.main.setParams).toHaveBeenLastCalledWith({ isVisible: false });
  });

  it('кнопки нет (вне Telegram) — отписываться нечем, но прячем', async () => {
    tg.main.click.ifAvailable.mockReturnValueOnce({ ok: false });
    const { unmount } = await renderHook(() => useMainButton('Ок', 'idle', () => {}));
    await unmount();
    expect(tg.main.click.off).not.toHaveBeenCalled();
    expect(tg.main.setParams).toHaveBeenLastCalledWith({ isVisible: false });
  });
});

describe('useBackButton', () => {
  it('корневой экран (null) — кнопку прячем, не подписываемся', async () => {
    await renderHook(() => useBackButton(null));
    expect(tg.back.hide).toHaveBeenCalled();
    expect(tg.back.show).not.toHaveBeenCalled();
    expect(tg.back.click.ifAvailable).not.toHaveBeenCalled();
  });

  it('вложенный экран: показываем, нажатие — последний обработчик, подписка не пересоздаётся', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = await renderHook((p?: { fn: (() => void) | null }) => useBackButton(p!.fn), { initialProps: { fn: first } });
    expect(tg.back.show).toHaveBeenCalledTimes(1);
    await rerender({ fn: second });
    tg.back.click.press();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(tg.back.click.ifAvailable).toHaveBeenCalledTimes(1);
  });

  it('стал корневым — отписка и кнопка прячется; запоздалое нажатие ничего не ломает', async () => {
    const fn = vi.fn();
    const { rerender } = await renderHook((p?: { fn: (() => void) | null }) => useBackButton(p!.fn), { initialProps: { fn: fn as (() => void) | null } });
    await rerender({ fn: null });
    expect(tg.back.click.off).toHaveBeenCalledTimes(1);
    expect(tg.back.hide).toHaveBeenCalledTimes(2); // в отписке и в новом эффекте
    expect(() => tg.back.click.press()).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  // 04.10.2026: шторка голоса поверх экрана группы, закрываясь, прятала «назад» — с экрана было не уйти.
  it('экран и шторка поверх: нажатие — верхней; шторка закрылась — кнопка видна и ведёт экран', async () => {
    const screen = vi.fn();
    const sheet = vi.fn();
    const s = await renderHook(() => useBackButton(screen));
    const top = await renderHook(() => useBackButton(sheet));
    tg.back.click.press();
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(screen).not.toHaveBeenCalled();
    tg.back.hide.mockClear();
    await top.unmount();
    expect(tg.back.hide).not.toHaveBeenCalled();
    tg.back.click.press();
    expect(screen).toHaveBeenCalledTimes(1);
    await s.unmount();
    expect(tg.back.hide).toHaveBeenCalledTimes(1);
    expect(tg.back.click.off).toHaveBeenCalledTimes(1);
  });

  it('кнопки нет — отписываться нечем, при уходе прячем', async () => {
    tg.back.click.ifAvailable.mockReturnValueOnce({ ok: false });
    const { unmount } = await renderHook(() => useBackButton(() => {}));
    await unmount();
    expect(tg.back.click.off).not.toHaveBeenCalled();
    expect(tg.back.hide).toHaveBeenCalledTimes(1);
  });
});
