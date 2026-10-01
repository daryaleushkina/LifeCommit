-- Несколько аккаунтов Telegram — один человек (01.10.2026). Связанные аккаунты входят в того же пользователя:
-- общие привычки, дела, календари; бот пишет во все. Связь пока ставится только вручную в базе
-- (решение владелицы: сейчас — только её @darya_leushkina к @backendd_dev).
alter table public.users add column telegram_aliases bigint[] not null default '{}';
create index users_telegram_aliases_idx on public.users using gin (telegram_aliases);
comment on column public.users.telegram_aliases is 'Другие id Telegram того же человека: входят в этого пользователя';
