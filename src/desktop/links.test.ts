// Ссылки t.me → tg:// для приложения на Mac: сразу в Telegram, без страницы «Открыть в Telegram» в браузере.
import { describe, expect, it } from 'vitest';
import { telegramAppUrl } from './links';

describe('telegramAppUrl', () => {
  it.each([
    ['https://t.me/LifeCommit_bot', 'tg://resolve?domain=LifeCommit_bot'],
    ['https://t.me/LifeCommit_bot?startapp=mac_abc-DEF_123', 'tg://resolve?domain=LifeCommit_bot&startapp=mac_abc-DEF_123'],
    ['https://t.me/LifeCommit_bot?startgroup=g_x1', 'tg://resolve?domain=LifeCommit_bot&startgroup=g_x1'],
    ['http://telegram.me/LifeCommit_bot?start=1', 'tg://resolve?domain=LifeCommit_bot&start=1'],
    ['https://t.me/tribute/app?startapp=dRk2', 'tg://resolve?domain=tribute&appname=app&startapp=dRk2'],
    ['https://t.me/durov/42', 'tg://resolve?domain=durov&post=42'],
    ['https://t.me/share/url?url=https%3A%2F%2Flifecommit.app&text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82', 'tg://msg_url?url=https%3A%2F%2Flifecommit.app&text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82'],
    ['https://t.me/+AbC123', 'tg://join?invite=AbC123'],
    ['https://t.me/joinchat/AbC123', 'tg://join?invite=AbC123'],
  ])('%s → %s', (from, to) => {
    expect(telegramAppUrl(from)).toBe(to);
  });

  it.each([
    'https://lifecommit.app/privacy/',
    'https://calendar.google.com/',
    'tg://resolve?domain=x',
    'не адрес',
    'https://t.me/',
    'https://t.me/+',
    'https://t.me/joinchat',
    'https://t.me/a',
    'https://t.me/LifeCommit_bot/a/b',
    'https://t.me/LifeCommit_bot/х',
  ])('не трогает: %s', (url) => {
    expect(telegramAppUrl(url)).toBe(url);
  });
});
