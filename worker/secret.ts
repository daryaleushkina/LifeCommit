// Шифрование паролей приложений (AES-GCM). Ключ — секрет Worker'а CALENDAR_KEY (32 байта в base64):
// в базе лежит только шифр, без ключа он бесполезен.

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(raw: string): Promise<CryptoKey> {
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error('CALENDAR_KEY: нужно 32 байта в base64');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Текст → «iv.шифр» в base64. */
export async function seal(raw: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(raw), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}

const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(raw: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', unb64(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`state:${text}`))));
}

/**
 * Подписанный state для входа Google: «id.срок.подпись». Google вернёт его в адрес возврата —
 * по нему узнаём, чей это календарь (cookie из Telegram в браузер не переходят).
 */
export async function signState(raw: string, userId: number, ttlMs = 15 * 60_000): Promise<string> {
  const body = `${userId}.${Date.now() + ttlMs}`;
  return `${body}.${await hmac(raw, body)}`;
}

/** Проверить state: подпись и срок. Вернёт id пользователя или null. */
export async function readState(raw: string, state: string): Promise<number | null> {
  const [id, exp, sig] = state.split('.');
  if (!id || !exp || !sig || Number(exp) < Date.now()) return null;
  return (await hmac(raw, `${id}.${exp}`)) === sig ? Number(id) : null;
}

export async function open(raw: string, sealed: string): Promise<string> {
  const [iv = '', ct = ''] = sealed.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(raw), unb64(ct));
  return new TextDecoder().decode(plain);
}
