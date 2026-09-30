-- Разовые дела на день (01.10.2026): не повторяются, живут блоком «Дела» над привычками.
-- day — на какой логический день запланировано; несделанное тихо переезжает дальше (день не меняем:
-- по нему интерфейс пишет «со вчера»). done_on — в какой логический день сделано.
create table public.todos (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references public.users (id) on delete cascade,
  title      text not null check (length(title) between 1 and 120),
  day        date not null,
  done_on    date,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index todos_user_open_idx on public.todos (user_id, day) where done_on is null;
create index todos_user_done_idx on public.todos (user_id, done_on) where done_on is not null;
alter table public.todos enable row level security;

-- Карта: сделанное дело зеленит день так же, как привычка (1.0 за дело).
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
    select d.done_on, 1
    from public.todos d
    where d.user_id = p_user and d.done_on between p_from and p_to
  ) s
  group by s.day
  order by s.day
$$;

-- «Сегодня» вместе с делами: несделанные на сегодня и раньше, сделанные сегодня;
-- запланированные на потом — только числом (список — отдельным запросом, когда его откроют).
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
    ), '[]'::json),
    'todos', coalesce((
      select json_agg(json_build_object('id', d.id, 'title', d.title, 'day', d.day, 'done', d.done_on is not null)
                      order by d.day, d.position, d.id)
      from public.todos d
      where d.user_id = p_user and ((d.done_on is null and d.day <= p_day) or d.done_on = p_day)
    ), '[]'::json),
    'todos_later', (
      select count(*) from public.todos d
      where d.user_id = p_user and d.done_on is null and d.day > p_day
    )
  )
$$;

revoke execute on function public.user_heatmap, public.today_screen from public, anon, authenticated;
