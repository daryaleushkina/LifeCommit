-- Жалобы пользователей (docs/feedback.md, этап 1 — приём). Человек сообщает о проблеме боту (/bug) или из приложения,
-- жалоба ложится сюда, владелице приходит сообщение; разбирать будет рутина Claude Code (этапы 2–3).
create table public.feedback (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references public.users (id) on delete cascade,
  source       text not null check (source in ('bot', 'app')),
  -- Что с ней: новая → (рутина) подозрительная / вопрос владелице / чинится / ждёт кнопки / выкачена / не баг / повтор.
  status       text not null default 'new'
               check (status in ('new', 'suspicious', 'asked', 'fixing', 'awaiting_deploy', 'deployed', 'wontfix', 'duplicate')),
  -- Очищенный текст человека и расшифровка голоса.
  text         text not null default '',
  -- [{kind: 'tg_photo', file_id}] из бота, [{kind: 'storage', path}] из приложения (bucket feedback).
  attachments  jsonb not null default '[]'::jsonb,
  -- Что приложило приложение: версия, платформа, экран и т. п.
  context      jsonb,
  -- false — человек не нажал «Отправить», жалоба ушла сама через 10 минут (возможно, не баг).
  confirmed    boolean not null default true,
  -- Тот же текст от того же человека за сутки — не новая жалоба, а +1 здесь.
  dup_count    integer not null default 0,
  duplicate_of bigint references public.feedback (id) on delete set null,
  summary      text,
  pr_url       text,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);
create index feedback_user_created on public.feedback (user_id, created_at desc);
create index feedback_created on public.feedback (created_at);
alter table public.feedback enable row level security;

-- Жалоба боту, пока её собирают: после /bug сообщения копятся здесь до «Отправить» или 10 минут тишины.
create table public.feedback_drafts (
  user_id           bigint primary key references public.users (id) on delete cascade,
  chat_id           bigint not null,
  text              text not null default '',
  attachments       jsonb not null default '[]'::jsonb,
  -- Сообщение бота с кнопками «Отправить» / «Отмена» — убрать кнопки, когда жалоба ушла.
  prompt_message_id bigint,
  updated_at        timestamptz not null default now()
);
create index feedback_drafts_updated on public.feedback_drafts (updated_at);
alter table public.feedback_drafts enable row level security;

-- Принять жалобу. Лимиты на человека (за час и за сутки) и на проект (за сутки по UTC) и повтор того же текста —
-- в одной транзакции со вставкой: две одновременные отправки не проходят лимит вдвоём.
-- Ответ: {result: 'ok', id} | {result: 'duplicate', id} (+1 у старой) | {result: 'limit'} | {result: 'project_limit'}.
create function public.submit_feedback(
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

  if key <> '' then
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

revoke execute on function public.submit_feedback from public, anon, authenticated;
