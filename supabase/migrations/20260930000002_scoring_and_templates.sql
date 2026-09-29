-- Подсчёт «зелёности» дня и видимость, плюс стартовые шаблоны задач.

-- Вклад одной отметки в день: 0..1. Частичное выполнение засчитывается.
create or replace function public.log_score(
  p_kind text, p_value numeric, p_status text,
  p_target numeric, p_min_target numeric, p_day_mode text
) returns numeric
language sql immutable
set search_path = ''
as $$
  select case p_kind
    when 'count' then least(1, p_value / nullif(
      case when p_day_mode = 'minimum' and p_min_target is not null then p_min_target else p_target end, 0))
    when 'check' then case when p_value >= 1 then 1 else 0 end
    when 'limit' then case when p_value <= p_target then 1 else 0 end
    when 'abstain' then case when p_status = 'clean' then 1 else 0 end
    else 0
  end
$$;

-- Цель задачи на конкретный день (последняя с effective_from <= day).
create or replace function public.goal_on(p_task bigint, p_day date)
returns table (target numeric, min_target numeric)
language sql stable
set search_path = ''
as $$
  select g.target, g.min_target
  from public.task_goals g
  where g.task_id = p_task and g.effective_from <= p_day
  order by g.effective_from desc
  limit 1
$$;

-- Тепловая карта: сумма вкладов за день (абсолютная, 1 задача = до 1.0).
-- Архивные задачи учитываются: история не бледнеет.
create or replace function public.user_heatmap(p_user bigint, p_from date, p_to date)
returns table (day date, score numeric, mode text)
language sql stable
set search_path = ''
as $$
  with scores as (
    select l.day,
           sum(coalesce(public.log_score(t.kind, l.value, l.status, g.target, g.min_target, ud.mode), 0)) as score
    from public.task_logs l
    join public.tasks t on t.id = l.task_id
    left join public.user_days ud on ud.user_id = l.user_id and ud.day = l.day
    left join lateral public.goal_on(l.task_id, l.day) g on true
    where l.user_id = p_user and l.day between p_from and p_to
    group by l.day
  )
  select coalesce(s.day, ud.day) as day, coalesce(s.score, 0) as score, ud.mode
  from scores s
  full join (
    select d.day, d.mode from public.user_days d
    where d.user_id = p_user and d.day between p_from and p_to
  ) ud on ud.day = s.day
  order by 1
$$;

-- Может ли viewer видеть задачу владельца с данной видимостью.
create or replace function public.can_view(p_viewer bigint, p_owner bigint, p_visibility text)
returns boolean
language sql stable
set search_path = ''
as $$
  select case
    when p_viewer = p_owner then true
    when exists (
      select 1 from public.blocks b
      where (b.blocker_id = p_owner and b.blocked_id = p_viewer)
         or (b.blocker_id = p_viewer and b.blocked_id = p_owner)) then false
    when p_visibility = 'private' then false
    when p_visibility = 'public'
         and exists (select 1 from public.users u where u.id = p_owner and u.profile_mode = 'open') then true
    else exists (
      select 1 from public.follows f
      where f.follower_id = p_viewer and f.followee_id = p_owner and f.status = 'accepted')
  end
$$;

revoke execute on function public.log_score, public.goal_on, public.user_heatmap, public.can_view
  from public, anon, authenticated;

insert into public.task_templates
  (slug, emoji, title_ru, title_en, kind, unit_ru, unit_en, target, min_target, step, subtasks_ru, subtasks_en, position)
values
  ('pushups',  '💪', 'Отжимания',          'Push-ups',            'count',   'раз',     'reps',     20, 5, 5,  '{}', '{}', 1),
  ('words',    '📚', 'Выучить слова',      'Learn words',         'count',   'слов',    'words',    10, 3, 1,  '{}', '{}', 2),
  ('tidy',     '🧹', 'Убрать в квартире',  'Tidy up',             'check',   null,      null,       1, null, 1,
     '{"Посуда","Пол в одной комнате","Вынести мусор"}', '{"Dishes","Floor in one room","Take out trash"}', 3),
  ('water',    '💧', 'Выпить воды',        'Drink water',         'count',   'стаканов','glasses',  8, 4, 1,  '{}', '{}', 4),
  ('walk',     '🚶', 'Прогулка',           'Walk',                'count',   'минут',   'minutes',  30, 10, 10, '{}', '{}', 5),
  ('read',     '📖', 'Чтение',             'Reading',             'count',   'страниц', 'pages',    10, 2, 5,  '{}', '{}', 6),
  ('meds',     '💊', 'Таблетки',           'Meds',                'check',   null,      null,       1, null, 1, '{}', '{}', 7),
  ('no_smoke', '🚭', 'Не курить',          'No smoking',          'abstain', null,      null,       1, null, 1, '{}', '{}', 8),
  ('no_alco',  '🍃', 'Без алкоголя',       'No alcohol',          'abstain', null,      null,       1, null, 1, '{}', '{}', 9),
  ('social',   '📱', 'Соцсети не больше',  'Social media max',    'limit',   'минут',   'minutes',  60, null, 15, '{}', '{}', 10),
  ('sleep',    '😴', 'Лечь до полуночи',   'In bed by midnight',  'check',   null,      null,       1, null, 1, '{}', '{}', 11),
  ('stretch',  '🧘', 'Растяжка',           'Stretching',          'count',   'минут',   'minutes',  10, 3, 5,  '{}', '{}', 12);
