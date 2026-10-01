-- Куда писать наши дела: пока человек не выбрал сам, это календарь, где больше всего его событий
-- (по названию «Календарь» у iCloud часто лежит пустой календарь, а жизнь — в «Домашнем»).
alter table public.calendar_accounts add column default_manual boolean not null default false;
