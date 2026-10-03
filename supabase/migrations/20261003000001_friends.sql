-- Друзья (допрос владелицы 03.10.2026). Дружба взаимная и всегда через заявку: по @username или по личной
-- постоянной ссылке (открыл — владельцу ссылки приходит заявка). Отклонённая заявка удаляется — ничего не помним.
-- Друг видит общую карту без названий и только те привычки, которые ему открыли. Только смотреть: реакций,
-- «поддержать» и лайков нет (решение владелицы 03.10.2026) — заготовки reactions/nudges остаются неиспользованными.

-- Заготовка подписок «как в Instagram» (follows) ни разу не использовалась — становится дружбой:
-- requester прислал заявку, addressee принимает; accepted — друзья. Одна пара — одна строка, в какую сторону ни просили.
alter table public.follows rename to friendships;
alter table public.friendships rename column follower_id to requester_id;
alter table public.friendships rename column followee_id to addressee_id;
alter table public.friendships rename constraint follows_pkey to friendships_pkey;
alter table public.friendships rename constraint follows_follower_id_fkey to friendships_requester_id_fkey;
alter table public.friendships rename constraint follows_followee_id_fkey to friendships_addressee_id_fkey;
alter table public.friendships rename constraint follows_status_check to friendships_status_check;
alter table public.friendships rename constraint follows_check to friendships_check;
alter index public.follows_followee_idx rename to friendships_addressee_idx;
alter table public.friendships add column accepted_at timestamptz;
-- Как пришла заявка: нашли по @username или открыли ссылку — в карточке заявки «@masha» / «по вашей ссылке».
alter table public.friendships add column via text not null default 'username' check (via in ('username', 'link'));
create unique index friendships_pair_idx on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_requester_idx on public.friendships (requester_id, status);

-- Личная ссылка «Позвать друга» (t.me/<бот>?startapp=f_<код>) и «шторку «Что показать друзьям?» уже показывали».
alter table public.users add column friend_code text unique;
alter table public.users add column friends_prompted boolean not null default false;

-- Кто видит привычку: только я или друзья. «Подписчики» и «Все» ни на что не влияли — кто их выбрал, хотел показать.
alter table public.tasks drop constraint tasks_visibility_check;
update public.tasks set visibility = 'friends' where visibility in ('followers', 'public');
alter table public.tasks add constraint tasks_visibility_check check (visibility in ('private', 'friends'));

-- Видимость теперь решает Worker (друг ли, заблокирован ли); старая проверка смотрела на подписки и «открытый профиль».
-- users.profile_mode больше не читается (переключатель убран); колонку уберём отдельной миграцией, когда в проде
-- не останется кода, который её выбирает.
drop function if exists public.can_view(bigint, bigint, text);

-- Карты сразу нескольких людей одним запросом — полоска последних дней в карточках списка друзей.
-- То же, что user_heatmap: привычки, свои сделанные дела и отметки в группах.
create or replace function public.users_heatmap(p_users bigint[], p_from date, p_to date)
returns table (user_id bigint, day date, score numeric)
language sql stable
set search_path = ''
as $$
  select s.user_id, s.day, sum(s.score) as score
  from (
    select l.user_id, l.day, coalesce(public.log_score(t.kind, l.value, l.status, g.target), 0) as score
    from public.task_logs l
    join public.tasks t on t.id = l.task_id
    left join lateral public.goal_on(l.task_id, l.day) g on true
    where l.user_id = any(p_users) and l.day between p_from and p_to
    union all
    select d.user_id, d.done_on, 1 from public.todos d
    where d.user_id = any(p_users) and d.done_on between p_from and p_to and d.source is null
    union all
    select x.user_id, x.day, 1 from public.todo_done x
    join public.todos d on d.id = x.todo_id
    where x.user_id = any(p_users) and x.day between p_from and p_to and d.source is null
    union all
    select m.user_id, m.day, 1 from public.group_item_marks m
    where m.user_id = any(p_users) and m.day between p_from and p_to
  ) s
  group by s.user_id, s.day
$$;
revoke execute on function public.users_heatmap from public, anon, authenticated;
