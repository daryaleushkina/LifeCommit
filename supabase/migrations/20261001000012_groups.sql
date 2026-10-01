-- Группы (01.10.2026): семья, команда, пара — общие дела, отметки, общие цели, бот в чате.
-- Архитектура — docs/groups-architecture.md. «Команды» из первой схемы никто не использовал:
-- переименовываем их в группы и достраиваем, чтобы не держать две похожие сущности.

alter table public.teams rename to groups;
alter table public.team_members rename to group_members;
alter table public.group_members rename column team_id to group_id;
alter table public.invites rename column team_id to group_id;
alter table public.challenges rename column team_id to group_id;
alter table public.challenge_participants rename column team_id to group_id;
alter index public.teams_owner_idx rename to groups_owner_idx;
alter index public.team_members_user_idx rename to group_members_user_idx;
alter index public.invites_team_idx rename to invites_group_idx;

alter table public.groups
  add column kind              text not null default 'other' check (kind in ('family', 'sport', 'pair', 'friends', 'work', 'other')),
  add column color             text,
  add column tg_chat_title     text,
  add column admins_only_edit  boolean not null default false,  -- дела заводят только owner/admin
  add column chat_digest       boolean not null default true,   -- вечерний итог в чат
  add column chat_reminders    boolean not null default true,   -- напоминания о несделанном в чат
  add column archived_at       timestamptz;
alter table public.groups alter column rating_enabled set default false;

alter table public.group_members add column muted boolean not null default false; -- мне напоминания этой группы не слать

-- Ссылка-приглашение живёт неделю.
alter table public.invites add column expires_at timestamptz;

-- Групповое дело: один тип на все четыре режима «Кто делает».
create table public.group_items (
  id            bigint generated always as identity primary key,
  group_id      bigint not null references public.groups (id) on delete cascade,
  created_by    bigint references public.users (id) on delete set null,
  title         text not null check (length(title) between 1 and 120),
  mode          text not null check (mode in ('one', 'assign', 'goal', 'event')),
  -- расписание, как у дел: разовое — day; повторяющееся — rrule от day
  day           date not null,
  time          time,
  duration_min  integer check (duration_min between 1 and 20160),
  rrule         text,
  exdates       date[] not null default '{}',
  due_day       date,                                   -- «купить корм до пятницы»
  -- кто делает (assign, event)
  assignees     bigint[] not null default '{}',
  all_members   boolean not null default false,         -- «Все»: и те, кто вступит потом
  rotate        boolean not null default false,         -- по очереди среди assignees
  -- общая цель (goal)
  target        numeric check (target > 0),
  unit          jsonb,                                   -- {type, forms[3], currency, icon} или null — «27 из 40»
  goal_until    date,
  position      integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  check (mode <> 'goal' or target is not null)
);
create index group_items_group_idx on public.group_items (group_id) where archived_at is null;

-- «Сделано»: у каждого своё; «кто-то один» и «по очереди» закрываются одной отметкой на день (solo).
create table public.group_item_marks (
  item_id   bigint not null references public.group_items (id) on delete cascade,
  day       date not null,
  user_id   bigint not null references public.users (id) on delete cascade,
  solo      boolean not null default false,
  done_at   timestamptz not null default now(),
  primary key (item_id, day, user_id)
);
create unique index group_item_marks_solo_idx on public.group_item_marks (item_id, day) where solo;
create index group_item_marks_user_day_idx on public.group_item_marks (user_id, day);

-- Вклады в общую цель.
create table public.group_goal_entries (
  id          bigint generated always as identity primary key,
  item_id     bigint not null references public.group_items (id) on delete cascade,
  user_id     bigint not null references public.users (id) on delete cascade,
  amount      numeric not null check (amount > 0 and amount < 1e12),
  day         date not null,
  created_at  timestamptz not null default now()
);
create index group_goal_entries_item_idx on public.group_goal_entries (item_id);

-- Единицы целей, которые узнала нейросеть: один раз на всех (docs/groups-goals.md).
create table public.goal_units_learned (
  stem        text primary key,                        -- основа слова, «лид»
  unit        jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.group_items enable row level security;
alter table public.group_item_marks enable row level security;
alter table public.group_goal_entries enable row level security;
alter table public.goal_units_learned enable row level security;

-- Карта: отметка групповых дел зеленит день того, кто сделал (мероприятия и вклады в цель — нет).
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
    union all
    select m.day, 1 from public.group_item_marks m
    where m.user_id = p_user and m.day between p_from and p_to
  ) s
  group by s.day
  order by s.day
$$;
revoke execute on function public.user_heatmap from public, anon, authenticated;

-- Группы на «Сегодня»: мои группы, их живые дела и отметки за день — одним вызовом.
-- Кому какое дело показывать (очередь, «Все», назначенные), считает Worker (shared/groups.ts).
create or replace function public.groups_today(p_user bigint, p_day date)
returns json
language sql stable
set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
    'id', g.id, 'title', g.title, 'kind', g.kind, 'color', g.color, 'role', m.role,
    'members', (select json_agg(json_build_object('id', u.id, 'name', u.first_name, 'photo', u.photo_url) order by gm.joined_at)
                from public.group_members gm join public.users u on u.id = gm.user_id where gm.group_id = g.id),
    'items', coalesce((select json_agg(json_build_object(
        'id', i.id, 'title', i.title, 'mode', i.mode, 'day', i.day, 'time', to_char(i.time, 'HH24:MI'),
        'duration_min', i.duration_min, 'rrule', i.rrule, 'exdates', i.exdates, 'due_day', i.due_day,
        'assignees', i.assignees, 'all_members', i.all_members, 'rotate', i.rotate,
        'target', i.target, 'unit', i.unit, 'goal_until', i.goal_until,
        'total', case when i.mode = 'goal' then (select coalesce(sum(e.amount), 0) from public.group_goal_entries e where e.item_id = i.id) end,
        'marks', coalesce((select json_agg(json_build_object('user_id', k.user_id, 'at', k.done_at)) from public.group_item_marks k where k.item_id = i.id and k.day = p_day), '[]'::json)
      ) order by i.position, i.id)
      from public.group_items i
      where i.group_id = g.id and i.archived_at is null
        and (i.rrule is not null or i.mode = 'goal' or i.day = p_day or (i.day < p_day and i.mode <> 'event'
             and not exists (select 1 from public.group_item_marks k where k.item_id = i.id)))
    ), '[]'::json)
  ) order by m.joined_at), '[]'::json)
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.user_id = p_user and g.archived_at is null
$$;
revoke execute on function public.groups_today from public, anon, authenticated;
