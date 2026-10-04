-- Черновик жалобы в боте (/bug): дописать текст и вложение одним запросом. Альбом скриншотов приходит несколькими
-- апдейтами почти одновременно — «прочитать, дописать, записать» из Worker'а теряло бы часть. Здесь всё в одном UPDATE.
-- Текст — до p_max_text символов, вложений — не больше p_max_files (лишние не берём). Черновика нет — null.
-- Ответ: {text, files, dropped} — сколько вложений теперь и не взяли ли это вложение.
create function public.append_feedback_draft(p_user bigint, p_text text, p_attachment jsonb, p_max_text integer, p_max_files integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  update public.feedback_drafts d
  set text = left(case when coalesce(p_text, '') = '' then d.text when d.text = '' then p_text else d.text || E'\n' || p_text end, p_max_text),
      attachments = case
        when p_attachment is null or jsonb_array_length(d.attachments) >= p_max_files then d.attachments
        else d.attachments || jsonb_build_array(p_attachment)
      end,
      updated_at = now()
  where d.user_id = p_user
  returning jsonb_build_object(
    'text', d.text,
    'files', jsonb_array_length(d.attachments),
    -- После UPDATE d.* — уже новые значения: вложение было, а массив не вырос — не взяли.
    'dropped', p_attachment is not null and not (d.attachments @> jsonb_build_array(p_attachment))
  ) into result;
  return result;
end
$$;

revoke execute on function public.append_feedback_draft from public, anon, authenticated;
