// Ссылки t.me на компьютере. В приложении для Mac https://t.me/… открылась бы в браузере страницей «Открыть в Telegram» —
// лишний шаг; tg://… сразу открывает Telegram. Форматы — https://core.telegram.org/api/links.

/** Ссылка t.me → tg://; не t.me или неизвестный вид — та же ссылка. */
export function telegramAppUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return url;
  if (u.hostname !== 't.me' && u.hostname !== 'telegram.me') return url;
  const [first = '', second] = u.pathname.split('/').filter(Boolean);
  const query = new URLSearchParams(u.searchParams);

  // Поделиться: t.me/share/url?url=…&text=…
  if (first === 'share') return `tg://msg_url?${query.toString()}`;
  // Приглашение в чат: t.me/+hash, t.me/joinchat/hash
  if (first.startsWith('+') && first.length > 1) return `tg://join?invite=${encodeURIComponent(first.slice(1))}`;
  if (first === 'joinchat') return second ? `tg://join?invite=${encodeURIComponent(second)}` : url;
  if (!/^[A-Za-z0-9_]{4,32}$/.test(first)) return url;

  const params = new URLSearchParams([['domain', first]]);
  if (second && /^\d+$/.test(second)) params.set('post', second);
  // Именованный мини-апп бота: t.me/bot/app?startapp=… (так открывается Tribute).
  else if (second && /^[A-Za-z0-9_]{3,64}$/.test(second)) params.set('appname', second);
  else if (second) return url;
  for (const [k, v] of query) params.append(k, v);
  return `tg://resolve?${params.toString()}`;
}
