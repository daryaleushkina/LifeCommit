-- Дневной лимит голосовых разборов на человека: квоты Gemini и Workers AI общие на всех,
-- один активный человек не должен выбрать их за остальных. Считаются и мини-апп, и сообщения боту.
create table public.voice_usage (
  user_id bigint not null references public.users (id) on delete cascade,
  day     date not null,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.voice_usage enable row level security;

-- Взять одну попытку из дневного лимита (день — по UTC, как и квоты моделей).
-- true — можно разбирать; false — на сегодня попытки кончились.
create function public.take_voice_quota(p_user bigint, p_limit integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  taken boolean;
begin
  insert into public.voice_usage as v (user_id, day, count)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set count = v.count + 1
  where v.count < p_limit
  returning true into taken;
  return coalesce(taken, false);
end
$$;

revoke execute on function public.take_voice_quota from public, anon, authenticated;
