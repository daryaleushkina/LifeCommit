-- Черновик жалобы в боте (/bug): дописать текст и вложение одним запросом. Альбом скриншотов приходит несколькими
-- апдейтами почти одновременно — «прочитать, дописать, записать» из Worker'а теряло бы часть. Здесь строка черновика
-- заперта (for update) от чтения до записи, так что параллельные апдейты идут по очереди.
-- Текст — до p_max_text символов, вложений — не больше p_max_files. Тот же скриншот второй раз не кладём (он уже есть).
-- Ответ: null — черновика нет (отправлен или отменён, пока шло сообщение); {dropped, files} — не взяли ли вложение
-- (места нет) и сколько их теперь.
create function public.append_feedback_draft(p_user bigint, p_text text, p_attachment jsonb, p_max_text integer, p_max_files integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  d public.feedback_drafts;
  dropped boolean := false;
begin
  select * into d from public.feedback_drafts f where f.user_id = p_user for update;
  if not found then
    return null;
  end if;
  if p_attachment is not null and not d.attachments @> jsonb_build_array(p_attachment) then
    if jsonb_array_length(d.attachments) >= p_max_files then
      dropped := true;
    else
      d.attachments := d.attachments || jsonb_build_array(p_attachment);
    end if;
  end if;
  update public.feedback_drafts
  set text = left(case when coalesce(p_text, '') = '' then text when text = '' then p_text else text || E'\n' || p_text end, p_max_text),
      attachments = d.attachments,
      updated_at = now()
  where user_id = p_user;
  return jsonb_build_object('dropped', dropped, 'files', jsonb_array_length(d.attachments));
end
$$;

revoke execute on function public.append_feedback_draft from public, anon, authenticated;
