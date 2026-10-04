import { describe, expect, it } from 'vitest';
import { landingPath, type Launch } from './route';

const browser: Launch = { pathname: '/', search: '', hash: '', language: 'ru-RU', inFrame: false, hasProxy: false, stored: false, dev: false };

describe('landingPath', () => {
  it('браузер без Telegram на корне — лендинг на языке браузера', () => {
    expect(landingPath(browser)).toBe('/ru/');
    expect(landingPath({ ...browser, language: 'en-US' })).toBe('/en/');
    expect(landingPath({ ...browser, language: 'de' })).toBe('/en/');
    expect(landingPath({ ...browser, language: 'uk-UA' })).toBe('/ru/');
    expect(landingPath({ ...browser, language: 'KK' })).toBe('/ru/');
  });

  it('параметры адреса (метки рекламы) переезжают на лендинг', () => {
    expect(landingPath({ ...browser, search: '?utm_source=threads' })).toBe('/ru/?utm_source=threads');
  });

  it('не корень — не трогаем (документы, лендинг, API)', () => {
    expect(landingPath({ ...browser, pathname: '/ru/' })).toBeNull();
    expect(landingPath({ ...browser, pathname: '/en/privacy/' })).toBeNull();
  });

  it('параметры запуска Telegram в «#» или в адресе — мини-апп', () => {
    expect(landingPath({ ...browser, hash: '#tgWebAppData=query_id%3D1&tgWebAppVersion=8.0&tgWebAppPlatform=ios' })).toBeNull();
    expect(landingPath({ ...browser, search: '?tgWebAppStartParam=g_abc' })).toBeNull();
  });

  it('мост Telegram, фрейм веб-клиента или сохранённые параметры после перезагрузки — мини-апп', () => {
    expect(landingPath({ ...browser, hasProxy: true })).toBeNull();
    expect(landingPath({ ...browser, inFrame: true })).toBeNull();
    expect(landingPath({ ...browser, stored: true })).toBeNull();
  });

  it('параметры подмены Telegram — мини-апп только в разработке', () => {
    for (const p of ['tgUserId=8', 'tgTheme=dark', 'tgPlatform=ios', 'tgStart=f_x']) {
      expect(landingPath({ ...browser, dev: true, search: `?${p}` })).toBeNull();
      expect(landingPath({ ...browser, dev: true, search: `?a=1&${p}` })).toBeNull();
      expect(landingPath({ ...browser, dev: false, search: `?${p}` })).toBe(`/ru/?${p}`);
    }
    expect(landingPath({ ...browser, dev: true })).toBe('/ru/');
  });
});
