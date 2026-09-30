import { useContext, useState, type ReactNode } from 'react';
import { openTelegramLink, popup, requestWriteAccess } from '@tma.js/sdk-react';
import type { HeatDay, UserSettings } from '../../shared/types';
import { api } from '../api';
import type { Theme } from '../App';
import { MonthCalendar, YearMap, monthOf, shiftMonth, yearStart } from '../components/Heatmap';
import { SelectRow } from '../components/Picker';
import { LangContext, useT } from '../i18n';

/** Страница донатов в Tribute (открывается внутри Telegram). */
const SUPPORT_URL = 'https://t.me/tribute/app?startapp=dRk2';

const Chevron = () => (
  <svg className="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9.5 6l6 6-6 6" />
  </svg>
);

const Sun = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
  </svg>
);

const Moon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);

/** Время напоминания: «выкл» и каждый час с 6 до 23. */
const REMIND_HOURS = Array.from({ length: 18 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`);
const DAY_END_HOURS = [0, 1, 2, 3, 4, 5, 6];

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
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  // Месяц и год собираем сами: в русской локали «long + numeric» даёт «сентябрь 2026 г.».
  const monthName = (m: string, width: 'long' | 'short') => new Date(`${m}-15T12:00:00`).toLocaleDateString(locale, { month: width }).replace('.', '');
  const monthLabel = `${monthName(month, 'long')} ${month.slice(0, 4)}`;
  const from = monthOf(yearStart(heat.today));
  const yearLabel = `${monthName(from, 'short')} ${from.slice(0, 4)} — ${monthName(monthOf(heat.today), 'short')} ${heat.today.slice(0, 4)}`;

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
        {/* Строка с периодом есть в обоих видах — блок не прыгает при переключении. */}
        <div className="month-nav">
          <button aria-label={t.prevMonth} hidden={view === 'year'} disabled={offset <= -MONTHS_BACK} onClick={() => setOffset(offset - 1)}>
            ‹
          </button>
          <span>{view === 'month' ? monthLabel : yearLabel}</span>
          <button aria-label={t.nextMonth} hidden={view === 'year'} disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
            ›
          </button>
        </div>
        <p className="big-number">{t.activeDays(active)}</p>
        {/* Оба вида лежат в одной клетке сетки: высота блока всегда по большему из них. */}
        <div className="views">
          <div className={view === 'month' ? '' : 'off'}>
            <MonthCalendar days={heat.days} today={heat.today} month={month} />
          </div>
          <div className={view === 'year' ? '' : 'off'}>
            <YearMap days={heat.days} today={heat.today} />
          </div>
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
        <SelectRow
          grid
          label={t.reminders}
          value={user.remind_evening ?? ''}
          options={[{ value: '', label: t.off }, ...REMIND_HOURS.map((h) => ({ value: h, label: h }))]}
          onChange={(v) => void save({ remind_evening: v || null })}
        />
        <SelectRow
          grid
          label={t.dayEnds}
          value={user.day_start_hour}
          options={DAY_END_HOURS.map((h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))}
          onChange={(v) => void save({ day_start_hour: v })}
        />
        <SelectRow
          label={t.privacy}
          value={user.profile_mode}
          options={[
            { value: 'closed', label: t.closed },
            { value: 'open', label: t.open },
          ]}
          onChange={(v) => void save({ profile_mode: v })}
        />
        <div className="row">
          <span className="label">{t.theme}</span>
          <div className="theme-toggle" role="radiogroup" aria-label={t.theme}>
            <button role="radio" aria-checked={theme === 'light'} aria-label={t.themes.light} className={theme === 'light' ? 'on' : ''} onClick={() => onTheme('light')}>
              <Sun />
            </button>
            <button role="radio" aria-checked={theme === 'dark'} aria-label={t.themes.dark} className={theme === 'dark' ? 'on' : ''} onClick={() => onTheme('dark')}>
              <Moon />
            </button>
          </div>
        </div>
        <SelectRow
          label={t.language}
          value={user.language_code === 'en' ? 'en' : 'ru'}
          options={[
            { value: 'ru', label: 'Русский' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(v) => void save({ language_code: v })}
        />
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
