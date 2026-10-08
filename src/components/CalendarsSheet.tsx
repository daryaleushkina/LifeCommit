import { Fragment, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { openLink, popup } from '@tma.js/sdk-react';
import { api, ApiError, type CalendarAccount } from '../api';
import { caches, googleUrlFresh, load as fetchInto } from '../caches';
import { useT } from '../i18n';
import { SelectRow, Sheet } from './Picker';

const APPLE_ID_URL = 'https://account.apple.com/account/manage';

/** «обновлено 3 мин назад» */
export function syncedLabel(t: ReturnType<typeof useT>, iso: string | null): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min)) return '';
  return t.cal.synced(min < 1 ? t.cal.justNow : min < 60 ? t.cal.minutesAgo(min) : min < 1440 ? t.cal.hoursAgo(Math.floor(min / 60)) : t.cal.daysAgo(Math.floor(min / 1440)));
}

type AccountAction = 'destination' | 'disconnect' | `collection:${string}`;
interface ActionFeedback {
  failed: AccountAction | null;
  onStart: () => void;
  onFailed: (action: AccountAction) => void;
}

function ActionError({ onClear }: { onClear: () => void }): ReactNode {
  const t = useT();
  return <p className="error" role="alert" onClick={onClear}>{t.error}</p>;
}

interface Props {
  onClose: () => void;
  /** Подключили, отключили или выключили календарь — дела надо перечитать. */
  onChanged: () => void;
  /** Код подключения Google из t.me/…?startapp=gcal_<код>: вход закончился, подключение заканчиваем здесь. */
  googlePending?: string;
}

/**
 * Код подключения уходит на сервер один раз за жизнь страницы: он одноразовый, а шторку могут закрыть и открыть снова
 * (или React в разработке смонтирует её дважды) — повтор получил бы «ссылка устарела». Не дошёл (нет связи) — забываем:
 * пока код жив, его можно отправить снова.
 */
const finishing = new Map<string, Promise<{ fresh: boolean }>>();

/**
 * Код подключения не принят: что сказать человеку. Использован или устарел, а Google уже подключён (открыли ту же
 * ссылку ещё раз) — молчим; не подключён — «Ссылка устарела»; прочее — «Не достучался до Google».
 */
export function finishErrorText(t: ReturnType<typeof useT>, e: unknown, accounts: CalendarAccount[] | null): string | null {
  if (!(e instanceof ApiError && (e.code === 'pending_not_found' || e.code === 'pending_expired'))) return t.cal.errGoogle;
  const google = accounts?.find((a) => a.provider === 'google');
  return google && (google.status === 'ok' || google.status === 'setup') ? null : t.cal.googleLinkExpired;
}

/**
 * Календари: Google и Apple. Google подключается входом Google в браузере (внутри Telegram он не работает),
 * после возврата человек выбирает, какие календари забирать. Apple — паролем приложения: объясняем по шагам,
 * основной пароль не просим. Подключённый показывает, когда обновлялся, какие календари забирать
 * и даёт отключить; если календарь перестал пускать — просит подключить заново.
 */
export function CalendarsSheet({ onClose, onChanged, googlePending }: Props): ReactNode {
  const t = useT();
  // Подключённые календари знаем с запуска — шторка сразу открывается такой, какая есть, без перескоков.
  const [accounts, setAccountsState] = useState<CalendarAccount[] | null>(caches.accounts);
  const setAccounts: SetAccounts = (next) =>
    setAccountsState((cur) => {
      const v = typeof next === 'function' ? next(cur) : next;
      caches.accounts = v;
      return v;
    });
  const [form, setForm] = useState(false);
  // Сервер не сохранил правку (что забирать, куда писать, отключить) — на экране как было, здесь строка ошибки.
  const [failed, setFailed] = useState(false);
  const [failedAction, setFailedAction] = useState<{ id: number; action: AccountAction } | null>(null);
  const clearActionError = () => setFailedAction(null);
  const feedback = (account: CalendarAccount): ActionFeedback => ({
    failed: failedAction?.id === account.id ? failedAction.action : null,
    onStart: clearActionError,
    onFailed: (action) => setFailedAction({ id: account.id, action }),
  });
  // Адрес входа Google: null — ещё грузится, '' — Google на сервере не настроен.
  const [googleUrl, setGoogleUrl] = useState<string | null>(googleUrlFresh());
  const load = () => fetchInto.accounts().then(setAccounts, () => setAccounts((cur) => cur ?? []));
  const loadUrl = () => {
    caches.googleUrl = null;
    return fetchInto.googleUrl().then(setGoogleUrl);
  };
  // Вернулись из входа Google с кодом — заканчиваем подключение: сервер примет код только от того, кто начал вход.
  const [finishError, setFinishError] = useState<string | null>(null);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  const notified = useRef(false);
  useEffect(() => {
    if (!googlePending) return;
    let alive = true;
    let run = finishing.get(googlePending);
    if (!run) {
      const sent = api.finishGoogle(googlePending);
      finishing.set(googlePending, sent);
      sent.catch(() => finishing.delete(googlePending));
      run = sent;
    }
    // Список — заново, а не тот запрос, что ушёл при открытии шторки: он мог прочитать базу до подключения.
    const reread = async () => {
      await fetchInto.accounts().catch(() => null);
      return fetchInto.accounts();
    };
    run.then(
      async ({ fresh }) => {
        // Подключили заново — события могли поменяться (экран «Календарь» ещё открыт, даже если шторку закрыли);
        // новое ждёт выбора календарей, забирать пока нечего.
        if (!fresh && !notified.current) {
          notified.current = true;
          onChangedRef.current();
        }
        try {
          const list = await reread();
          // Функцией, как setAccounts: React применит её после обновлений от более ранних ответов, и в кэше останется она.
          if (alive)
            setAccountsState(() => {
              caches.accounts = list;
              return list;
            });
        } catch (e) {
          console.warn('calendars reload after google finish failed', e);
          if (alive) setFailed(true);
        }
      },
      async (e: unknown) => {
        console.warn('google finish failed', e);
        const list = await reread().catch(() => caches.accounts);
        if (!alive) return;
        if (list)
          setAccountsState(() => {
            caches.accounts = list;
            return list;
          });
        setFinishError(finishErrorText(t, e, list));
      },
    );
    return () => {
      alive = false;
    };
  }, [googlePending, t]);

  useEffect(() => {
    void load();
    if (googleUrlFresh() === null) void loadUrl();
    // Вернулись из браузера после входа Google — показать, что подключилось (и обновить ссылку: она живёт 15 минут).
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void load();
      void loadUrl();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const apple = accounts?.find((a) => a.provider === 'apple');
  const google = accounts?.find((a) => a.provider === 'google');
  // Новые дела пишутся в подключённый последним (список приходит по порядку подключения).
  const destination = accounts?.filter((a) => a.status === 'ok' && a.default_url).at(-1);

  if (form) {
    return (
      <AppleForm
        login={apple?.login ?? ''}
        onDone={() => {
          setForm(false);
          void load();
          onChanged();
        }}
        onClose={() => setForm(false)}
      />
    );
  }

  const changed = () => {
    setFailed(false);
    clearActionError();
    void load();
    onChanged();
  };
  // Ссылку открываем прямо из нажатия: так Telegram считает её ответом на жест.
  const signInGoogle = () => googleUrl && openLink.ifAvailable(googleUrl);

  return (
    <Sheet title={t.cal.sheetTitle} onClose={onClose}>
      <p className="sheet-note first">{t.cal.sheetHint}</p>
      {failed && (
        <p className="error" onClick={() => setFailed(false)}>
          {t.error}
        </p>
      )}
      {finishError && (
        <p className="error" onClick={() => setFinishError(null)}>
          {finishError}
        </p>
      )}
      <div className={`provider${!google && googleUrl === '' ? ' off' : ''}`}>
        <span className="provider-logo google">G</span>
        <span className="provider-text">
          <b>{t.cal.google}</b>
          {accounts !== null && google && <small>{google.status === 'ok' ? `${t.cal.connected} · ${syncedLabel(t, google.last_sync_at)}` : google.status === 'setup' ? t.cal.googleSetup : google.login}</small>}
          {accounts !== null && !google && googleUrl !== '' && <small>{t.cal.googleNeeds}</small>}
        </span>
        {/* Ссылка входа ещё не пришла — кнопка уже на месте, просто пока не нажимается. */}
        {accounts !== null && !google && googleUrl !== '' && (
          <button className="provider-go" disabled={!googleUrl} onClick={signInGoogle}>
            {t.cal.connect}
          </button>
        )}
        {accounts !== null && !google && googleUrl === '' && <span className="provider-soon">{t.cal.googleSoon}</span>}
      </div>
      {accounts !== null && !google && googleUrl !== '' && <p className="sheet-note">{t.cal.googleUnverified}</p>}
      {google?.status === 'error' && <div className="cal-warn">{t.cal.syncError}</div>}
      {google?.status === 'auth_failed' && (
        <div className="cal-warn">
          {t.cal.googleExpired}{' '}
          {googleUrl && (
            <button className="inline-link" onClick={signInGoogle}>
              {t.cal.reconnect}
            </button>
          )}
        </div>
      )}
      {google?.status === 'setup' && <GoogleSetup account={google} setAccounts={setAccounts} onDone={changed} {...feedback(google)} />}
      {google && google.status !== 'setup' && <AccountSettings account={google} name={t.cal.google} isDestination={destination?.id === google.id} setAccounts={setAccounts} onChanged={changed} {...feedback(google)} />}

      <div className="provider">
        <span className="provider-logo apple">A</span>
        <span className="provider-text">
          <b>{t.cal.apple}</b>
          {/* Пока список грузится, не говорим «не подключено» — это было бы неправдой. */}
          {accounts !== null && <small>{apple ? (apple.status === 'ok' ? `${t.cal.connected} · ${syncedLabel(t, apple.last_sync_at)}` : apple.login) : t.cal.appleNeeds}</small>}
        </span>
        {accounts !== null && !apple && (
          <button className="provider-go" onClick={() => setForm(true)}>
            {t.cal.connect}
          </button>
        )}
      </div>

      {apple?.status === 'error' && <div className="cal-warn">{t.cal.syncError}</div>}
      {apple?.status === 'auth_failed' && (
        <div className="cal-warn">
          {t.cal.authFailed}{' '}
          <button className="inline-link" onClick={() => setForm(true)}>
            {t.cal.newPassword}
          </button>
        </div>
      )}

      {apple && <AccountSettings account={apple} name={t.cal.apple} isDestination={destination?.id === apple.id} setAccounts={setAccounts} onChanged={changed} {...feedback(apple)} />}
    </Sheet>
  );
}

type SetAccounts = Dispatch<SetStateAction<CalendarAccount[] | null>>;

/** Включить или выключить календарь: на экране сразу, сервер догоняет; не сохранил — вернуть как было. */
function useToggle(account: CalendarAccount, setAccounts: SetAccounts, feedback: ActionFeedback, onChanged?: () => void) {
  const pending = useRef(new Set<string>());
  const set = (url: string, enabled: boolean) =>
    setAccounts((list) => list?.map((a) => (a.id === account.id ? { ...a, collections: a.collections.map((x) => (x.url === url ? { ...x, enabled } : x)) } : a)) ?? list);
  return async (url: string, enabled: boolean) => {
    if (pending.current.has(url)) return;
    pending.current.add(url);
    feedback.onStart();
    set(url, enabled);
    try {
      await api.toggleCollection(account.id, url, enabled);
    } catch {
      set(url, !enabled);
      feedback.onFailed(`collection:${url}`);
      return;
    } finally {
      pending.current.delete(url);
    }
    onChanged?.();
  };
}

function CollectionToggles({ account, onToggle, failed, onStart }: { account: CalendarAccount; onToggle: (url: string, enabled: boolean) => void } & Pick<ActionFeedback, 'failed' | 'onStart'>): ReactNode {
  return (
    <div className="card flat">
      {account.collections.map((c) => (
        <Fragment key={c.url}>
          <label className="row toggle-row">
            <span className="cal-color" style={{ background: c.color ?? 'var(--heat-2)' }} aria-hidden />
            <span className="label">{c.name}</span>
            <input type="checkbox" className="switch" checked={c.enabled} onChange={(e) => onToggle(c.url, e.target.checked)} />
          </label>
          {failed === `collection:${c.url}` && <ActionError onClear={onStart} />}
        </Fragment>
      ))}
    </div>
  );
}

/** Подключённый календарь: куда пишем наши дела (только у того, куда пишем сейчас), что забирать, отключить. */
function AccountSettings({
  account,
  name,
  isDestination,
  setAccounts,
  onChanged,
  failed,
  onStart,
  onFailed,
}: {
  account: CalendarAccount;
  name: string;
  isDestination: boolean;
  setAccounts: SetAccounts;
  onChanged: () => void;
} & ActionFeedback): ReactNode {
  const t = useT();
  const toggle = useToggle(account, setAccounts, { failed, onStart, onFailed }, onChanged);
  const writable = account.collections.filter((c) => c.writable);
  const disconnecting = useRef(false);
  const [busy, setBusy] = useState(false);

  const disconnect = async () => {
    if (disconnecting.current) return;
    disconnecting.current = true;
    setBusy(true);
    onStart();
    try {
      if (popup.show.isAvailable()) {
        const answer = await popup.show({ message: t.cal.disconnectConfirm, buttons: [{ id: 'off', type: 'destructive', text: t.cal.disconnect }, { type: 'cancel' }] });
        if (answer !== 'off') return;
      }
      await api.disconnectCalendar(account.provider);
      onChanged();
    } catch {
      onFailed('disconnect');
    } finally {
      disconnecting.current = false;
      setBusy(false);
    }
  };

  const setDestination = async (url: string) => {
    onStart();
    const prev = account.default_url;
    const set = (default_url: string | null) => setAccounts((list) => list?.map((a) => (a.id === account.id ? { ...a, default_url } : a)) ?? list);
    set(url);
    try {
      await api.setDefaultCalendar(account.id, url);
    } catch {
      set(prev);
      onFailed('destination');
      return;
    }
    onChanged();
  };

  return (
    <>
      {isDestination && writable.length > 0 && (
        <div className="card flat">
          <SelectRow
            label={t.cal.writeTo}
            value={account.default_url ?? ''}
            options={writable.map((c) => ({ value: c.url, label: c.name }))}
            onChange={(url) => void setDestination(url)}
          />
        </div>
      )}
      {failed === 'destination' && <ActionError onClear={onStart} />}
      {account.collections.length > 0 && (
        <>
          <h3 className="sheet-subtitle">{t.cal.whatToTake}</h3>
          <CollectionToggles account={account} onToggle={(url, on) => void toggle(url, on)} failed={failed} onStart={onStart} />
        </>
      )}
      <button className="quiet-link warn" disabled={busy} onClick={() => void disconnect()}>
        {t.cal.disconnectOf(name)}
      </button>
      {failed === 'disconnect' && <ActionError onClear={onStart} />}
    </>
  );
}

/** Google только что подключили: какие календари забирать. События приходят после «Готово». */
function GoogleSetup({ account, setAccounts, onDone, ...feedback }: { account: CalendarAccount; setAccounts: SetAccounts; onDone: () => void } & ActionFeedback): ReactNode {
  const t = useT();
  const toggle = useToggle(account, setAccounts, feedback);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(false);
    try {
      await api.confirmGoogle(account.id);
      onDone();
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <>
      <p className="sheet-note">{t.cal.googleChoose}</p>
      <CollectionToggles account={account} onToggle={(url, on) => void toggle(url, on)} failed={feedback.failed} onStart={feedback.onStart} />
      {error && <p className="error">{t.cal.errGoogle}</p>}
      <button className="act primary wide" disabled={busy || !account.collections.some((c) => c.enabled)} onClick={() => void confirm()}>
        {busy ? t.cal.connecting : t.done}
      </button>
    </>
  );
}

/** Подключение Apple: три шага, кнопка на сайт Apple ID, почта и пароль приложения. */
function AppleForm({ login: initialLogin, onDone, onClose }: { login: string; onDone: () => void; onClose: () => void }): ReactNode {
  const t = useT();
  const [login, setLogin] = useState(initialLogin);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.connectApple(login, password);
      onDone();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setError(code === 'apple_auth' ? t.cal.errAuth : code === 'apple_bad_input' ? t.cal.errInput : t.cal.errNet);
      setBusy(false);
    }
  };

  return (
    <Sheet title={t.cal.appleTitle} onClose={onClose}>
      <p className="sheet-note first">{t.cal.appleHint}</p>
      <ol className="steps">
        {t.cal.appleSteps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {/* Ссылку открываем прямо из нажатия: так Telegram считает её ответом на жест. */}
      <button className="inline-link center" onClick={() => openLink.ifAvailable(APPLE_ID_URL)}>
        {t.cal.openAppleId} ↗
      </button>
      <input className="sheet-input" type="email" inputMode="email" autoComplete="username" placeholder={t.cal.appleLogin} aria-label={t.cal.appleLogin} value={login} onChange={(e) => setLogin(e.target.value)} />
      <input
        className="sheet-input"
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t.cal.applePassword}
        aria-label={t.cal.applePassword}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button className="act primary wide" disabled={busy || !login.includes('@') || password.replace(/[\s-]/g, '').length < 12} onClick={() => void submit()}>
        {busy ? t.cal.connecting : t.cal.connect}
      </button>
    </Sheet>
  );
}
