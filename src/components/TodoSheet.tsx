import { useState, type ReactNode } from 'react';
import { openLink, openTelegramLink } from '@tma.js/sdk-react';
import type { Todo, TodoDetails } from '../../shared/types';
import { useT } from '../i18n';
import type { TodoEdit } from '../useTodos';
import { addDays } from './Heatmap';
import { DateRow, Sheet, TimeRow } from './Picker';

interface Props {
  title: string;
  day: string;
  time: string | null;
  /** Сегодняшний логический день: раньше него дело поставить нельзя. */
  today: string;
  /** Повторяющееся (из календаря): день не меняется — он задаёт, в какие дни дело бывает. */
  recurring?: boolean;
  source?: Todo['source'];
  /** Место, ссылка, участники, описание. У своих дел место можно поправить. */
  details?: TodoDetails | null;
  onSave: (edit: TodoEdit) => void;
  /** Нет — это черновик из голосового разбора: его убирают крестиком в списке. */
  onDelete?: () => void;
  onClose: () => void;
}

/** Ссылку из события открываем снаружи; ссылку Telegram — внутри Telegram. */
export function openExternal(url: string) {
  if (/^https?:\/\/t\.me\//i.test(url) && openTelegramLink.isAvailable()) return openTelegramLink(url);
  if (openLink.isAvailable()) return openLink(url);
  window.open(url, '_blank', 'noopener');
}

const mapUrl = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return (u.host + (u.pathname.length > 1 ? u.pathname : '')).replace(/^www\./, '').slice(0, 40);
  } catch {
    return url.slice(0, 40);
  }
};

/**
 * Правка дела: название, день («Сегодня» / «Завтра» в одно касание, остальное — календарём), время и место.
 * У события из календаря сверху — его подробности: где, ссылка на созвон, кто будет, описание.
 */
export function TodoSheet({ title: initialTitle, day: initialDay, time: initialTime, today, recurring, source, details, onSave, onDelete, onClose }: Props): ReactNode {
  const t = useT();
  const [title, setTitle] = useState(initialTitle);
  // Переехавшее со вчера дело показываем как сегодняшнее: прошлым днём его уже не поставить.
  const [day, setDay] = useState(!recurring && initialDay < today ? today : initialDay);
  const [time, setTime] = useState(initialTime);
  const [place, setPlace] = useState(details?.location ?? '');
  const tomorrow = addDays(today, 1);
  const valid = title.trim().length > 0;

  return (
    <Sheet title={source ? t.todo.event : t.todo.edit} onClose={onClose}>
      <input className="sheet-input" value={title} maxLength={120} aria-label={t.todo.edit} onChange={(e) => setTitle(e.target.value)} />
      {source && details && <EventDetails details={details} />}
      {recurring ? (
        <p className="sheet-note">{t.todo.repeats}</p>
      ) : (
        <div className="segmented two todo-days" role="radiogroup" aria-label={t.todo.when}>
          {[
            [today, t.todo.today],
            [tomorrow, t.todo.tomorrow],
          ].map(([value, label]) => (
            <button key={value} role="radio" aria-checked={day === value} className={day === value ? 'on' : ''} onClick={() => setDay(value!)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="card flat">
        {/* «Сегодня» и «Завтра» уже видны кнопками — здесь дата только для остальных дней. */}
        {!recurring && (
          <DateRow label={t.todo.otherDay} value={day > tomorrow ? day : ''} placeholder={t.todo.pick} min={addDays(today, 2)} clearable={false} onChange={(v) => v && setDay(v)} />
        )}
        <TimeRow label={t.todo.time} value={time} onChange={setTime} allowOff offLabel={t.todo.allDay} offAction={t.todo.noTime} initial="12:00" />
        {/* Своё дело: место можно вписать или поправить, оно уйдёт в календарь телефона. */}
        {!source && (
          <label className="row input-row">
            <span className="label">{t.todo.place}</span>
            <input value={place} maxLength={200} placeholder={t.todo.placePh} enterKeyHint="done" onChange={(e) => setPlace(e.target.value)} />
            {place.trim() && (
              <button type="button" className="row-icon" aria-label={t.todo.onMap} onClick={() => openExternal(mapUrl(place.trim()))}>
                <PinIcon />
              </button>
            )}
          </label>
        )}
      </div>
      {source &&
        (details?.open_url ? (
          <button className="inline-link center" onClick={() => openExternal(details.open_url!)}>
            {t.todo.openGoogle} ↗
          </button>
        ) : (
          <p className="sheet-note">{source === 'apple' ? t.todo.fromApple : t.todo.fromGoogle}</p>
        ))}
      <button
        className="act primary wide"
        disabled={!valid}
        onClick={() => {
          onSave({ title: title.trim(), day, time, ...(!source && { location: place.trim() }) });
          onClose();
        }}
      >
        {t.done}
      </button>
      {onDelete && (
        <button
          className="quiet-link danger"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          {source ? t.todo.deleteEvent : t.todo.delete}
        </button>
      )}
    </Sheet>
  );
}

const PinIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

/** Подробности события: только то, что есть, каждая — одной строкой; описание сворачивается. */
function EventDetails({ details: d }: { details: TodoDetails }): ReactNode {
  const t = useT();
  const [open, setOpen] = useState(false);
  const shown = d.people ?? [];
  const names = shown.slice(0, 3).join(', ');
  const rest = (d.people_count ?? shown.length + 1) - 1 - Math.min(3, shown.length);
  const longNotes = (d.notes?.length ?? 0) > 140 || (d.notes?.split('\n').length ?? 0) > 3;

  return (
    <div className="card flat event-details">
      {d.location && (
        <button className="row detail-row" onClick={() => openExternal(mapUrl(d.location!))} aria-label={`${t.todo.onMap}: ${d.location}`}>
          <PinIcon />
          <span className="detail-text">{d.location}</span>
          <Chevron />
        </button>
      )}
      {d.link && (
        <button className="row detail-row" onClick={() => openExternal(d.link!)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="6" width="13" height="12" rx="3" />
            <path d="M16 10.5l5-3v9l-5-3" />
          </svg>
          <span className="detail-text">
            <b>{/meet|zoom|teams|telemost|webex|whereby|jit\.si|jazz|ktalk|t\.me\/call|facetime/i.test(d.link) ? t.todo.join : t.todo.openLink}</b>
            <small>{hostOf(d.link)}</small>
          </span>
          <Chevron />
        </button>
      )}
      {d.people_count ? (
        <div className="row detail-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6" />
          </svg>
          <span className="detail-text">
            <b>{t.todo.people(d.people_count)}</b>
            {names && <small>{rest > 0 ? `${names} ${t.todo.andMore(rest)}` : names}</small>}
          </span>
        </div>
      ) : null}
      {d.notes && (
        <button className="row detail-row notes" disabled={!longNotes} onClick={() => setOpen(!open)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 6h14M5 11h14M5 16h9" />
          </svg>
          <span className={`detail-text${open ? '' : ' clamp'}`}>{d.notes}</span>
          {longNotes && !open && <span className="detail-more">{t.todo.more}</span>}
        </button>
      )}
    </div>
  );
}

const Chevron = () => (
  <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
