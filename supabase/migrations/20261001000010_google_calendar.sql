-- Google Календарь (01.10.2026). Подключение идёт через вход Google; после него человек выбирает,
-- какие календари забирать (решение владелицы), — до этого подключение в статусе setup и не синхронизируется.
alter table public.calendar_accounts drop constraint calendar_accounts_status_check;
alter table public.calendar_accounts add constraint calendar_accounts_status_check
  check (status in ('ok', 'auth_failed', 'error', 'setup'));
comment on column public.calendar_accounts.secret is 'Apple — пароль приложения, Google — refresh token; зашифровано AES-GCM ключом Worker''а CALENDAR_KEY';

-- Чужие календари Google (коллеги, праздники) можно читать, но не писать: туда наши дела не выгружаем.
alter table public.calendar_collections add column writable boolean not null default true;
