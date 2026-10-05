-- Вход в нативные приложения (iPhone, Android, Mac) через официальный вход Telegram (OpenID Connect, 05.10.2026):
-- приложение присылает подписанный Telegram id_token, Worker проверяет подпись и выдаёт тот же ключ сессии, что
-- компьютеру. Сессии те же, устройства — ещё ios и android. Подтверждение по ссылке (desktop_logins) — как было,
-- только mac и web.
-- Совместимо с кодом, который уже крутится в проде: он пишет только mac и web.
alter table public.desktop_sessions drop constraint desktop_sessions_device_check;
alter table public.desktop_sessions add constraint desktop_sessions_device_check check (device in ('mac', 'web', 'ios', 'android'));

-- Один id_token — один вход: отпечаток (SHA-256) использованного токена. Токен живёт у нас не дольше 10 минут
-- (worker/telegramLogin.ts) — строки старше уборка удаляет при следующих входах. Утёкший из лога или прокси токен так
-- не превратить во второй, третий… ключ сессии.
create table public.auth_token_uses (
  token_hash text primary key,
  used_at    timestamptz not null default now()
);
create index auth_token_uses_used_idx on public.auth_token_uses (used_at);
alter table public.auth_token_uses enable row level security;
