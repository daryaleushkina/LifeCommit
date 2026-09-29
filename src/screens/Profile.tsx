import { useEffect, useState, type ReactNode } from 'react';
import { hapticFeedback, invoice, popup, requestWriteAccess } from '@tma.js/sdk-react';
import type { HeatDay, UserSettings } from '../../shared/types';
import { api } from '../api';
import { Heatmap } from '../components/Heatmap';
import { useT } from '../i18n';

const STAR_OPTIONS = [50, 100, 250];

export function Profile({ user, onUser }: { user: UserSettings; onUser: (u: UserSettings) => void }): ReactNode {
  const t = useT();
  const [heat, setHeat] = useState<{ today: string; days: HeatDay[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api.heatmap(371).then(setHeat, () => {});
  }, []);

  const save = async (patch: Partial<UserSettings>) => {
    try {
      onUser(await api.settings(patch));
    } catch {
      setNote(t.error);
    }
  };

  const allowBot = async () => {
    if (!requestWriteAccess.isAvailable()) return;
    const status = await requestWriteAccess();
    if (status === 'allowed') {
      await api.writeAccess();
      onUser({ ...user, bot_chat_ok: true });
    }
  };

  const pause = async (days: number) => {
    await api.setDay('pause', days);
    hapticFeedback.notificationOccurred.ifAvailable('success');
    setNote(t.pauseDays(days));
    api.heatmap(371).then(setHeat, () => {});
  };

  const donate = async (stars: number) => {
    try {
      const { link } = await api.donate(stars);
      if (!invoice.openUrl.isAvailable()) return;
      const status = await invoice.openUrl(link);
      if (status === 'paid') hapticFeedback.notificationOccurred.ifAvailable('success');
    } catch {
      setNote(t.error);
    }
  };

  const deleteAccount = async () => {
    if (!popup.show.isAvailable()) return;
    const answer = await popup.show({
      message: t.deleteConfirm,
      buttons: [{ id: 'delete', type: 'destructive', text: t.deleteAccount.split(' ')[0] ?? 'OK' }, { type: 'cancel' }],
    });
    if (answer !== 'delete') return;
    await api.deleteAccount();
    setNote(t.deleted);
    window.location.reload();
  };

  return (
    <>
      <header className="page-head row">
        {user.photo_url ? <img className="avatar" src={user.photo_url} alt="" /> : <div className="avatar">{user.first_name[0]}</div>}
        <div>
          <h1>{user.first_name}</h1>
          {user.username && <p className="muted">@{user.username}</p>}
        </div>
      </header>

      <section className="card">
        <h2 className="section-title">{t.heatTitle}</h2>
        {heat ? <Heatmap days={heat.days} today={heat.today} weeks={53} legend /> : <div className="skeleton small" />}
      </section>

      {note && (
        <p className="note" onClick={() => setNote(null)}>
          {note}
        </p>
      )}

      <section className="card list">
        <h2 className="section-title">{t.settings}</h2>
        {!user.bot_chat_ok && (
          <div className="list-row">
            <span className="small">{t.botBlocked}</span>
            <button className="chip on" onClick={() => void allowBot()}>
              {t.allowBot}
            </button>
          </div>
        )}
        <TimeRow label={t.remindMorning} value={user.remind_morning} off={t.off} onChange={(v) => void save({ remind_morning: v })} />
        <TimeRow label={t.remindEvening} value={user.remind_evening} off={t.off} onChange={(v) => void save({ remind_evening: v })} />
        <label className="list-row">
          <span>{t.dayStart}</span>
          <select value={user.day_start_hour} onChange={(e) => void save({ day_start_hour: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <div className="list-row">
          <span>{t.language}</span>
          <div className="segmented small">
            {(['ru', 'en'] as const).map((l) => (
              <button key={l} className={user.language_code === l ? 'on' : ''} onClick={() => void save({ language_code: l })}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">{t.pause}</h2>
        <p className="muted small">{t.pauseHint}</p>
        <div className="pair">
          {[1, 3, 7].map((d) => (
            <button key={d} className="chip" onClick={() => void pause(d)}>
              {t.pauseDays(d)}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">{t.support}</h2>
        <p className="muted small">{t.supportHint}</p>
        <div className="pair">
          {STAR_OPTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => void donate(s)}>
              ⭐ {s}
            </button>
          ))}
        </div>
      </section>

      <button className="btn danger-ghost" onClick={() => void deleteAccount()}>
        {t.deleteAccount}
      </button>
    </>
  );
}

function TimeRow(props: { label: string; value: string | null; off: string; onChange: (v: string | null) => void }): ReactNode {
  return (
    <label className="list-row">
      <span>{props.label}</span>
      <span className="time-input">
        <input type="time" value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value || null)} />
        {!props.value && <em className="muted">{props.off}</em>}
      </span>
    </label>
  );
}
