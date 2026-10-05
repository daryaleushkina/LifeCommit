import { useEffect, useState, type ReactNode } from 'react';
import { openTelegramLink, popup, requestWriteAccess } from '@tma.js/sdk-react';
import { heatLevel, type HeatDay, type Person, type UserSettings } from '../../shared/types';
import { api, type DesktopSession } from '../api';
import { isDesktop, sessionLost } from '../desktop/session';
import type { Theme } from '../App';
import { HeatCard, useMonthName } from '../components/HeatCard';
import { monthOf, shiftMonth } from '../components/Heatmap';
import { FeedbackSheet } from '../components/FeedbackSheet';
import { Avatar } from '../components/groupUi';
import { SelectRow, Sheet, TimeRow } from '../components/Picker';
import { useT } from '../i18n';
import type { SumRow, Template } from '../share/draw';
import type { SummaryItem } from '../../shared/summary';
import { ShareSheet } from '../share/ShareSheet';

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

interface Props {
  user: UserSettings;
  onUser: (u: UserSettings) => void;
  heat: { today: string; days: HeatDay[] };
  theme: Theme;
  onTheme: (theme: Theme) => void;
}

export function Profile({ user, onUser, heat, theme, onTheme }: Props): ReactNode {
  const t = useT();
  const [view, setView] = useState<'month' | 'year'>('month');
  // Сдвиг от текущего месяца: 0 — этот, -1 — прошлый.
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Заблокированные (друзья, 03.10.2026): строка видна, только если кто-то есть; там же — «Разблокировать».
  const [blocked, setBlocked] = useState<Person[]>([]);
  const [blockedOpen, setBlockedOpen] = useState(false);
  // Сервер не разблокировал — человек возвращается в список, в шторке строка ошибки.
  const [unblockError, setUnblockError] = useState(false);
  // Компьютеры, где вошли (приложение для Mac, браузер): строка видна в Telegram, только если такие есть.
  const desktop = isDesktop();
  const [computers, setComputers] = useState<DesktopSession[]>([]);
  useEffect(() => {
    // Не загрузилось — строки нет, как и без компьютеров; в консоль — чтобы сбой был виден.
    if (!desktop) api.desktopSessions().then(setComputers, (e: unknown) => console.warn('desktop sessions failed', e));
  }, [desktop]);
  useEffect(() => {
    api.blocks().then(setBlocked, () => {});
  }, []);
  const unblock = async (p: Person) => {
    setUnblockError(false);
    const at = blocked.findIndex((x) => x.id === p.id);
    setBlocked((cur) => cur.filter((x) => x.id !== p.id));
    try {
      await api.unblock(p.id);
    } catch {
      // На прежнее место в списке.
      setBlocked((cur) => [...cur.slice(0, at), p, ...cur.slice(at)]);
      setUnblockError(true);
    }
  };

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

  const logoutEverywhere = async () => {
    if (!popup.show.isAvailable()) return;
    const answer = await popup.show({ message: t.desktop.logoutAllConfirm, buttons: [{ id: 'out', type: 'destructive', text: t.desktop.logoutAll }, { type: 'cancel' }] });
    if (answer !== 'out') return;
    try {
      await api.logoutEverywhere();
      setComputers([]);
    } catch {
      setError(true);
    }
  };

  const logout = async () => {
    if (!popup.show.isAvailable()) return;
    const answer = await popup.show({ message: t.desktop.logoutConfirm, buttons: [{ id: 'out', type: 'destructive', text: t.desktop.logoutOk }, { type: 'cancel' }] });
    if (answer !== 'out') return;
    try {
      await api.logout();
    } catch {
      setError(true);
      return;
    }
    sessionLost();
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
  const monthName = useMonthName();
  const monthLabel = `${monthName(month, 'long')} ${month.slice(0, 4)}`;
  // Итог по всем целям за открытый месяц и за год (круг 23) — подгружаем заранее, «Поделиться» открывается сразу.
  const year = heat.today.slice(0, 4);
  const [monthSum, setMonthSum] = useState<{ month: string; items: SummaryItem[] } | null>(null);
  const [yearSum, setYearSum] = useState<SummaryItem[] | null>(null);
  useEffect(() => {
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
    let alive = true;
    api.summary(`${month}-01`, last < heat.today ? last : heat.today).then((items) => alive && setMonthSum({ month, items }), () => {});
    return () => {
      alive = false;
    };
  }, [month, heat.today]);
  useEffect(() => {
    api.summary(`${year}-01-01`, heat.today).then(setYearSum, () => {});
  }, [year, heat.today]);
  const sumRows = (items: SummaryItem[]): SumRow[] =>
    items.slice(0, 8).map((i) => ({
      n: t.num(i.total),
      u: i.kind === 'count' ? (i.unit ?? '') : i.kind === 'check' ? t.share.sumTimes(i.total) : t.share.sumDaysWithout(i.total),
      t: i.title,
      months: i.months,
    }));

  /** «214 дней работы над собой в 2026» (20H — двенадцать месяцев, 20I — тёмная, весь год сеткой). */
  const yearTemplates = (): Template[] => {
    const score = new Map(heat.days.map((d) => [d.day, d.score]));
    const level = (day: string) => (day > heat.today ? 0 : heatLevel(score.get(day) ?? 0));
    const n = heat.days.filter((d) => d.day.startsWith(year) && d.score > 0).length;
    /** Месяц «YYYY-MM»: сдвиг первого дня от понедельника и уровни карты по дням. */
    const monthData = (m: string) => {
      const first = new Date(`${m}-01T00:00:00Z`);
      const count = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate();
      return {
        name: monthName(m, 'short'),
        lead: (first.getUTCDay() + 6) % 7,
        levels: Array.from({ length: count }, (_, d) => level(`${m}-${String(d + 1).padStart(2, '0')}`)),
      };
    };
    const months = Array.from({ length: 12 }, (_, i) => monthData(`${year}-${String(i + 1).padStart(2, '0')}`));
    const all = months.flatMap((m) => m.levels);
    // Месяц — тот, что открыт в профиле (02.10.2026, просьба владелицы: «и по месяцам — 4 варианта»).
    const mi = Number(month.slice(5)) - 1;
    const shownMonth = monthData(month);
    const inMonth = heat.days.filter((d) => d.day.startsWith(month) && d.day <= heat.today && d.score > 0).length;
    const monthDays: Template[] = [
      { kind: 'month-heat', big: `${t.num(inMonth)} ${t.share.days(inMonth)}`, caption: t.share.workMonth(mi), lead: shownMonth.lead, levels: shownMonth.levels, weekdays: t.weekdaysShort, footer: t.share.footer },
      { kind: 'month-dark', title: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1), big: t.num(inMonth), caption: t.share.workDays(inMonth), lead: shownMonth.lead, levels: shownMonth.levels, footer: t.share.footer },
    ];
    // Итог по всем целям: месяц — 23A–D, год — 23F; без отметок за период картинок итога нет.
    const mRows = monthSum?.month === month ? sumRows(monthSum.items) : [];
    const monthTitle = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
    if (mRows.length) {
      monthDays.push(
        { kind: 'sum-list', title: t.share.myMonth(mi), rows: mRows, footer: t.share.footer },
        { kind: 'sum-poster', title: t.share.monthName(mi), rows: mRows, footer: t.share.footer },
        { kind: 'sum-bento', title: monthTitle, big: `${t.num(inMonth)} ${t.share.days(inMonth)}`, caption: t.share.workWord, levels: shownMonth.levels, rows: mRows, footer: t.share.footer },
        { kind: 'sum-neon', title: monthTitle, big: t.num(inMonth), caption: t.share.workDays(inMonth), rows: mRows, footer: t.share.footer },
      );
    }
    const yearDays: Template[] = [
      { kind: 'year', big: `${t.num(n)} ${t.share.days(n)}`, caption: t.share.workYear(year), months, footer: t.share.footer },
      { kind: 'year-dark', big: t.num(n), caption: t.share.workDays(n), levels: all, footer: t.share.footer },
    ];
    const yRows = sumRows(yearSum ?? []);
    if (yRows.length) yearDays.push({ kind: 'sum-year', big: `${t.num(n)} ${t.share.days(n)}`, caption: t.share.workYear(year), rows: yRows, footer: t.share.footer });
    // Первыми — то, что сейчас открыто: «Месяц» или «Год».
    return view === 'month' ? [...monthDays, ...yearDays] : [...yearDays, ...monthDays];
  };

  return (
    <>
      {sharing && <ShareSheet templates={yearTemplates()} onClose={() => setSharing(false)} />}
      <header className="profile-head">
        {user.photo_url ? <img className="avatar" src={user.photo_url} alt="" /> : <div className="avatar">{user.first_name[0]}</div>}
        <div>
          <h1>{user.first_name}</h1>
          {user.username && <p className="muted">@{user.username}</p>}
        </div>
        {/* Поделиться годом: «N дней работы над собой». */}
        <button className="icon-btn" aria-label={t.share.open} onClick={() => setSharing(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
          </svg>
        </button>
      </header>

      <HeatCard days={heat.days} today={heat.today} view={view} onView={setView} offset={offset} onOffset={setOffset} />

      {error && <p className="error">{t.error}</p>}

      <section className="card">
        {!user.bot_chat_ok && (
          <button className="row" onClick={() => void allowBot()}>
            <span className="label">{t.allowBot}</span>
            <Chevron />
          </button>
        )}
        <TimeRow allowOff label={t.reminders} value={user.remind_evening} onChange={(v) => void save({ remind_evening: v })} />
        <TimeRow
          label={t.dayEnds}
          value={`${String(user.day_start_hour).padStart(2, '0')}:00`}
          minuteStep={60}
          maxHour={12}
          onChange={(v) => v && void save({ day_start_hour: Number(v.slice(0, 2)) })}
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
        {blocked.length > 0 && (
          <button className="row" onClick={() => setBlockedOpen(true)}>
            <span className="label">{t.fr.blocked}</span>
            <span className="value">{t.num(blocked.length)}</span>
            <Chevron />
          </button>
        )}
        {computers.length > 0 && (
          <button className="row" onClick={() => void logoutEverywhere()}>
            <span className="label">{t.desktop.computers}</span>
            <span className="value">{t.num(computers.length)}</span>
            <Chevron />
          </button>
        )}
      </section>

      {blockedOpen && (
        <Sheet title={t.fr.blocked} onClose={() => setBlockedOpen(false)}>
          {unblockError && (
            <p className="error" onClick={() => setUnblockError(false)}>
              {t.error}
            </p>
          )}
          {blocked.map((p) => (
            <div key={p.id} className="person-row">
              <Avatar member={{ id: p.id, name: p.first_name, photo: p.photo_url }} size={40} />
              <span className="friend-text">
                <b>{p.first_name}</b>
                {p.username && <small>@{p.username}</small>}
              </span>
              <button className="act small" onClick={() => void unblock(p)}>
                {t.fr.unblock}
              </button>
            </div>
          ))}
        </Sheet>
      )}

      {feedbackOpen && <FeedbackSheet theme={theme} onClose={() => setFeedbackOpen(false)} />}

      <section className="card">
        {/* Жалобы (docs/feedback.md): текст, голос, скриншоты — владелице. */}
        <button className="row" aria-haspopup="dialog" onClick={() => setFeedbackOpen(true)}>
          <span className="label">{t.fb.open}</span>
          <Chevron />
        </button>
        <button className="row" onClick={() => openTelegramLink.ifAvailable(SUPPORT_URL)}>
          <span className="label">{t.support}</span>
          <svg className="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 16L16 8M9 8h7v7" />
          </svg>
        </button>
      </section>

      {desktop && (
        <button className="quiet-link logout" onClick={() => void logout()}>
          {t.desktop.logout}
        </button>
      )}
      {/* Удалить аккаунт можно только из Telegram (ключ компьютера живёт долго — необратимое ему не доверяем). */}
      {!desktop && (
        <button className="quiet-link" onClick={() => void deleteAccount()}>
          {t.deleteAccount}
        </button>
      )}
    </>
  );
}
