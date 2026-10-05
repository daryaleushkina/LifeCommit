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

const hmacKey = (raw: string, use: 'sign' | 'verify') => crypto.subtle.importKey('raw', unb64(raw), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);

async function hmac(raw: string, text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(raw, 'sign'), new TextEncoder().encode(`state:${text}`))));
}

/** Подпись сходится — сравнение за постоянное время (crypto.subtle.verify), а не строкой. */
async function hmacOk(raw: string, text: string, sig: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  const bytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/') + '='), (ch) => ch.charCodeAt(0));
  return crypto.subtle.verify('HMAC', await hmacKey(raw, 'verify'), bytes, new TextEncoder().encode(`state:${text}`));
}

/**
 * Подписанный state для входа Google: «id.срок.подпись», у входа из приложения — «id.срок.app.подпись» (метка
 * подписана вместе с id и сроком). Google вернёт его в адрес возврата — по нему узнаём, чей это календарь (cookie из
 * Telegram в браузер не переходят) и куда вернуть человека: в мини-апп или в приложение.
 */
export async function signState(raw: string, userId: number, ttlMs = 15 * 60_000, client?: 'app'): Promise<string> {
  const body = `${userId}.${Date.now() + ttlMs}${client ? `.${client}` : ''}`;
  return `${body}.${await hmac(raw, body)}`;
}

/**
 * Проверить подпись state. null — подделан или не state; expired — подпись верна, но срок вышел (тогда уже известно,
 * откуда начали вход: приложение получит «ссылка устарела» у себя, а не страницу в браузере).
 */
export async function verifyState(raw: string, state: string): Promise<{ userId: number; app: boolean; expired: boolean } | null> {
  const parts = state.split('.');
  if (parts.length !== 3 && !(parts.length === 4 && parts[2] === 'app')) return null;
  const sig = parts.pop()!;
  const [id = '', exp = ''] = parts;
  if (!id || !exp || !sig || !(await hmacOk(raw, parts.join('.'), sig))) return null;
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return { userId, app: parts.length === 3, expired: !(Number(exp) >= Date.now()) };
}

/** Проверить state: подпись и срок. Вернёт id пользователя или null. */
export async function readState(raw: string, state: string): Promise<number | null> {
  const v = await verifyState(raw, state);
  return v && !v.expired ? v.userId : null;
}

export async function open(raw: string, sealed: string): Promise<string> {
  const [iv = '', ct = ''] = sealed.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(raw), unb64(ct));
  return new TextDecoder().decode(plain);
}
