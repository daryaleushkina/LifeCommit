-- Отправить черновик жалобы из бота (/bug): забрать черновик и записать жалобу — одной транзакцией. Раньше Worker
-- сначала удалял черновик, потом звал submit_feedback: база споткнулась между ними — жалоба пропадала, а на повторное
-- «Отправить» человек слышал «уже отправлена». Теперь сбой откатывает всё, черновик остаётся на месте.
--   p_before null — кнопка «Отправить»: пустой черновик не трогаем (ответ {result: 'empty'}, бот подскажет).
--   p_before задан — таймер: берём, только если черновик всё ещё молчит дольше (новое сообщение могло прийти),
--                    пустой просто закрываем.
-- Ответ: null — черновика нет (уже отправлен, отменён или ожил); {result: 'empty', draft?} или ответ submit_feedback
-- (ok | duplicate | limit | project_limit) плюс draft — что было в черновике (для сообщения владелице и кнопок).
create function public.send_feedback_draft(
  p_user bigint,
  p_confirmed boolean,
  p_before timestamptz,
  p_per_hour integer,
  p_per_day integer,
  p_project_day integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  d public.feedback_drafts;
  is_empty boolean;
begin
  select * into d
  from public.feedback_drafts f
  where f.user_id = p_user and (p_before is null or f.updated_at < p_before)
  for update;
  if not found then
    return null;
  end if;
  is_empty := d.text = '' and jsonb_array_length(d.attachments) = 0;
  if is_empty and p_before is null then
    return jsonb_build_object('result', 'empty');
  end if;
  delete from public.feedback_drafts where user_id = p_user;
  if is_empty then
    return jsonb_build_object('result', 'empty', 'draft', to_jsonb(d));
  end if;
  return public.submit_feedback(p_user, 'bot', d.text, d.attachments, null, p_confirmed, p_per_hour, p_per_day, p_project_day)
    || jsonb_build_object('draft', to_jsonb(d));
end
$$;

revoke execute on function public.send_feedback_draft from public, anon, authenticated;
