-- LifeCommit: базовая схема под все этапы (v0.1–v0.4).
-- Доступ к базе только у Worker'а (секретный ключ): RLS включён на всех таблицах
-- без политик, поэтому anon/authenticated не видят ничего. Правила видимости
-- между пользователями живут в SQL-функциях и в Worker'е.

-- ───────────── Пользователи ─────────────
create table public.users (
  id              bigint primary key,               -- Telegram user id (до 52 бит)
  username        text,
  first_name      text not null default '',
  last_name       text,
  photo_url       text,
  language_code   text not null default 'ru',
  timezone        text not null default 'Europe/Moscow',
  day_start_hour  smallint not null default 4 check (day_start_hour between 0 and 12),
  profile_mode    text not null default 'closed' check (profile_mode in ('open', 'closed')),
  comments_policy text not null default 'followers' check (comments_policy in ('nobody', 'followers')),
  remind_morning  time,
  remind_evening  time default '21:00',
  bot_chat_ok     boolean not null default false,   -- человек нажал /start, бот может писать
  premium_until   timestamptz,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);
create unique index users_username_lower_idx on public.users (lower(username)) where username is not null;

-- ───────────── Задачи ─────────────
create table public.tasks (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references public.users (id) on delete cascade,
  title         text not null check (length(title) between 1 and 80),
  emoji         text,
  kind          text not null check (kind in ('count', 'check', 'limit', 'abstain')),
  unit          text,                                -- «раз», «слов», «сигарет»
  step          integer not null default 1 check (step > 0),
  schedule      text not null default 'daily' check (schedule in ('daily', 'weekdays', 'per_week')),
  weekdays      smallint not null default 127 check (weekdays between 1 and 127), -- битовая маска, пн = 1
  per_week      smallint check (per_week between 1 and 7),
  visibility    text not null default 'private' check (visibility in ('private', 'followers', 'public')),
  challenge_id  bigint,                              -- FK добавляется ниже
  position      integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  check (schedule <> 'per_week' or per_week is not null)
);
create index tasks_user_active_idx on public.tasks (user_id, position) where archived_at is null;
create index tasks_challenge_idx on public.tasks (challenge_id) where challenge_id is not null;

-- История целей: новая цель действует с effective_from, прошлые дни не пересчитываются.
create table public.task_goals (
  task_id        bigint not null references public.tasks (id) on delete cascade,
  effective_from date not null,
  target         numeric not null check (target > 0),
  min_target     numeric check (min_target > 0),      -- «минималка» на плохой день
  primary key (task_id, effective_from)
);

create table public.task_subtasks (
  id        bigint generated always as identity primary key,
  task_id   bigint not null references public.tasks (id) on delete cascade,
  position  integer not null default 0,
  title     text not null check (length(title) between 1 and 80)
);
create index task_subtasks_task_idx on public.task_subtasks (task_id, position);

-- Отметки: одна строка на задачу и логический день (день начинается в day_start_hour).
create table public.task_logs (
  task_id     bigint not null references public.tasks (id) on delete cascade,
  day         date not null,
  user_id     bigint not null references public.users (id) on delete cascade,
  value       numeric not null default 0 check (value >= 0),
  status      text check (status in ('clean', 'slip')),  -- только для abstain
  note        text check (length(note) <= 280),           -- «коммит-сообщение»
  proof_file_id text,                                     -- фото/кружок в служебном канале TG
  updated_at  timestamptz not null default now(),
  primary key (task_id, day)
);
create index task_logs_user_day_idx on public.task_logs (user_id, day);

-- Режим дня: «минималка» (плохой день) или пауза. Пауза на неделю = 7 строк.
create table public.user_days (
  user_id  bigint not null references public.users (id) on delete cascade,
  day      date not null,
  mode     text not null check (mode in ('minimum', 'pause')),
  primary key (user_id, day)
);

-- ───────────── Социальное ─────────────
create table public.follows (
  follower_id  bigint not null references public.users (id) on delete cascade,
  followee_id  bigint not null references public.users (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id, status);

create table public.blocks (
  blocker_id  bigint not null references public.users (id) on delete cascade,
  blocked_id  bigint not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.invites (
  code        text primary key,                      -- попадает в startapp
  inviter_id  bigint not null references public.users (id) on delete cascade,
  team_id     bigint,                                -- FK ниже
  challenge_id bigint,                               -- FK ниже
  created_at  timestamptz not null default now()
);
create index invites_inviter_idx on public.invites (inviter_id);

create table public.reactions (
  id          bigint generated always as identity primary key,
  user_id     bigint not null references public.users (id) on delete cascade,
  task_id     bigint not null references public.tasks (id) on delete cascade,
  day         date not null,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, task_id, day, emoji)
);
create index reactions_task_day_idx on public.reactions (task_id, day);

create table public.comments (
  id          bigint generated always as identity primary key,
  author_id   bigint not null references public.users (id) on delete cascade,
  task_id     bigint not null references public.tasks (id) on delete cascade,
  day         date not null,
  body        text not null check (length(body) between 1 and 500),
  hidden_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index comments_task_day_idx on public.comments (task_id, day);
create index comments_author_idx on public.comments (author_id);

create table public.nudges (
  from_id  bigint not null references public.users (id) on delete cascade,
  to_id    bigint not null references public.users (id) on delete cascade,
  day      date not null,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id, day)
);
create index nudges_to_idx on public.nudges (to_id, day);

-- ───────────── Команды ─────────────
create table public.teams (
  id               bigint generated always as identity primary key,
  title            text not null check (length(title) between 1 and 60),
  owner_id         bigint references public.users (id) on delete set null,
  tg_chat_id       bigint unique,                    -- групповой чат с ботом
  rating_enabled   boolean not null default true,
  live_messages    boolean not null default false,   -- сообщения в реальном времени
  comments_policy  text not null default 'members' check (comments_policy in ('nobody', 'members')),
  created_at       timestamptz not null default now()
);
create index teams_owner_idx on public.teams (owner_id);

create table public.team_members (
  team_id    bigint not null references public.teams (id) on delete cascade,
  user_id    bigint not null references public.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);

-- ───────────── Челленджи ─────────────
create table public.challenges (
  id            bigint generated always as identity primary key,
  creator_id    bigint references public.users (id) on delete set null,
  team_id       bigint references public.teams (id) on delete cascade,
  title         text not null check (length(title) between 1 and 80),
  description   text check (length(description) <= 1000),
  type          text not null check (type in (
                  'own_target', 'collective', 'same_target', 'program',
                  'chest', 'pair_quest', 'proof_window', 'team_vs_team')),
  access        text not null default 'link' check (access in ('link', 'public')),
  starts_on     date not null,
  ends_on       date not null,
  config        jsonb not null default '{}'::jsonb,  -- цели, пороги сундука, окно и т.п.
  report_count  integer not null default 0,
  hidden_at     timestamptz,                         -- автоскрытие после жалоб
  created_at    timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index challenges_public_idx on public.challenges (starts_on) where access = 'public' and hidden_at is null;
create index challenges_creator_idx on public.challenges (creator_id);
create index challenges_team_idx on public.challenges (team_id);

create table public.challenge_participants (
  challenge_id  bigint not null references public.challenges (id) on delete cascade,
  user_id       bigint not null references public.users (id) on delete cascade,
  team_id       bigint references public.teams (id) on delete set null, -- для team_vs_team
  joined_at     timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index challenge_participants_user_idx on public.challenge_participants (user_id);
create index challenge_participants_team_idx on public.challenge_participants (team_id);

alter table public.tasks
  add constraint tasks_challenge_fk foreign key (challenge_id) references public.challenges (id) on delete set null;
alter table public.invites
  add constraint invites_team_fk foreign key (team_id) references public.teams (id) on delete cascade,
  add constraint invites_challenge_fk foreign key (challenge_id) references public.challenges (id) on delete cascade;
create index invites_team_idx on public.invites (team_id);
create index invites_challenge_idx on public.invites (challenge_id);

-- ───────────── Модерация, деньги, шаблоны ─────────────
create table public.reports (
  id           bigint generated always as identity primary key,
  reporter_id  bigint references public.users (id) on delete set null,
  target_type  text not null check (target_type in ('user', 'challenge', 'comment', 'team')),
  target_id    bigint not null,
  reason       text check (length(reason) <= 500),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
create index reports_target_idx on public.reports (target_type, target_id);

create table public.donations (
  id                  bigint generated always as identity primary key,
  user_id             bigint references public.users (id) on delete set null,
  stars               integer not null check (stars > 0),
  tg_payment_charge_id text not null unique,
  created_at          timestamptz not null default now()
);
create index donations_user_idx on public.donations (user_id);

create table public.task_templates (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  emoji       text not null,
  title_ru    text not null,
  title_en    text not null,
  kind        text not null check (kind in ('count', 'check', 'limit', 'abstain')),
  unit_ru     text,
  unit_en     text,
  target      numeric not null default 1,
  min_target  numeric,
  step        integer not null default 1,
  subtasks_ru text[] not null default '{}',
  subtasks_en text[] not null default '{}',
  position    integer not null default 0
);

-- RLS: всё закрыто для anon/authenticated. Worker ходит секретным ключом.
do $$
declare t text;
begin
  foreach t in array array[
    'users','tasks','task_goals','task_subtasks','task_logs','user_days','follows','blocks',
    'invites','reactions','comments','nudges','teams','team_members','challenges',
    'challenge_participants','reports','donations','task_templates']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
