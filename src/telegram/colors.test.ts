// Цвета Telegram (шапка, фон, низ, главная кнопка) берутся из токенов app.css — палитра живёт в одном месте.
import { describe, expect, it, vi } from 'vitest';
import { paintTelegram } from './colors';

const tokens = (map: Record<string, string>) => (name: string) => map[name] ?? '';
const sdk = () => ({ header: vi.fn(), bg: vi.fn(), bottomBar: vi.fn(), mainButton: vi.fn() });

describe('paintTelegram', () => {
  it('красит шапку, фон и низ в --bg, главную кнопку — в --accent с --accent-text', () => {
    const s = sdk();
    paintTelegram(tokens({ '--bg': ' #F6F4EE', '--accent': '#237A46 ', '--accent-text': '#FFFFFF' }), s);
    expect(s.header).toHaveBeenCalledWith('#F6F4EE');
    expect(s.bg).toHaveBeenCalledWith('#F6F4EE');
    expect(s.bottomBar).toHaveBeenCalledWith('#F6F4EE');
    expect(s.mainButton).toHaveBeenCalledWith({ bgColor: '#237A46', textColor: '#FFFFFF' });
  });

  it('токена нет или он не #RRGGBB — Telegram не трогаем (его цвета лучше, чем мусор)', () => {
    const cases: Record<string, string>[] = [
      {},
      { '--bg': 'rgba(0,0,0,1)', '--accent': '#237A46', '--accent-text': '#FFF' },
      { '--bg': '#0F1511', '--accent': '', '--accent-text': '#0E1A12' },
      { '--bg': '#0F1511', '--accent': '#3FA968', '--accent-text': 'white' },
    ];
    for (const bad of cases) {
      const s = sdk();
      paintTelegram(tokens(bad), s);
      expect(s.header).not.toHaveBeenCalled();
      expect(s.mainButton).not.toHaveBeenCalled();
    }
  });
});
