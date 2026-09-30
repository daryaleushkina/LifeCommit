-- Отказ: «когда это было в последний раз». Счёт «N дней без…» может начинаться до появления дела в приложении.
alter table public.tasks add column last_slip_on date;
