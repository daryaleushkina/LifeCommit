// Заранее посчитанный QR на бота: сама матрица читается сканером — и без центра, отданного под знак.
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { BOT_QR, QR_LOGO } from './qr';

const URL = 'https://t.me/LifeCommit_bot';

/** Матрица чёрным по белому: клетка — px пикселей, поле — 4 клетки. */
function decode(matrix: readonly string[], blank = 0) {
  const n = matrix.length;
  const px = 8;
  const quiet = 4;
  const size = (n + quiet * 2) * px;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  const lo = (n - blank) / 2;
  matrix.forEach((row, r) =>
    [...row].forEach((v, c) => {
      const inLogo = blank > 0 && r >= lo && r < lo + blank && c >= lo && c < lo + blank;
      if (v === '1' && !inLogo) ctx.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
    }),
  );
  return jsQR(ctx.getImageData(0, 0, size, size).data, size, size)?.data ?? null;
}

describe('BOT_QR', () => {
  it('версия 3: 29×29 из нулей и единиц', () => {
    expect(BOT_QR).toHaveLength(29);
    for (const row of BOT_QR) expect(row).toMatch(/^[01]{29}$/);
  });

  it('читается как ссылка на бота', () => {
    expect(decode(BOT_QR)).toBe(URL);
  });

  it('место под знак — нечётное, по центру; без этих клеток код всё равно читается (коррекция Q)', () => {
    expect(QR_LOGO % 2).toBe(1);
    expect(decode(BOT_QR, QR_LOGO)).toBe(URL);
  });
});
