// Настройка бота через Bot API: webhook, кнопка меню с мини-аппом, команды, описания.
// Запуск: pnpm bot:setup  (берёт TELEGRAM_BOT_TOKEN и WEBHOOK_SECRET из .env.local)
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const TOKEN = env.TELEGRAM_BOT_TOKEN;
const SECRET = env.WEBHOOK_SECRET;
const APP_URL = process.env.APP_URL ?? 'https://lifecommit.app';
if (!TOKEN || !SECRET) throw new Error('Нет TELEGRAM_BOT_TOKEN или WEBHOOK_SECRET в .env.local');

async function call(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  console.log(`${body.ok ? '✓' : '✗'} ${method}${body.ok ? '' : `: ${body.description}`}`);
  if (!body.ok) process.exitCode = 1;
}

await call('setWebhook', {
  url: `${APP_URL}/bot/webhook`,
  secret_token: SECRET,
  allowed_updates: ['message', 'my_chat_member', 'callback_query'],
  drop_pending_updates: true,
});

await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'LifeCommit', web_app: { url: APP_URL } },
});

for (const [lang, cmds, description, short] of [
  [
    'ru',
    [{ command: 'start', description: 'Открыть LifeCommit' }],
    'LifeCommit — привычки, дела на день и карта активности, как в GitHub.\n\n✅ Отмечай, что успел — даже чуть-чуть засчитывается\n🎤 Говори голосом — дела и привычки разберутся сами\n📅 Дела и встречи — вместе с Google и Apple Календарём\n🤝 Вместе с семьёй и друзьями: общие дела, цели и бот в чате группы\n🟩 Смотри, как зеленеет твоя карта',
    'Привычки, дела и карта активности. Голосом, с календарём и вместе с близкими.',
  ],
  [
    '',
    [{ command: 'start', description: 'Open LifeCommit' }],
    'LifeCommit — habits, daily to-dos and a GitHub-style activity map.\n\n✅ Log what you did — even a little counts\n🎤 Just say it — to-dos and habits sort themselves out\n📅 To-dos and meetings in sync with Google and Apple Calendar\n🤝 Together with family and friends: shared to-dos, goals and a bot in your group chat\n🟩 Watch your map turn green',
    'Habits, to-dos and an activity map. By voice, with your calendar and together.',
  ],
]) {
  const language_code = lang || undefined;
  await call('setMyCommands', { commands: cmds, language_code });
  await call('setMyDescription', { description, language_code });
  await call('setMyShortDescription', { short_description: short, language_code });
}

// В групповых чатах — своя команда: показать «Сегодня в группе».
await call('setMyCommands', { commands: [{ command: 'today', description: 'Дела группы на сегодня' }], scope: { type: 'all_group_chats' }, language_code: 'ru' });
await call('setMyCommands', { commands: [{ command: 'today', description: "The group's to-dos for today" }], scope: { type: 'all_group_chats' } });
