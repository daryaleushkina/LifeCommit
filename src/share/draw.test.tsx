// Картинки «Поделиться»: каждый шаблон рисуется без ошибок в 1080×1920, на месте знак, QR и содержимое;
// QR в подвале читается сканером; render() отдаёт JPEG.
import jsQR from 'jsqr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { draw, fontsReady, H, PREVIEW_SCALE, render, SCALE, W, type MonthCell, type SumRow, type Template } from './draw';

const BOT = '@LifeCommit_bot · бесплатно в Telegram';
const L = { bot: BOT };
const footer = 'Отмечаю в LifeCommit';
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const levels = (n: number) => Array.from({ length: n }, (_, i) => i % 5);

const cells: MonthCell[] = Array.from({ length: 31 }, (_, i) => ({ n: i + 1, state: (['on', 'slip', 'none'] as const)[i % 3]! }));

const ROWS: SumRow[] = [
  { n: '1 024', u: 'слова', t: 'Испанский', months: [0, 3, 8, 12, 0, 5, 9, 11, 2, 0, 7, 1] },
  { n: '23', u: '', t: 'Бросить курить' }, // без единицы и без месяцев
  { n: '312', u: 'км', t: 'Очень длинное название цели, которое на картинку целиком никак не помещается', months: Array(12).fill(0) },
  { n: '48', u: 'раз', t: 'Зарядка', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { n: '15', u: 'стаканов', t: 'Вода' },
  { n: '7', u: '', t: 'Медитация' },
  { n: '120', u: 'страниц', t: 'Чтение' },
  { n: '9', u: 'раз', t: 'Бассейн', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0] },
];
const rows = (n: number) => ROWS.slice(0, n);

const single: Template[] = [
  { kind: 'number', title: 'Вода', big: '42', caption: 'дня подряд', footer },
  { kind: 'month', title: 'Октябрь 2026', big: '29 из 31', caption: 'дня', lead: 3, cells, weekdays, footer },
  // Шесть недель: клетки мельче.
  { kind: 'month', title: 'Март 2026', big: '20 из 31', caption: 'дня', lead: 6, cells, weekdays, footer },
  { kind: 'sum', title: 'Вода', big: '186', caption: 'стаканов за октябрь', bars: [0, 2, 8, 9, 5, 0, 12, 3], goal: 8, left: '1', middle: '15', right: '31', footer },
  // Без цели — все столбики одного цвета.
  { kind: 'sum', title: 'Шаги', big: '1 024', caption: 'всего', bars: [0, 1, 4], goal: 0, left: '1', middle: '2', right: '3', footer },
  {
    kind: 'year',
    big: '184',
    caption: 'дня работы над собой',
    months: Array.from({ length: 12 }, (_, m) => ({ name: `М${m + 1}`, lead: m % 7, levels: levels(28 + (m % 4)) })),
    footer,
  },
  { kind: 'year-dark', big: '184', caption: 'дня в 2026', levels: levels(365), footer },
  { kind: 'month-heat', big: '12', caption: 'дней работы над собой в октябре', lead: 2, levels: levels(31), weekdays, footer },
  { kind: 'month-dark', title: 'Октябрь 2026', big: '12', caption: 'дней', lead: 4, levels: levels(31), footer },
];

const sums: Template[] = [1, 4, 6, 8].flatMap((n): Template[] => [
  { kind: 'sum-list', title: 'Мой октябрь', rows: rows(n), footer },
  { kind: 'sum-poster', title: 'Мой октябрь', rows: rows(n), footer },
  { kind: 'sum-bento', title: 'Октябрь 2026', big: '23', caption: 'дня работы над собой', levels: levels(31), rows: rows(n), footer },
  { kind: 'sum-neon', title: 'Октябрь 2026', big: '23', caption: 'дня работы над собой', rows: rows(n), footer },
  { kind: 'sum-year', big: '184', caption: 'дня работы над собой в 2026', rows: rows(n), footer },
]);

const DARK = new Set(['number', 'year-dark', 'month-dark', 'sum-neon']);
const name = (t: Template) => `${t.kind}${'rows' in t ? ` · ${t.rows.length} строк` : ''}`;

function paint(t: Template, scale = SCALE) {
  const canvas = document.createElement('canvas');
  draw(canvas, t, L, scale);
  return canvas;
}

/** Пиксель в координатах макета 360×640. */
function px(img: ImageData, x: number, y: number) {
  const i = (Math.round(y * SCALE) * img.width + Math.round(x * SCALE)) * 4;
  const d = img.data;
  return { r: d[i]!, g: d[i + 1]!, b: d[i + 2]!, a: d[i + 3]! };
}

const lum = (p: { r: number; g: number; b: number }) => 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
const greenInk = (p: { r: number; g: number; b: number }) => p.g > p.r + 40 && p.g > p.b + 20;

/** Сколько пикселей в прямоугольнике макета проходит проверку (шаг 1 пиксель холста). */
function count(img: ImageData, x0: number, y0: number, x1: number, y1: number, ok: (p: { r: number; g: number; b: number }) => boolean) {
  let n = 0;
  for (let y = Math.round(y0 * SCALE); y < Math.round(y1 * SCALE); y++) {
    for (let x = Math.round(x0 * SCALE); x < Math.round(x1 * SCALE); x++) {
      const i = (y * img.width + x) * 4;
      if (ok({ r: img.data[i]!, g: img.data[i + 1]!, b: img.data[i + 2]! })) n++;
    }
  }
  return n;
}

/** Прочитать QR подвала: вырезаем плашку и кладём на белое поле, как сканер увидел бы её на экране. */
function readFooterQr(canvas: HTMLCanvasElement) {
  const size = 64 * SCALE;
  const pad = 40;
  const out = document.createElement('canvas');
  out.width = size + pad * 2;
  out.height = size + pad * 2;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 26 * SCALE, (H - 96 - 64) * SCALE, size, size, pad, pad, size, size);
  return jsQR(ctx.getImageData(0, 0, out.width, out.height).data, out.width, out.height)?.data ?? null;
}

describe('draw — все шаблоны', () => {
  it.each([...single, ...sums].map((t) => [name(t), t] as const))('%s', (_n, t) => {
    const canvas = paint(t);
    expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
    const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const dark = DARK.has(t.kind);

    // Фон залит целиком: углы непрозрачные; тёмный — почти чёрный, светлый — светлый.
    for (const [x, y] of [[0, 0], [W - 0.4, 0], [0, H - 0.4], [W - 0.4, H - 0.4]] as const) expect(px(img, x, y).a).toBe(255);
    const corner = px(img, 2, 2);
    if (dark) expect(corner).toMatchObject({ r: 15, g: 21, b: 17 });
    else expect(lum(corner)).toBeGreaterThan(200);

    // Знак LifeCommit вверху: первая клетка 3×3 — зелёная.
    expect(greenInk(px(img, 30, 74))).toBe(true);

    // Плашка QR белая, «глаз» в углу — зелёный, внутри глаза — белое кольцо.
    const qy = H - 96 - 64;
    expect(px(img, 27, qy + 32)).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(greenInk(px(img, 29.5, qy + 10))).toBe(true);
    expect(px(img, 32.5, qy + 10)).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(greenInk(px(img, 36, qy + 10))).toBe(true);

    // Содержимое между шапкой и подвалом: текст и клетки нарисованы.
    const ink = count(img, 20, 100, 340, 470, dark ? (p) => lum(p) > 120 : (p) => lum(p) < 140);
    expect(ink).toBeGreaterThan(2000);
    // Подпись и @бот рядом с QR.
    expect(count(img, 96, qy, 340, qy + 54, dark ? (p) => lum(p) > 120 : (p) => lum(p) < 140)).toBeGreaterThan(200);
  });

  it('по умолчанию — полный размер, превью — в PREVIEW_SCALE', () => {
    const c = document.createElement('canvas');
    draw(c, single[0]!, L);
    expect([c.width, c.height]).toEqual([W * SCALE, H * SCALE]);
    expect(paint(single[0]!, PREVIEW_SCALE).width).toBe(W * PREVIEW_SCALE);
  });

  it('очень длинные тексты ужимаются и обрезаются, а не ломают картинку', () => {
    const long = 'Очень-очень длинная строка '.repeat(20);
    const huge: SumRow = { n: '999 999 999 999 999 999', u: 'километров пробежки по утрам', t: long };
    const all: Template[] = [
      { kind: 'number', title: long, big: '1'.repeat(200), caption: long, footer: long },
      { kind: 'sum-list', title: long, rows: [huge, ...rows(7)], footer: long },
      { kind: 'sum-list', title: 'x', rows: [huge], footer },
      { kind: 'sum-poster', title: long, rows: [huge, ...rows(7)], footer },
      { kind: 'sum-bento', title: long, big: long, caption: long, levels: levels(31), rows: [huge, huge, huge], footer },
      { kind: 'sum-neon', title: long, big: long, caption: long, rows: [huge, ...rows(7)], footer },
      { kind: 'sum-year', big: long, caption: long, rows: [huge, ...rows(7)], footer },
    ];
    for (const t of all) expect(() => paint(t)).not.toThrow();
  });
});

describe('QR в подвале', () => {
  it.each(['sum-list', 'number', 'month', 'sum-neon'] as const)('читается сканером: %s', (kind) => {
    const t = [...single, ...sums].find((x) => x.kind === kind)!;
    expect(readFooterQr(paint(t))).toBe('https://t.me/LifeCommit_bot');
  });
});

describe('render', () => {
  afterEach(() => vi.restoreAllMocks());

  it('JPEG 1080×1920', async () => {
    const blob = await render(sums[0]!, L);
    expect(blob.type).toBe('image/jpeg');
    const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    expect([...head]).toEqual([0xff, 0xd8, 0xff]);
    const bmp = await createImageBitmap(blob);
    expect([bmp.width, bmp.height]).toEqual([1080, 1920]);
    // JPEG, а не PNG: светлый фон с пятнами укладывается в разумный вес.
    expect(blob.size).toBeLessThan(600_000);
  });

  it('холст не отдал картинку — ошибка toBlob', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    await expect(render(single[0]!, L)).rejects.toThrow('toBlob');
  });
});

describe('fontsReady', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('ждёт загрузку Onest', async () => {
    const load = vi.spyOn(document.fonts, 'load');
    await fontsReady();
    expect(load).toHaveBeenCalledWith(expect.stringContaining("700 40px 'Onest Variable'"));
    expect(document.fonts.check("700 40px 'Onest Variable'")).toBe(true);
  });

  it('шрифт не грузится — через 1,5 секунды рисуем тем, что есть', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.spyOn(document.fonts, 'load').mockReturnValue(new Promise(() => {}));
    let done = false;
    const p = fontsReady().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it('загрузка шрифта бросила — не страшно', async () => {
    vi.spyOn(document.fonts, 'load').mockImplementation(() => {
      throw new Error('нет');
    });
    await expect(fontsReady()).resolves.toBeUndefined();
  });
});
