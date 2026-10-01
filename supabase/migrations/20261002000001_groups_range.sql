-- Дела групп за период (02.10.2026): для вкладки «Календарь» и раздела «Скоро» на экране группы.
-- groups_today отдаёт только сегодняшнее — дела на завтра и дальше было не увидеть нигде.
-- Отметки — за весь период (с днём), first_done — когда разовое дело сделали впервые (дальше не переезжает).
create or replace function public.groups_range(p_user bigint, p_from date, p_to date)
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
        'target', i.target, 'unit', i.unit, 'goal_until', i.goal_until, 'total', null,
        'first_done', (select min(k.day) from public.group_item_marks k where k.item_id = i.id),
        'marks', coalesce((select json_agg(json_build_object('user_id', k.user_id, 'at', k.done_at, 'day', k.day))
                           from public.group_item_marks k where k.item_id = i.id and k.day between p_from and p_to), '[]'::json)
      ) order by i.position, i.id)
      from public.group_items i
      where i.group_id = g.id and i.archived_at is null and i.mode <> 'goal'
        and i.day <= p_to and (i.rrule is not null or i.day >= p_from or i.mode <> 'event')
    ), '[]'::json)
  ) order by m.joined_at), '[]'::json)
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.user_id = p_user and g.archived_at is null
$$;
revoke execute on function public.groups_range from public, anon, authenticated;
