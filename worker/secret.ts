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

export async function open(raw: string, sealed: string): Promise<string> {
  const [iv = '', ct = ''] = sealed.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(raw), unb64(ct));
  return new TextDecoder().decode(plain);
}
