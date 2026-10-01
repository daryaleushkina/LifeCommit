-- Бот в чате группы (01.10.2026): одно сообщение «Сегодня в группе» на день — его редактируем после
-- каждой отметки, а не шлём новые; утренний список и вечерний итог — не чаще раза в день.
alter table public.groups
  add column tg_today_msg_id  bigint,
  add column tg_today_day     date,
  add column tg_morning_day   date,
  add column tg_digest_day    date;
create index groups_tg_chat_idx on public.groups (tg_chat_id) where tg_chat_id is not null;
