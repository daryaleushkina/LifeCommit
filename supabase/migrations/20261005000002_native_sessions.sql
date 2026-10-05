-- Вход в нативные приложения (iPhone, Android, Mac) через официальный вход Telegram (OpenID Connect, 05.10.2026):
-- приложение присылает подписанный Telegram id_token, Worker проверяет подпись и выдаёт тот же ключ сессии, что
-- компьютеру. Сессии те же, устройства — ещё ios и android. Подтверждение по ссылке (desktop_logins) — как было,
-- только mac и web.
-- Совместимо с кодом, который уже крутится в проде: он пишет только mac и web.
alter table public.desktop_sessions drop constraint desktop_sessions_device_check;
alter table public.desktop_sessions add constraint desktop_sessions_device_check check (device in ('mac', 'web', 'ios', 'android'));
