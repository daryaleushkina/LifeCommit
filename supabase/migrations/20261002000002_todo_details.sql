-- Подробности событий (02.10.2026): место, ссылка на созвон, участники, описание — видны, когда событие открыли.
-- У своих дел — место из голоса («встреча с Лизой в кафе Снежинка»), оно же уходит в календарь.
alter table public.todos add column details jsonb;

-- «Сегодня» отдаёт подробности вместе с делами: открыть событие — сразу, без запроса.
create or replace function public.today_screen(p_user bigint, p_day date, p_from date)
returns json
language sql stable
set search_path = ''
as $$
  select json_build_object(
    'tasks', coalesce((
      select json_agg(x order by x.position, x.id)
      from (
        select t.id, t.title, t.emoji, t.kind, t.unit, t.step, t.schedule, t.weekdays, t.per_week,
               t.visibility, t.challenge_id, t.position, t.last_slip_on,
               (select g.target from public.task_goals g
                 where g.task_id = t.id and g.effective_from <= p_day
                 order by g.effective_from desc limit 1) as target,
               (select min(g.effective_from) from public.task_goals g
                 where g.task_id = t.id and g.effective_from <= p_day) as start,
               case when t.kind = 'abstain' then
                 (select count(*) from public.task_logs l
                   where l.task_id = t.id and l.status = 'clean' and l.day < p_day)
               else 0 end as clean_count,
               coalesce((select json_agg(json_build_object('id', s.id, 'title', s.title) order by s.position)
                 from public.task_subtasks s where s.task_id = t.id), '[]'::json) as subtasks
        from public.tasks t
        where t.user_id = p_user and t.archived_at is null
      ) x
    ), '[]'::json),
    'archived', coalesce((
      select json_agg(json_build_object('id', t.id, 'title', t.title, 'emoji', t.emoji) order by t.archived_at desc)
      from public.tasks t
      where t.user_id = p_user and t.archived_at is not null
    ), '[]'::json),
    'logs', coalesce((
      select json_agg(json_build_object('task_id', l.task_id, 'day', l.day, 'value', l.value, 'status', l.status))
      from public.task_logs l
      where l.user_id = p_user and l.day between p_from and p_day
    ), '[]'::json),
    'todos', coalesce((
      select json_agg(json_build_object('id', d.id, 'title', d.title, 'day', d.day, 'done', d.done_on is not null,
                                        'time', to_char(d.time, 'HH24:MI'), 'duration_min', d.duration_min, 'source', d.source, 'details', d.details)
                      order by d.day, d.position, d.id)
      from public.todos d
      where d.user_id = p_user and d.rrule is null
        and ((d.done_on is null and d.day <= p_day and (d.source is null or d.day = p_day)) or d.done_on = p_day)
    ), '[]'::json),
    'todos_recurring', coalesce((
      select json_agg(json_build_object('id', d.id, 'title', d.title, 'day', d.day, 'rrule', d.rrule, 'exdates', d.exdates,
                                        'time', to_char(d.time, 'HH24:MI'), 'duration_min', d.duration_min, 'source', d.source, 'details', d.details,
                                        'done', exists (select 1 from public.todo_done x where x.todo_id = d.id and x.day = p_day)))
      from public.todos d
      where d.user_id = p_user and d.rrule is not null and d.day <= p_day
    ), '[]'::json),
    'todos_later', (
      select count(*) from public.todos d
      where d.user_id = p_user and d.done_on is null and d.rrule is null and d.day > p_day
    )
  )
$$;

-- Уже забранные события — без подробностей: следующая синхронизация перечитает календари целиком.
update public.calendar_collections set sync_token = null;
