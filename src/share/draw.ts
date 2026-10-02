// Картинки «Поделиться» (дизайн 19B, 19C, 19D, 20H, 20I — выбор владелицы 02.10.2026; месяц профиля — тем же видом,
// что год). Рисуем сами на canvas:
// так одинаково в любом WebView Telegram и без библиотек. Размер сторис — 1080×1920; координаты ниже —
// как в макете (360×640), холст просто увеличен в 3 раза. На каждой картинке — знак, QR на бота и @LifeCommit_bot,
// всегда (переключателей нет — решение владелицы). Никаких пояснительных фраз — только цифра и что она значит.
import { BOT_QR, QR_LOGO } from './qr';

export const W = 360;
export const H = 640;
/** Картинка для Telegram — 1080×1920. Превью в окне рисуем мельче: на экране оно втрое меньше, а большие холсты тормозят ленту. */
export const SCALE = 3;
export const PREVIEW_SCALE = 2;

/**
 * Сторис: сверху Telegram кладёт шапку (аватар, имя, кнопки редактора), снизу — поле подписи или ответа.
 * Там ничего важного: знак — ниже шапки, QR и подпись — выше поля (02.10.2026: в сторис их перекрывало).
 */
const SAFE_TOP = 64;
const SAFE_BOTTOM = 96;

const C = {
  text: '#1F2A1F',
  muted: '#566055',
  accent: '#237A46',
  bg: '#F3F1EA',
  ink: '#0F1511',
  light: '#E8EEE6',
  neon: '#3FD27A',
  heat: ['rgba(31,42,31,0.07)', '#B8E0C4', '#7CCB96', '#3FA968', '#237A46'],
  slip: '#F2C9BC',
};
const FONT = "'Onest Variable', 'Onest', system-ui, -apple-system, sans-serif";

/** Месяц в дне: «29 из 31». states: 'on' — сделано (чисто), 'slip' — сорвалось, 'none' — нет. */
export interface MonthCell {
  n: number;
  state: 'on' | 'slip' | 'none';
}

export type Template =
  /** 19B: крупная светящаяся цифра на тёмном. */
  | { kind: 'number'; title: string; big: string; caption: string; footer: string }
  /** 19C: календарь месяца целиком. */
  | { kind: 'month'; title: string; big: string; caption: string; lead: number; cells: MonthCell[]; weekdays: string[]; footer: string }
  /** 19D: сумма за месяц и столбики по дням. */
  | { kind: 'sum'; title: string; big: string; caption: string; bars: number[]; goal: number; left: string; middle: string; right: string; footer: string }
  /** 20H: год двенадцатью маленькими месяцами. */
  | { kind: 'year'; big: string; caption: string; months: { name: string; lead: number; levels: number[] }[]; footer: string }
  /** 20I: год одной сеткой на тёмном. */
  | { kind: 'year-dark'; big: string; caption: string; levels: number[]; footer: string }
  /** Месяц профиля как 20H: «12 дней · работы над собой в октябре» и календарь месяца по уровням карты. */
  | { kind: 'month-heat'; big: string; caption: string; lead: number; levels: number[]; weekdays: string[]; footer: string }
  /** Месяц профиля как 20I: на тёмном, крупная цифра и сетка месяца. */
  | { kind: 'month-dark'; title: string; big: string; caption: string; lead: number; levels: number[]; footer: string };

export interface Labels {
  bot: string;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  rrPath(ctx, x, y, w, h, r);
}

/** Скруглённый прямоугольник в текущий контур (без beginPath) — чтобы собрать кольцо из двух. */
function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function font(ctx: CanvasRenderingContext2D, weight: number, size: number) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

/** Текст по ширине: не влез — уменьшаем шрифт. */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number): number {
  let s = size;
  font(ctx, weight, s);
  while (s > 10 && ctx.measureText(text).width > maxW) {
    s -= 2;
    font(ctx, weight, s);
  }
  return s;
}

/** Мягкие цветные пятна, как фон приложения (без filter: blur — его нет в WebView iOS). */
function blobs(ctx: CanvasRenderingContext2D) {
  const blob = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(243,241,234,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(50, 200, 230, 'rgba(191,232,204,0.9)');
  blob(340, 380, 220, 'rgba(243,226,184,0.85)');
  blob(60, 520, 220, 'rgba(246,211,194,0.8)');
  blob(340, 620, 240, 'rgba(191,232,204,0.75)');
}

function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(31,42,31,0.08)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.fill();
  ctx.restore();
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Знак LifeCommit: клетки 3×3. */
function mark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, on: string, dim: string) {
  const lv = [1, 0, 1, 1, 1, 0, 1, 1, 1];
  const c = size / 3.4;
  const gap = c * 0.2;
  lv.forEach((l, i) => {
    rr(ctx, x + (i % 3) * (c + gap), y + Math.floor(i / 3) * (c + gap), c, c, c * 0.28);
    ctx.fillStyle = l ? on : dim;
    ctx.fill();
  });
}

function brand(ctx: CanvasRenderingContext2D, dark: boolean) {
  const y = SAFE_TOP + 8;
  mark(ctx, 28, y, 20, dark ? C.neon : '#3FA968', dark ? 'rgba(63,210,122,0.25)' : 'rgba(63,169,104,0.35)');
  font(ctx, 700, 16);
  ctx.fillStyle = dark ? C.light : C.text;
  ctx.textBaseline = 'middle';
  ctx.fillText('LifeCommit', 56, y + 10);
}

/**
 * QR на бота в нашем стиле (02.10.2026, по образцу QR из Telegram): соседние клетки сливаются, свободные углы
 * скруглены, внутренние — с плавной галтелью; «глаза» — скруглённые квадраты; в центре — наш знак 3×3.
 * Зелёный градиент на светлой плашке: QR читается только тёмным по светлому, поэтому плашка светлая и на тёмных картинках.
 */
function qr(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const n = BOT_QR.length;
  const quiet = 1.5; // поле вокруг кода, в клетках
  const cell = size / (n + quiet * 2);
  const ox = x + quiet * cell;
  const oy = y + quiet * cell;
  const lo = (n - QR_LOGO) / 2;
  const eye = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const logo = (r: number, c: number) => r >= lo && r < lo + QR_LOGO && c >= lo && c < lo + QR_LOGO;
  const on = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && BOT_QR[r]![c] === '1' && !eye(r, c) && !logo(r, c);

  rr(ctx, x, y, size, size, size * 0.2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  const ink = ctx.createLinearGradient(x, y, x + size, y + size);
  ink.addColorStop(0, '#3FA968');
  ink.addColorStop(1, '#1D6239');

  // Все клетки — одним контуром: так между соседями нет швов сглаживания.
  const k = cell / 2;
  ctx.beginPath();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const X = ox + c * cell;
      const Y = oy + r * cell;
      if (on(r, c)) {
        const up = on(r - 1, c);
        const dn = on(r + 1, c);
        const lf = on(r, c - 1);
        const rt = on(r, c + 1);
        ctx.moveTo(X + k, Y);
        ctx.arcTo(X + cell, Y, X + cell, Y + cell, up || rt ? 0 : k);
        ctx.arcTo(X + cell, Y + cell, X, Y + cell, dn || rt ? 0 : k);
        ctx.arcTo(X, Y + cell, X, Y, dn || lf ? 0 : k);
        ctx.arcTo(X, Y, X + cell, Y, up || lf ? 0 : k);
        ctx.closePath();
      } else if (!eye(r, c) && !logo(r, c)) {
        // Внутренний угол буквы «Г» из трёх клеток — плавная галтель вместо острого угла.
        const fillet = (px: number, py: number, sx: number, sy: number) => {
          ctx.moveTo(px, py);
          ctx.lineTo(px + sx * k, py);
          ctx.arcTo(px, py, px, py + sy * k, k);
          ctx.closePath();
        };
        if (on(r - 1, c) && on(r, c - 1) && on(r - 1, c - 1)) fillet(X, Y, 1, 1);
        if (on(r - 1, c) && on(r, c + 1) && on(r - 1, c + 1)) fillet(X + cell, Y, -1, 1);
        if (on(r + 1, c) && on(r, c + 1) && on(r + 1, c + 1)) fillet(X + cell, Y + cell, -1, -1);
        if (on(r + 1, c) && on(r, c - 1) && on(r + 1, c - 1)) fillet(X, Y + cell, 1, -1);
      }
    }
  }
  ctx.fillStyle = ink;
  ctx.fill();

  // «Глаза»: кольцо 7×7 и квадрат 3×3, оба скруглённые.
  for (const [r, c] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ] as const) {
    const ex = ox + c * cell;
    const ey = oy + r * cell;
    ctx.beginPath();
    rrPath(ctx, ex, ey, 7 * cell, 7 * cell, 2.2 * cell);
    rrPath(ctx, ex + cell, ey + cell, 5 * cell, 5 * cell, 1.4 * cell);
    ctx.fillStyle = ink;
    ctx.fill('evenodd');
    rr(ctx, ex + 2 * cell, ey + 2 * cell, 3 * cell, 3 * cell, 0.9 * cell);
    ctx.fill();
  }

  // Знак LifeCommit в центре — на месте, которое код отдал под него (коррекция Q это переносит): зелёная плашка
  // со светлыми клетками, как кружок с самолётиком в QR Telegram, — чтобы знак не сливался с клетками кода.
  const tile = (QR_LOGO - 1) * cell;
  const tx = ox + (n * cell - tile) / 2;
  const ty = oy + (n * cell - tile) / 2;
  rr(ctx, tx, ty, tile, tile, tile * 0.3);
  ctx.fillStyle = ink;
  ctx.fill();
  const m = tile * 0.62;
  mark(ctx, tx + (tile - m) / 2, ty + (tile - m) / 2, m, '#FFFFFF', 'rgba(255,255,255,0.4)');
}

/** Подвал: QR, знак, подпись и @бот. */
const QR_SIZE = 64;

/** Нижняя граница содержимого: дальше — подвал. */
const CONTENT_BOTTOM = H - SAFE_BOTTOM - QR_SIZE - 14;

function footer(ctx: CanvasRenderingContext2D, text: string, bot: string, dark: boolean) {
  const y = H - SAFE_BOTTOM - QR_SIZE;
  const tx = 26 + QR_SIZE + 12;
  qr(ctx, 26, y, QR_SIZE);
  mark(ctx, tx, y + 16, 14, dark ? C.neon : '#3FA968', dark ? 'rgba(63,210,122,0.25)' : 'rgba(63,169,104,0.35)');
  ctx.textBaseline = 'middle';
  ctx.fillStyle = dark ? C.light : C.text;
  fit(ctx, text, 700, 14, W - tx - 20 - 26);
  ctx.fillText(text, tx + 20, y + 23);
  ctx.fillStyle = dark ? 'rgba(232,238,230,0.6)' : C.muted;
  fit(ctx, bot, 400, 12, W - tx - 26);
  ctx.fillText(bot, tx, y + 45);
}

function bigText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, glow = false) {
  const s = fit(ctx, text, 700, size, W - x * 2);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  if (glow) {
    ctx.save();
    ctx.shadowColor = 'rgba(63,210,122,0.55)';
    ctx.shadowBlur = 40;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  ctx.fillText(text, x, y);
  return s;
}

function line(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, weight: number, size: number, color: string) {
  fit(ctx, text, weight, size, W - x * 2);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawNumber(ctx: CanvasRenderingContext2D, t: Extract<Template, { kind: 'number' }>, l: Labels) {
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, W, H);
  brand(ctx, true);
  line(ctx, t.title, 28, 252, 500, 17, 'rgba(232,238,230,0.7)');
  bigText(ctx, t.big, 26, 382, 150, C.neon, true);
  line(ctx, t.caption, 28, 422, 700, 28, C.light);
  footer(ctx, t.footer, l.bot, true);
}

/**
 * Календарь месяца в стеклянной карточке от top до CONTENT_BOTTOM: клетки во всю ширину, а если месяц
 * в шесть недель не помещается по высоте — мельче и по центру.
 */
function calendar(ctx: CanvasRenderingContext2D, top: number, lead: number, cells: { n: number; fill: string; ink: string }[], weekdays: string[]) {
  const x0 = 26;
  const w = W - x0 * 2;
  const pad = 14;
  const gap = 6;
  const rows = Math.ceil((lead + cells.length) / 7);
  const cell = Math.min((w - pad * 2 - gap * 6) / 7, (CONTENT_BOTTOM - top - pad * 2 - 18 + gap) / rows - gap);
  const gx = x0 + (w - (cell * 7 + gap * 6)) / 2;
  const h = pad * 2 + 18 + rows * (cell + gap) - gap;
  glass(ctx, x0, top, w, h, 22);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  font(ctx, 700, 11);
  ctx.fillStyle = C.muted;
  weekdays.forEach((d, i) => ctx.fillText(d, gx + i * (cell + gap) + cell / 2, top + pad + 6));
  cells.forEach((c, i) => {
    const k = lead + i;
    const cx = gx + (k % 7) * (cell + gap);
    const cy = top + pad + 18 + Math.floor(k / 7) * (cell + gap);
    rr(ctx, cx, cy, cell, cell, Math.min(10, cell * 0.3));
    ctx.fillStyle = c.fill;
    ctx.fill();
    font(ctx, 700, 12);
    ctx.fillStyle = c.ink;
    ctx.fillText(String(c.n), cx + cell / 2, cy + cell / 2 + 0.5);
  });
  ctx.textAlign = 'left';
}

function drawMonth(ctx: CanvasRenderingContext2D, t: Extract<Template, { kind: 'month' }>, l: Labels) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  blobs(ctx);
  brand(ctx, false);
  line(ctx, t.title, 26, 132, 500, 15, C.muted);
  bigText(ctx, t.big, 24, 182, 54, C.text);
  line(ctx, t.caption, 26, 207, 400, 17, C.muted);
  const cells = t.cells.map((c) => ({
    n: c.n,
    fill: c.state === 'on' ? C.heat[3]! : c.state === 'slip' ? C.slip : C.heat[0]!,
    ink: c.state === 'on' ? '#FFFFFF' : c.state === 'slip' ? '#A2462A' : C.muted,
  }));
  calendar(ctx, 222, t.lead, cells, t.weekdays);
  footer(ctx, t.footer, l.bot, false);
}

/** Месяц профиля: уровни карты, числа белые на тёмно-зелёных клетках. */
function drawMonthHeat(ctx: CanvasRenderingContext2D, t: Extract<Template, { kind: 'month-heat' }>, l: Labels) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  blobs(ctx);
  brand(ctx, false);
  bigText(ctx, t.big, 24, 154, 64, C.accent);
  line(ctx, t.caption, 26, 184, 700, 24, C.text);
  const cells = t.levels.map((lv, i) => ({ n: i + 1, fill: C.heat[lv]!, ink: lv >= 3 ? '#FFFFFF' : lv ? C.text : C.muted }));
  calendar(ctx, 204, t.lead, cells, t.weekdays);
  footer(ctx, t.footer, l.bot, false);
}

/** Месяц профиля на тёмном: «Октябрь 2026», крупная цифра, сетка месяца без чисел. */
function drawMonthDark(ctx: CanvasRenderingContext2D, t: Extract<Template, { kind: 'month-dark' }>, l: Labels) {
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, W, H);
  brand(ctx, true);
  line(ctx, t.title, 28, 136, 500, 17, 'rgba(232,238,230,0.7)');
  bigText(ctx, t.big, 24, 226, 104, C.neon, true);
  line(ctx, t.caption, 26, 262, 700, 28, C.light);
  const top = 284;
  const gap = 4;
  const rows = Math.ceil((t.lead + t.levels.length) / 7);
  const cell = Math.min(40, (CONTENT_BOTTOM - top + gap) / rows - gap);
  t.levels.forEach((lv, i) => {
    const k = t.lead + i;
    rr(ctx, 24 + (k % 7) * (cell + gap), top + Math.floor(k / 7) * (cell + gap), cell, cell, cell * 0.26);
    ctx.fillStyle = lv ? C.heat[lv]! : 'rgba(232,238,230,0.08)';
    ctx.fill();
  });
  footer(ctx, t.footer, l.bot, true);
}

function drawSum(ctx: CanvasRenderingContext2D, t: Extract<Template, { kind: 'sum' }>, l: Labels) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  blobs(ctx);
  brand(ctx, false);
  line(ctx, t.title, 26, 132, 500, 15, C.muted);
  bigText(ctx, t.big, 24, 208, 84, C.accent);
  line(ctx, t.caption, 26, 242, 700, 26, C.text);
  const x0 = 26;
  const base = CONTENT_BOTTOM - 24;
  const hMax = 140;
  const max = Math.max(1, ...t.bars, t.goal);
  const gap = 3;
  const bw = (W - x0 * 2 - gap * (t.bars.length - 1)) / t.bars.length;
  t.bars.forEach((v, i) => {
    const h = Math.max(v > 0 ? 4 : 2, (v / max) * hMax);
    rr(ctx, x0 + i * (bw + gap), base - h, bw, h, Math.min(3, bw / 2));
    ctx.fillStyle = v <= 0 ? C.heat[0]! : t.goal > 0 && v >= t.goal ? C.heat[4]! : C.heat[2]!;
    ctx.fill();
  });
  font(ctx, 400, 12);
  ctx.fillStyle = C.muted;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(t.left, x0, base + 20);
  ctx.textAlign = 'center';
  ctx.fillText(t.middle, W / 2, base + 20);
  ctx.textAlign = 'right';
  ctx.fillText(t.right, W - x0, base + 20);
  ctx.textAlign = 'left';
  footer(ctx, t.footer, l.bot, false);
}

function drawYear(ctx: CanvasRenderingContext2D, t: Extract<Template, { kind: 'year' }>, l: Labels) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  blobs(ctx);
  brand(ctx, false);
  bigText(ctx, t.big, 24, 154, 64, C.accent);
  line(ctx, t.caption, 26, 184, 700, 24, C.text);
  const x0 = 24;
  const top = 204;
  const w = W - x0 * 2;
  const pad = 14;
  const colGap = 10;
  const rowGap = 12;
  const mw = (w - pad * 2 - colGap * 3) / 4;
  const g = 2;
  const cell = (mw - g * 6) / 7;
  const mh = 14 + 6 * (cell + g);
  const h = pad * 2 + 3 * mh + rowGap * 2;
  glass(ctx, x0, top, w, h, 22);
  t.months.forEach((m, i) => {
    const mx = x0 + pad + (i % 4) * (mw + colGap);
    const my = top + pad + Math.floor(i / 4) * (mh + rowGap);
    font(ctx, 700, 10);
    ctx.fillStyle = C.muted;
    ctx.textBaseline = 'top';
    ctx.fillText(m.name, mx, my);
    m.levels.forEach((lv, d) => {
      const k = m.lead + d;
      rr(ctx, mx + (k % 7) * (cell + g), my + 14 + Math.floor(k / 7) * (cell + g), cell, cell, cell * 0.26);
      ctx.fillStyle = C.heat[lv]!;
      ctx.fill();
    });
  });
  footer(ctx, t.footer, l.bot, false);
}

function drawYearDark(ctx: CanvasRenderingContext2D, t: Extract<Template, { kind: 'year-dark' }>, l: Labels) {
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, W, H);
  brand(ctx, true);
  bigText(ctx, t.big, 24, 186, 104, C.neon, true);
  line(ctx, t.caption, 26, 224, 700, 28, C.light);
  const x0 = 24;
  const cols = 26;
  const gap = 2;
  const cell = (W - x0 * 2 - gap * (cols - 1)) / cols;
  t.levels.forEach((lv, i) => {
    rr(ctx, x0 + (i % cols) * (cell + gap), 250 + Math.floor(i / cols) * (cell + gap), cell, cell, cell * 0.26);
    ctx.fillStyle = lv ? C.heat[lv]! : 'rgba(232,238,230,0.08)';
    ctx.fill();
  });
  footer(ctx, t.footer, l.bot, true);
}

/** Шрифт Onest должен успеть загрузиться, иначе картинка выйдет системным шрифтом. */
export async function fontsReady() {
  try {
    await Promise.race([Promise.all([document.fonts.load(`700 40px ${FONT}`), document.fonts.load(`500 16px ${FONT}`), document.fonts.load(`400 12px ${FONT}`)]), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    // нет — нарисуем тем, что есть
  }
}

export function draw(canvas: HTMLCanvasElement, t: Template, l: Labels, scale = SCALE) {
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (t.kind === 'number') drawNumber(ctx, t, l);
  else if (t.kind === 'month') drawMonth(ctx, t, l);
  else if (t.kind === 'sum') drawSum(ctx, t, l);
  else if (t.kind === 'year') drawYear(ctx, t, l);
  else if (t.kind === 'month-heat') drawMonthHeat(ctx, t, l);
  else if (t.kind === 'month-dark') drawMonthDark(ctx, t, l);
  else drawYearDark(ctx, t, l);
}

/**
 * Картинка для Telegram — JPEG, а не PNG (02.10.2026): PNG со светлыми пятнами фона весил ~1,5 МБ и долго кодировался
 * и грузился; JPEG того же шаблона — ~140 КБ, а Telegram всё равно хранит фото в JPEG.
 */
export function render(t: Template, l: Labels): Promise<Blob> {
  const canvas = document.createElement('canvas');
  draw(canvas, t, l, SCALE);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.92));
}
