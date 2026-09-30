-- Упрощение по итогам дизайна (30.09.2026):
-- «Тяжёлый день» (минимум) и глобальная пауза убраны — вместо паузы дело откладывается в архив.
-- Донаты звёздами убраны — поддержка через внешнюю страницу Tribute.

drop function if exists public.user_heatmap(bigint, date, date);
drop function if exists public.goal_on(bigint, date);
drop function if exists public.log_score(text, numeric, text, numeric, numeric, text);

drop table public.user_days;
drop table public.donations;
alter table public.task_goals drop column min_target;
alter table public.task_templates drop column min_target;

create function public.log_score(p_kind text, p_value numeric, p_status text, p_target numeric)
returns numeric
language sql immutable
set search_path = ''
as $$
  select case p_kind
    when 'count' then least(1, p_value / nullif(p_target, 0))
    when 'check' then case when p_value >= 1 then 1 else 0 end
    when 'limit' then case when p_value <= p_target then 1 else 0 end
    when 'abstain' then case when p_status = 'clean' then 1 else 0 end
    else 0
  end
$$;

create function public.goal_on(p_task bigint, p_day date)
returns table (target numeric)
language sql stable
set search_path = ''
as $$
  select g.target
  from public.task_goals g
  where g.task_id = p_task and g.effective_from <= p_day
  order by g.effective_from desc
  limit 1
$$;

-- Тепловая карта: сумма вкладов за день (1 дело = до 1.0). Архивные дела учитываются.
create function public.user_heatmap(p_user bigint, p_from date, p_to date)
returns table (day date, score numeric)
language sql stable
set search_path = ''
as $$
  select l.day, sum(coalesce(public.log_score(t.kind, l.value, l.status, g.target), 0)) as score
  from public.task_logs l
  join public.tasks t on t.id = l.task_id
  left join lateral public.goal_on(l.task_id, l.day) g on true
  where l.user_id = p_user and l.day between p_from and p_to
  group by l.day
  order by l.day
$$;

revoke execute on function public.log_score, public.goal_on, public.user_heatmap from public, anon, authenticated;
