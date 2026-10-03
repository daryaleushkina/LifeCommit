import { describe, expect, it } from 'vitest';
import { cleanUsername } from './friends';

describe('cleanUsername', () => {
  it('«@masha», «masha», ссылка t.me — одно и то же имя', () => {
    for (const raw of ['masha_p', '@masha_p', '  @masha_p ', 't.me/masha_p', 'https://t.me/masha_p', 'http://telegram.me/masha_p']) expect(cleanUsername(raw)).toBe('masha_p');
    expect(cleanUsername('Masha')).toBe('Masha');
  });
  it('не имя Telegram — null', () => {
    for (const raw of ['', '@', 'ab', '1masha', 'маша', 'ma sha', 'masha!', 'x'.repeat(33), 'https://example.com/masha']) expect(cleanUsername(raw)).toBeNull();
    for (const raw of [undefined, null, 42, {}]) expect(cleanUsername(raw)).toBeNull();
  });
});
