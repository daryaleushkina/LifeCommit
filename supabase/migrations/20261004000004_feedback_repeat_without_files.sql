-- Повтор того же текста за сутки — +1 у старой жалобы, но только если в новой нет скриншотов. Раньше повтор
-- определялся по одному тексту, и скриншоты, присланные вдогонку с тем же текстом («Не работает кнопка» + снимок),
-- молча выбрасывались. Остальное — как в 20261004000001.
create or replace function public.submit_feedback(
  p_user bigint,
  p_source text,
  p_text text,
  p_attachments jsonb,
  p_context jsonb,
  p_confirmed boolean,
  p_per_hour integer,
  p_per_day integer,
  p_project_day integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  key text := lower(regexp_replace(btrim(p_text), '\s+', ' ', 'g'));
  found_id bigint;
  new_id bigint;
begin
  -- Жалоб мало (потолок — сотни в сутки): одна очередь на всех проще и надёжнее, чем замки по людям.
  perform pg_advisory_xact_lock(hashtext('public.submit_feedback'));

  if key <> '' and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then
    select f.id into found_id
    from public.feedback f
    where f.user_id = p_user
      and f.created_at > now() - interval '24 hours'
      and lower(regexp_replace(btrim(f.text), '\s+', ' ', 'g')) = key
    order by f.id desc
    limit 1;
    if found_id is not null then
      update public.feedback set dup_count = dup_count + 1 where id = found_id;
      return jsonb_build_object('result', 'duplicate', 'id', found_id);
    end if;
  end if;

  if (select count(*) from public.feedback f where f.user_id = p_user and f.created_at > now() - interval '1 hour') >= p_per_hour
     or (select count(*) from public.feedback f where f.user_id = p_user and f.created_at > now() - interval '24 hours') >= p_per_day then
    return jsonb_build_object('result', 'limit');
  end if;
  if (select count(*) from public.feedback f where f.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') >= p_project_day then
    return jsonb_build_object('result', 'project_limit');
  end if;

  insert into public.feedback (user_id, source, text, attachments, context, confirmed)
  values (p_user, p_source, p_text, coalesce(p_attachments, '[]'::jsonb), p_context, p_confirmed)
  returning id into new_id;
  return jsonb_build_object('result', 'ok', 'id', new_id);
end
$$;
