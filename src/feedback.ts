// Жалоба из приложения (docs/feedback.md, этап 1): что прикладываем к ней сами и как ужимаем скриншоты.
import { retrieveLaunchParams } from '@tma.js/sdk-react';

/** Версия сборки — короткий git sha (vite.config.ts); без git и в тестах — dev. */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev';

/**
 * Контекст жалобы: версия, платформа Telegram, язык, тема, размер экрана, пояс и экран, откуда открыли.
 * Не прикладываем initData, тела запросов и содержимое дел.
 */
export function feedbackContext(o: { lang: string; theme: string; screen: string }): Record<string, string> {
  let platform = 'unknown';
  try {
    platform = String(retrieveLaunchParams().tgWebAppPlatform);
  } catch {
    // вне Telegram параметров запуска нет — платформа неизвестна, это не повод не принять жалобу
  }
  return {
    version: APP_VERSION,
    platform,
    lang: o.lang,
    theme: o.theme,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: o.screen,
  };
}

/** Длинная сторона скриншота после ужатия: текст на нём читается, а весит он в разы меньше. */
export const SHOT_SIDE = 1280;

/**
 * Скриншот → JPEG не больше SHOT_SIDE по длинной стороне (на белом: у PNG бывает прозрачность). Картинку, которую
 * браузер не может прочитать (HEIC на Android, не картинка), — отказ: шторка скажет «попробуй другую».
 */
export async function shrinkImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, SHOT_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('jpeg not encoded'))), 'image/jpeg', 0.85));
}
