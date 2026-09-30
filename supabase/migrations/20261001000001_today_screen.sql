-- Экран «Сегодня» одним запросом: раньше это были три круга до базы подряд
-- (дела и отложенные → цели, отметки, подзадачи → по счётчику на каждое «бросить»).
-- Собирает данные как есть; расписание и «N дней без…» считает Worker.
create function public.today_screen(p_user bigint, p_day date, p_from date)
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
               -- Первый день дела = самая ранняя цель.
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
    -- Отметки за неделю по всем делам человека; отложенные Worker отбросит сам.
    'logs', coalesce((
      select json_agg(json_build_object('task_id', l.task_id, 'day', l.day, 'value', l.value, 'status', l.status))
      from public.task_logs l
      where l.user_id = p_user and l.day between p_from and p_day
    ), '[]'::json)
  )
$$;

revoke execute on function public.today_screen from public, anon, authenticated;
