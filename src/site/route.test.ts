import { describe, expect, it } from 'vitest';
import { appPath, type Launch } from './route';

const browser: Launch = { pathname: '/', search: '', hash: '', stored: false, dev: false };

describe('appPath', () => {
  it('браузер без Telegram на корне — остаётся на лендинге', () => {
    expect(appPath(browser)).toBeNull();
    expect(appPath({ ...browser, search: '?utm_source=threads' })).toBeNull();
  });

  it('параметры запуска Telegram в «#» — в мини-апп, адрес и «#» целиком переезжают', () => {
    const hash = '#tgWebAppData=query_id%3D1&tgWebAppVersion=8.0&tgWebAppPlatform=ios';
    expect(appPath({ ...browser, hash })).toBe(`/app/${hash}`);
    // старые кнопки бота: /?join=…#tgWebApp…
    expect(appPath({ ...browser, search: '?join=abc', hash })).toBe(`/app/?join=abc${hash}`);
  });

  it('параметры запуска в адресе — в мини-апп', () => {
    expect(appPath({ ...browser, search: '?tgWebAppStartParam=g_abc' })).toBe('/app/?tgWebAppStartParam=g_abc');
  });

  it('сохранённые SDK параметры после перезагрузки — в мини-апп', () => {
    expect(appPath({ ...browser, stored: true })).toBe('/app/');
  });

  it('не корень — не трогаем (документы, API)', () => {
    expect(appPath({ ...browser, pathname: '/privacy/', hash: '#tgWebAppData=x' })).toBeNull();
  });

  it('параметры подмены Telegram — мини-апп только в разработке', () => {
    for (const p of ['tgUserId=8', 'tgTheme=dark', 'tgPlatform=ios', 'tgStart=f_x']) {
      expect(appPath({ ...browser, dev: true, search: `?${p}` })).toBe(`/app/?${p}`);
      expect(appPath({ ...browser, dev: true, search: `?a=1&${p}` })).toBe(`/app/?a=1&${p}`);
      expect(appPath({ ...browser, dev: false, search: `?${p}` })).toBeNull();
    }
    expect(appPath({ ...browser, dev: true })).toBeNull();
  });
});
