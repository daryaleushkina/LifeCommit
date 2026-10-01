import { useEffect, useState, type ReactNode } from 'react';
import { openLink, popup } from '@tma.js/sdk-react';
import { api, ApiError, type CalendarAccount } from '../api';
import { useT } from '../i18n';
import { Sheet } from './Picker';

const APPLE_ID_URL = 'https://account.apple.com/account/manage';

/** «обновлено 3 мин назад» */
export function syncedLabel(t: ReturnType<typeof useT>, iso: string | null): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  return t.cal.synced(min < 1 ? t.cal.justNow : t.cal.minutesAgo(min));
}

interface Props {
  onClose: () => void;
  /** Подключили, отключили или выключили календарь — дела надо перечитать. */
  onChanged: () => void;
}

/**
 * Календари: Google (скоро) и Apple. Apple подключается паролем приложения — объясняем по шагам,
 * основной пароль не просим. Подключённый показывает, когда обновлялся, какие календари забирать
 * и даёт отключить; если Apple перестал пускать — просит новый пароль.
 */
export function CalendarsSheet({ onClose, onChanged }: Props): ReactNode {
  const t = useT();
  const [accounts, setAccounts] = useState<CalendarAccount[] | null>(null);
  const [form, setForm] = useState(false);
  const load = () => api.calendars().then(setAccounts, () => setAccounts([]));
  useEffect(() => {
    void load();
  }, []);

  const apple = accounts?.find((a) => a.provider === 'apple');

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

  const disconnect = async () => {
    if (popup.show.isAvailable()) {
      const answer = await popup.show({ message: t.cal.disconnectConfirm, buttons: [{ id: 'off', type: 'destructive', text: t.cal.disconnect }, { type: 'cancel' }] });
      if (answer !== 'off') return;
    }
    await api.disconnectCalendar('apple').catch(() => {});
    void load();
    onChanged();
  };

  return (
    <Sheet title={t.cal.sheetTitle} onClose={onClose}>
      <p className="sheet-note first">{t.cal.sheetHint}</p>
      <div className="provider off">
        <span className="provider-logo google">G</span>
        <span className="provider-text">
          <b>{t.cal.google}</b>
        </span>
        <span className="provider-soon">{t.cal.googleSoon}</span>
      </div>
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

      {apple && apple.status !== 'ok' && (
        <div className="cal-warn">
          {t.cal.authFailed}{' '}
          <button className="inline-link" onClick={() => setForm(true)}>
            {t.cal.newPassword}
          </button>
        </div>
      )}

      {apple && apple.collections.length > 0 && (
        <>
          <h3 className="sheet-subtitle">{t.cal.whatToTake}</h3>
          <div className="card flat">
            {apple.collections.map((c) => (
              <label key={c.url} className="row toggle-row">
                <span className="cal-color" style={{ background: c.color ?? 'var(--heat-2)' }} aria-hidden />
                <span className="label">{c.name}</span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={c.enabled}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    setAccounts((list) => list?.map((a) => (a.id === apple.id ? { ...a, collections: a.collections.map((x) => (x.url === c.url ? { ...x, enabled } : x)) } : a)) ?? list);
                    await api.toggleCollection(apple.id, c.url, enabled).catch(() => {});
                    onChanged();
                  }}
                />
              </label>
            ))}
          </div>
        </>
      )}
      {apple && (
        <button className="quiet-link danger" onClick={() => void disconnect()}>
          {t.cal.disconnect}
        </button>
      )}
    </Sheet>
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
