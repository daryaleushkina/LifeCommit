-- Чтобы cron не присылал одно и то же напоминание дважды за логический день.
alter table public.users
  add column last_morning_reminder date,
  add column last_evening_reminder date;
create index users_reminders_idx on public.users (id) where bot_chat_ok and (remind_morning is not null or remind_evening is not null);
