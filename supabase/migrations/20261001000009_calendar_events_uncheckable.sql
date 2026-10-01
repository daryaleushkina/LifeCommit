-- События из календаря (01.10.2026, решение владелицы): показываются как «что сегодня будет» —
-- без галочки и без влияния на карту. Отметки, поставленные раньше, снимаем.
update public.todos set done_on = null where source is not null and done_on is not null;
delete from public.todo_done x using public.todos d where d.id = x.todo_id and d.source is not null;

-- Карта: считаются только свои дела.
create or replace function public.user_heatmap(p_user bigint, p_from date, p_to date)
returns table (day date, score numeric)
language sql stable
set search_path = ''
as $$
  select s.day, sum(s.score) as score
  from (
    select l.day, coalesce(public.log_score(t.kind, l.value, l.status, g.target), 0) as score
    from public.task_logs l
    join public.tasks t on t.id = l.task_id
    left join lateral public.goal_on(l.task_id, l.day) g on true
    where l.user_id = p_user and l.day between p_from and p_to
    union all
    select d.done_on, 1 from public.todos d
    where d.user_id = p_user and d.done_on between p_from and p_to and d.source is null
    union all
    select x.day, 1 from public.todo_done x
    join public.todos d on d.id = x.todo_id
    where x.user_id = p_user and x.day between p_from and p_to and d.source is null
  ) s
  group by s.day
  order by s.day
$$;

revoke execute on function public.user_heatmap from public, anon, authenticated;
