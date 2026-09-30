import { useContext, useState, type ReactNode } from 'react';
import { openTelegramLink, popup, requestWriteAccess } from '@tma.js/sdk-react';
import type { HeatDay, UserSettings } from '../../shared/types';
import { api } from '../api';
import type { Theme } from '../App';
import { Heatmap, MonthCalendar, monthOf, shiftMonth } from '../components/Heatmap';
import { LangContext, useT } from '../i18n';

/** Страница донатов в Tribute (открывается внутри Telegram). */
const SUPPORT_URL = 'https://t.me/tribute/app?startapp=dRk2';

const Chevron = () => (
  <svg className="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9.5 6l6 6-6 6" />
  </svg>
);

interface Props {
  user: UserSettings;
  onUser: (u: UserSettings) => void;
  heat: { today: string; days: HeatDay[] };
  theme: Theme;
  onTheme: (theme: Theme) => void;
}

/** Сколько месяцев назад можно листать: столько истории загружено для карты года. */
const MONTHS_BACK = 11;

export function Profile({ user, onUser, heat, theme, onTheme }: Props): ReactNode {
  const t = useT();
  const lang = useContext(LangContext);
  const [view, setView] = useState<'month' | 'year'>('month');
  // Сдвиг от текущего месяца: 0 — этот, -1 — прошлый.
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(false);

  const save = async (patch: Partial<UserSettings>) => {
    try {
      onUser(await api.settings(patch));
    } catch {
      setError(true);
    }
  };

  const allowBot = async () => {
    if (!requestWriteAccess.isAvailable()) return;
    if ((await requestWriteAccess()) === 'allowed') {
      await api.writeAccess();
      onUser({ ...user, bot_chat_ok: true });
    }
  };

  const deleteAccount = async () => {
    if (!popup.show.isAvailable()) return;
    const answer = await popup.show({
      message: t.deleteConfirm,
      buttons: [{ id: 'delete', type: 'destructive', text: t.deleteForever }, { type: 'cancel' }],
    });
    if (answer !== 'delete') return;
    await api.deleteAccount();
    window.location.reload();
  };

  const month = shiftMonth(monthOf(heat.today), offset);
  const shown = view === 'year' ? heat.days : heat.days.filter((d) => d.day.startsWith(month));
  const active = shown.filter((d) => d.score > 0).length;
  // Месяц и год собираем сами: в русской локали «long + numeric» даёт «сентябрь 2026 г.».
  const monthLabel = `${new Date(`${month}-15T12:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { month: 'long' })} ${month.slice(0, 4)}`;

  return (
    <>
      <header className="profile-head">
        {user.photo_url ? <img className="avatar" src={user.photo_url} alt="" /> : <div className="avatar">{user.first_name[0]}</div>}
        <div>
          <h1>{user.first_name}</h1>
          {user.username && <p className="muted">@{user.username}</p>}
        </div>
      </header>

      <section className="card pad">
        <div className="segmented two">
          <button className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>
            {t.month}
          </button>
          <button className={view === 'year' ? 'on' : ''} onClick={() => setView('year')}>
            {t.year}
          </button>
        </div>
        {view === 'month' && (
          <div className="month-nav">
            <button aria-label={t.prevMonth} disabled={offset <= -MONTHS_BACK} onClick={() => setOffset(offset - 1)}>
              ‹
            </button>
            <span>{monthLabel}</span>
            <button aria-label={t.nextMonth} disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
              ›
            </button>
          </div>
        )}
        <p className="big-number" style={{ marginTop: 14 }}>
          {t.activeDays(active)}
        </p>
        <div className="year">
          {view === 'year' ? (
            <Heatmap days={heat.days} today={heat.today} weeks={53} gap={1.5} />
          ) : (
            <MonthCalendar days={heat.days} today={heat.today} month={month} weekdays={t.weekdaysShort} />
          )}
        </div>
      </section>

      {error && <p className="error">{t.error}</p>}

      <section className="card">
        {!user.bot_chat_ok && (
          <button className="row" onClick={() => void allowBot()}>
            <span className="label">{t.allowBot}</span>
            <Chevron />
          </button>
        )}
        <label className="row">
          <span className="label">{t.reminders}</span>
          <span className="value">{user.remind_evening ?? t.off}</span>
          <Chevron />
          <input type="time" value={user.remind_evening ?? ''} aria-label={t.reminders} onChange={(e) => void save({ remind_evening: e.target.value || null })} />
        </label>
        <label className="row">
          <span className="label">{t.dayEnds}</span>
          <span className="value">{String(user.day_start_hour).padStart(2, '0')}:00</span>
          <Chevron />
          <select value={user.day_start_hour} aria-label={t.dayEnds} onChange={(e) => void save({ day_start_hour: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <span className="label">{t.privacy}</span>
          <span className="value">{user.profile_mode === 'open' ? t.open : t.closed}</span>
          <Chevron />
          <select value={user.profile_mode} aria-label={t.privacy} onChange={(e) => void save({ profile_mode: e.target.value as 'open' | 'closed' })}>
            <option value="closed">{t.closed}</option>
            <option value="open">{t.open}</option>
          </select>
        </label>
        <label className="row">
          <span className="label">{t.theme}</span>
          <span className="value">{t.themes[theme]}</span>
          <Chevron />
          <select value={theme} aria-label={t.theme} onChange={(e) => onTheme(e.target.value as Theme)}>
            <option value="auto">{t.themes.auto}</option>
            <option value="light">{t.themes.light}</option>
            <option value="dark">{t.themes.dark}</option>
          </select>
        </label>
        <label className="row">
          <span className="label">{t.language}</span>
          <span className="value">{t.langName}</span>
          <Chevron />
          <select value={user.language_code} aria-label={t.language} onChange={(e) => void save({ language_code: e.target.value })}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
      </section>

      <section className="card">
        <button className="row" onClick={() => openTelegramLink.ifAvailable(SUPPORT_URL)}>
          <span className="label">{t.support}</span>
          <svg className="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 16L16 8M9 8h7v7" />
          </svg>
        </button>
      </section>

      <button className="quiet-link" onClick={() => void deleteAccount()}>
        {t.deleteAccount}
      </button>
    </>
  );
}
