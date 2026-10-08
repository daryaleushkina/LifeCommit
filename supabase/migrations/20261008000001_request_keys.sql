-- Ключ повтора (04.10.2026, решение владелицы: нажали «Добавить» — добавиться должно всё, без дублей).
-- Голосовое «Добавить всё» само повторяет не дошедшее; ответ мог потеряться уже после записи, и повтор с тем же
-- ключом не должен создать вторую строку. Ключ строит Worker: «<id человека>:<ключ клиента>» — у каждого свой.
-- Пусто — обычное добавление (уникальность NULL не ограничивает). Код, который колонку не пишет, работает как раньше.
alter table public.todos add column request_key text unique;
alter table public.tasks add column request_key text unique;
alter table public.group_items add column request_key text unique;

-- Привычка, её цель и подзадачи — одна транзакция. Обрыв HTTP после COMMIT безопасен:
-- повтор вернёт прежний id; сбой до COMMIT откатит всё, включая ключ повтора.
-- Блокировка пользователя сериализует добавления: параллельные пачки не обходят лимит.
create function public.insert_tasks(p_user bigint, p_day date, p_tasks jsonb, p_limit integer)
returns bigint[]
language plpgsql
set search_path = ''
as $$
declare
  t jsonb;
  v_task_id bigint;
  ids bigint[] := '{}';
  active_count integer;
begin
  perform 1 from public.users where id = p_user for update;
  if not found then raise exception 'no_session'; end if;
  if p_limit is not null then
    select count(*) into active_count from public.tasks
      where user_id = p_user and archived_at is null and challenge_id is null;
  end if;

  for t in select value from jsonb_array_elements(p_tasks) loop
    select id into v_task_id from public.tasks
      where user_id = p_user and request_key = t->>'request_key';
    if v_task_id is null then
      if p_limit is not null and active_count >= p_limit then
        raise exception 'task_limit';
      end if;
      insert into public.tasks (
        user_id, title, emoji, kind, unit, step, schedule, weekdays, per_week,
        visibility, last_slip_on, position, request_key
      ) values (
        p_user, t->>'title', t->>'emoji', t->>'kind', t->>'unit', (t->>'step')::integer,
        t->>'schedule', (t->>'weekdays')::smallint, (t->>'per_week')::smallint,
        t->>'visibility', (t->>'last_slip_on')::date, (t->>'position')::integer, t->>'request_key'
      ) returning id into v_task_id;
      insert into public.task_goals (task_id, effective_from, target)
        values (v_task_id, p_day, (t->>'target')::numeric);
      insert into public.task_subtasks (task_id, title, position)
        select v_task_id, value, (ordinality - 1)::integer
        from jsonb_array_elements_text(t->'subtasks') with ordinality;
      active_count := active_count + 1;
    end if;
    ids := array_append(ids, v_task_id);
  end loop;
  return ids;
end;
$$;
revoke execute on function public.insert_tasks(bigint, date, jsonb, integer) from public, anon, authenticated;
grant execute on function public.insert_tasks(bigint, date, jsonb, integer) to service_role;
