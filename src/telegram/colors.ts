/** Цвет для Telegram: только #RRGGBB. */
export type Rgb = `#${string}`;
const isRgb = (v: string): v is Rgb => /^#[0-9a-f]{6}$/i.test(v);

export interface TelegramPaint {
  header: (color: Rgb) => void;
  bg: (color: Rgb) => void;
  bottomBar: (color: Rgb) => void;
  mainButton: (params: { bgColor: Rgb; textColor: Rgb }) => void;
}

/**
 * Шапка, фон и низ Telegram — в фон приложения, главная кнопка — в наш зелёный (DESIGN.md, The Own Palette Rule).
 * Цвета читаются из токенов app.css (`read('--bg')`), а не повторяются здесь: палитра живёт в одном месте.
 */
export function paintTelegram(read: (token: string) => string, tg: TelegramPaint): void {
  const bg = read('--bg').trim();
  const accent = read('--accent').trim();
  const accentText = read('--accent-text').trim();
  if (!isRgb(bg) || !isRgb(accent) || !isRgb(accentText)) return;
  tg.header(bg);
  tg.bg(bg);
  tg.bottomBar(bg);
  tg.mainButton({ bgColor: accent, textColor: accentText });
}
