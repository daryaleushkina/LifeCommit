-- Дела для календаря (01.10.2026): время дня, повтор «как в календаре» и связь с событием в Apple/Google.
alter table public.todos
  add column time          time,                                   -- назвали время — дело на это время; нет — на весь день
  add column duration_min  integer check (duration_min between 1 and 20160), -- длительность события из календаря
  add column rrule         text,                                   -- повтор (RFC 5545); дело одно, дни считает Worker
  add column exdates       date[] not null default '{}',           -- дни, исключённые из повтора
  add column source        text check (source in ('apple', 'google')), -- пришло из календаря
  add column external_uid  text,                                   -- UID события; у наших дел — «lifecommit-<id>»
  add column external_href text,                                   -- адрес события на сервере календаря (CalDAV)
  add column external_etag text,                                   -- версия события — чтобы не затирать чужие правки
  add column calendar_url  text;                                   -- в каком календаре лежит
create unique index todos_external_idx on public.todos (user_id, external_uid) where external_uid is not null;
create index todos_user_recurring_idx on public.todos (user_id) where rrule is not null;

-- «Сделано» у повторяющегося дела — на каждый день отдельно.
create table public.todo_done (
  todo_id bigint not null references public.todos (id) on delete cascade,
  day     date not null,
  user_id bigint not null references public.users (id) on delete cascade,
  primary key (todo_id, day)
);
create index todo_done_user_day_idx on public.todo_done (user_id, day);
alter table public.todo_done enable row level security;

-- Карта: сделанные повторяющиеся дела тоже зеленят свой день.
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
    where d.user_id = p_user and d.done_on between p_from and p_to
    union all
    select x.day, 1 from public.todo_done x
    where x.user_id = p_user and x.day between p_from and p_to
  ) s
  group by s.day
  order by s.day
$$;

-- «Сегодня»: разовые дела (свои несделанные переезжают дальше, из календаря — только в свой день)
-- и все повторяющиеся (в какие дни они бывают, считает Worker).
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
                                        'time', to_char(d.time, 'HH24:MI'), 'duration_min', d.duration_min, 'source', d.source)
                      order by d.day, d.position, d.id)
      from public.todos d
      where d.user_id = p_user and d.rrule is null
        and ((d.done_on is null and d.day <= p_day and (d.source is null or d.day = p_day)) or d.done_on = p_day)
    ), '[]'::json),
    'todos_recurring', coalesce((
      select json_agg(json_build_object('id', d.id, 'title', d.title, 'day', d.day, 'rrule', d.rrule, 'exdates', d.exdates,
                                        'time', to_char(d.time, 'HH24:MI'), 'duration_min', d.duration_min, 'source', d.source,
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

revoke execute on function public.user_heatmap, public.today_screen from public, anon, authenticated;
