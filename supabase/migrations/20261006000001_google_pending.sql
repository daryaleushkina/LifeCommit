-- Вход Google, ждущий подтверждения клиентом (worker/google.ts, решение владелицы 06.10.2026 после security-review).
-- Раньше /google/callback подключал календарь сразу к тому, чей id в state. Но state не привязан к браузеру: чужая
-- ссылка входа, которую жертва открыла и подтвердила на экране Google, подключала её календарь к аккаунту автора
-- ссылки. Теперь callback кладёт итог сюда под одноразовым кодом и отдаёт код только туда, где дали согласие (ссылкой
-- в приложение или в мини-апп). Подключает POST /api/calendars/google/finish — и только если код принёс тот же
-- человек, что начал вход: у автора чужой ссылки нет кода, у жертвы — его ключа.
-- code_hash — SHA-256 кода (сам код в базе не лежит); secret — refresh token, зашифрованный CALENDAR_KEY. Строки
-- живут 15 минут; старые убирает следующий возврат из Google.
create table public.google_pending (
  code_hash  text primary key,
  user_id    bigint not null references public.users (id) on delete cascade,
  secret     text not null,
  login      text not null,
  calendars  jsonb not null,
  created_at timestamptz not null default now()
);
create index google_pending_created_idx on public.google_pending (created_at);
alter table public.google_pending enable row level security;
