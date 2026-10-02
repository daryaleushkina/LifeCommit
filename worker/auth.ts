import { parse, validate } from '@tma.js/init-data-node/web';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Env } from './env';

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export type AuthVars = { tgUser: TgUser; startParam: string | undefined };

const MOCK_HASH = 'mock-hash-not-valid-for-backend';

/**
 * Проверяет подпись initData (заголовок `Authorization: tma <сырая строка>`).
 * Права дальше решаются только по проверенному user.id.
 */
export const requireTelegram = createMiddleware<{ Bindings: Env; Variables: AuthVars }>(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const [scheme, raw] = [header.slice(0, 4), header.slice(4)];
  if (scheme !== 'tma ' || !raw) throw new HTTPException(401, { message: 'no_init_data' });

  const params = new URLSearchParams(raw);
  const isMock = c.env.DEV_AUTH_BYPASS === '1' && params.get('hash') === MOCK_HASH;
  if (!isMock) {
    try {
      // По умолчанию данные старше суток отвергаются — мини-апп живёт дольше,
      // поэтому даём неделю: подпись всё равно проверяется.
      await validate(raw, c.env.TELEGRAM_BOT_TOKEN, { expiresIn: 7 * 86_400 });
    } catch {
      throw new HTTPException(401, { message: 'bad_init_data' });
    }
  }

  // Подпись проверена (или это подмена разработки), но сами данные могут не разобраться — это 401, а не 500.
  let data: ReturnType<typeof parse>;
  try {
    data = parse(raw);
  } catch {
    throw new HTTPException(401, { message: 'bad_init_data' });
  }
  if (!data.user) throw new HTTPException(401, { message: 'no_user' });
  c.set('tgUser', data.user as TgUser);
  c.set('startParam', data.start_param);
  await next();
});
