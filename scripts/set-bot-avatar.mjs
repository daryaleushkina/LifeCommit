// Аватарка бота через Bot API (setMyProfilePhoto, Bot API 9.4): design/avatar/lifecommit-avatar-1024.jpg.
// Запуск: node scripts/set-bot-avatar.mjs  (TELEGRAM_BOT_TOKEN — из .env.local, как у bot:setup).
// Картинку пересобрать: node design/avatar/render.mjs, потом sips -s format jpeg … (см. design/avatar).
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Нет TELEGRAM_BOT_TOKEN в .env.local');

const form = new FormData();
// Фото профиля нельзя передать ссылкой или file_id — только новым файлом в том же запросе.
form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
form.append('avatar', new Blob([readFileSync(new URL('../design/avatar/lifecommit-avatar-1024.jpg', import.meta.url))], { type: 'image/jpeg' }), 'avatar.jpg');
const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyProfilePhoto`, { method: 'POST', body: form });
const body = await res.json();
console.log(body.ok ? '✓ setMyProfilePhoto' : `✗ setMyProfilePhoto: ${body.description}`);
if (!body.ok) process.exitCode = 1;
