-- Вход на компьютере (приложение для Mac и браузер, 05.10.2026). Подписи Telegram там нет, поэтому вход
-- подтверждают в мини-аппе: компьютер держит случайный секрет, человек открывает ссылку
-- t.me/<бот>?startapp=mac_<код><время><подпись> (код — отпечаток секрета, время выдачи и подпись Worker'а: ссылка живёт
-- 10 минут от выдачи) и нажимает «Войти», компьютер забирает долгий ключ сессии.
-- До подтверждения в базе ничего нет — анонимно таблицу не забить. Храним только отпечатки (SHA-256).

-- Подтверждённые входы. Ключ забрали — строка остаётся (claimed_at), пока ссылка не истечёт: та же ссылка второй раз
-- не подтверждается (иначе одна разосланная ссылка собирала бы ключи всех, кто нажмёт «Войти»). Старше 10 минут — удаляются.
create table public.desktop_logins (
  code        text primary key,                                    -- из ссылки: отпечаток секрета компьютера
  user_id     bigint not null references public.users(id) on delete cascade,
  telegram_id bigint not null,                                     -- какой аккаунт Telegram подтвердил (бывает связанный)
  device      text not null check (device in ('mac', 'web')),
  approved_at timestamptz not null default now(),
  claimed_at  timestamptz                                          -- компьютер забрал ключ
);
create index desktop_logins_approved_idx on public.desktop_logins (approved_at);
create index desktop_logins_user_idx on public.desktop_logins (user_id);
alter table public.desktop_logins enable row level security;

-- Сессии компьютеров. Ключ живёт, пока им пользуются: 90 дней без входа — истёк. Выйти — с компьютера или из мини-аппа.
create table public.desktop_sessions (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references public.users(id) on delete cascade,
  -- Компьютер действует от имени аккаунта Telegram, который подтвердил вход: со связанного аккаунта — как связанный
  -- (например, общий аккаунт так не удалить, как и из самого Telegram).
  telegram_id  bigint not null,
  token_hash   text not null unique,                                -- SHA-256 ключа; сам ключ знает только компьютер
  device       text not null check (device in ('mac', 'web')),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index desktop_sessions_user_idx on public.desktop_sessions (user_id);
alter table public.desktop_sessions enable row level security;

-- Забрать подтверждение и выдать ключ — одним оператором: упала выдача — подтверждение остаётся, и следующий опрос
-- компьютера получит ключ (двумя запросами подтверждение пропадало, а ключа не было). Два опроса сразу не получат
-- два ключа: незабранное подтверждение отмечает только один. Отпечаток ключа считает Worker; ответ — кому выдан ключ
-- (пусто — подтверждения нет).
create or replace function public.desktop_claim(p_code text, p_token_hash text, p_since timestamptz)
returns table (user_id bigint, telegram_id bigint, device text)
language sql
set search_path = ''
as $$
  with login as (
    update public.desktop_logins l set claimed_at = now()
    where l.code = p_code and l.approved_at > p_since and l.claimed_at is null
    returning l.user_id, l.telegram_id, l.device
  ), session as (
    insert into public.desktop_sessions (user_id, telegram_id, device, token_hash)
    select login.user_id, login.telegram_id, login.device, p_token_hash from login
    returning desktop_sessions.user_id, desktop_sessions.telegram_id, desktop_sessions.device
  )
  select session.user_id, session.telegram_id, session.device from session;
$$;
revoke execute on function public.desktop_claim(text, text, timestamptz) from public, anon, authenticated;
