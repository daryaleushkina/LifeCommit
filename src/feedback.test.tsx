// Жалоба из приложения: контекст (версия, платформа, экран) и ужатие скриншотов.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, feedbackContext, SHOT_SIDE, shrinkImage } from './feedback';

const launch = vi.hoisted(() => ({ params: null as Record<string, unknown> | null }));
vi.mock('@tma.js/sdk-react', async (orig) => ({
  ...(await orig<typeof import('@tma.js/sdk-react')>()),
  retrieveLaunchParams: () => {
    if (!launch.params) throw new Error('no launch params');
    return launch.params;
  },
}));

afterEach(() => {
  launch.params = null;
});

describe('feedbackContext', () => {
  it('версия, платформа Telegram, язык, тема, экран, пояс — и ничего лишнего', () => {
    launch.params = { tgWebAppPlatform: 'android', tgWebAppData: { hash: 'секрет' } };
    expect(feedbackContext({ lang: 'en', theme: 'dark', screen: 'me' })).toEqual({
      version: APP_VERSION,
      platform: 'android',
      lang: 'en',
      theme: 'dark',
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: 'me',
    });
  });

  it('вне Telegram — платформа unknown; в тестах версия — dev', () => {
    expect(feedbackContext({ lang: 'ru', theme: 'light', screen: 'me' })).toMatchObject({ platform: 'unknown', version: 'dev' });
  });
});

describe('shrinkImage', () => {
  async function png(w: number, h: number, alpha = false): Promise<Blob> {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    if (!alpha) c.getContext('2d')!.fillRect(0, 0, w, h);
    return new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
  }

  it('большая — до 1280 по длинной стороне, JPEG; маленькая — размер прежний', async () => {
    const big = await shrinkImage(await png(1000, 3000));
    expect(big.type).toBe('image/jpeg');
    const b = await createImageBitmap(big);
    expect([b.width, b.height]).toEqual([427, SHOT_SIDE]);
    const small = await createImageBitmap(await shrinkImage(await png(300, 200)));
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it('прозрачная — на белом, а не на чёрном', async () => {
    const shot = await createImageBitmap(await shrinkImage(await png(10, 10, true)));
    const c = document.createElement('canvas');
    c.width = 10;
    c.height = 10;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(shot, 0, 0);
    expect([...ctx.getImageData(5, 5, 1, 1).data].slice(0, 3).every((v) => v > 240)).toBe(true);
  });

  it('не картинка — отказ', async () => {
    await expect(shrinkImage(new Blob(['это текст'], { type: 'image/png' }))).rejects.toThrow();
  });
});
