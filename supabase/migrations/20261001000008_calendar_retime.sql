-- Сменился часовой пояс человека: при следующей синхронизации перечитать календарь в новом поясе
-- и перезаписать наши дела со временем (делать это прямо в запросе входа — слишком долго).
alter table public.calendar_accounts add column retime boolean not null default false;
