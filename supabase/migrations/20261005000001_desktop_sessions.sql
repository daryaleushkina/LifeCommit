-- Вход на компьютере (приложение для Mac и браузер, 05.10.2026). Подписи Telegram там нет, поэтому вход
-- подтверждают в мини-аппе: компьютер держит случайный секрет, человек открывает ссылку
-- t.me/<бот>?startapp=mac_<код> (код — отпечаток секрета) и нажимает «Войти», компьютер забирает долгий ключ сессии.
-- До подтверждения в базе ничего нет — анонимно таблицу не забить. Храним только отпечатки (SHA-256).

-- Подтверждённые входы: живут 10 минут, пока компьютер не заберёт ключ; забрал — строка удаляется.
create table public.desktop_logins (
  code        text primary key,                                    -- из ссылки: отпечаток секрета компьютера
  user_id     bigint not null references public.users(id) on delete cascade,
  device      text not null check (device in ('mac', 'web')),
  approved_at timestamptz not null default now()
);
create index desktop_logins_approved_idx on public.desktop_logins (approved_at);
alter table public.desktop_logins enable row level security;

-- Сессии компьютеров. Ключ живёт, пока им пользуются: 90 дней без входа — истёк. Выйти — с компьютера или из мини-аппа.
create table public.desktop_sessions (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references public.users(id) on delete cascade,
  token_hash   text not null unique,                                -- SHA-256 ключа; сам ключ знает только компьютер
  device       text not null check (device in ('mac', 'web')),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index desktop_sessions_user_idx on public.desktop_sessions (user_id);
alter table public.desktop_sessions enable row level security;
