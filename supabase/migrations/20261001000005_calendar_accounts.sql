-- Подключённые календари (01.10.2026): сначала Apple (iCloud CalDAV с паролем приложения), потом Google.
create table public.calendar_accounts (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references public.users (id) on delete cascade,
  provider      text not null check (provider in ('apple', 'google')),
  login         text not null,                 -- Apple ID (почта)
  secret        text not null,                 -- пароль приложения, зашифрован AES-GCM ключом Worker'а CALENDAR_KEY
  home_url      text,                          -- где у человека календари
  default_url   text,                          -- основной календарь: туда пишем наши дела
  status        text not null default 'ok' check (status in ('ok', 'auth_failed', 'error')),
  last_error    text,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, provider)
);
create index calendar_accounts_sync_idx on public.calendar_accounts (last_sync_at nulls first) where status = 'ok';
alter table public.calendar_accounts enable row level security;

-- Календари внутри подключения: какие забирать и докуда дочитали (жетон синхронизации RFC 6578).
create table public.calendar_collections (
  account_id  bigint not null references public.calendar_accounts (id) on delete cascade,
  url         text not null,
  name        text not null,
  color       text,
  enabled     boolean not null default true,
  sync_token  text,
  primary key (account_id, url)
);
alter table public.calendar_collections enable row level security;

-- Upsert дел из календаря по UID события: нужен обычный уникальный индекс (у NULL дубли разрешены).
drop index public.todos_external_idx;
create unique index todos_external_idx on public.todos (user_id, external_uid);
create index todos_external_href_idx on public.todos (user_id, external_href) where external_href is not null;
