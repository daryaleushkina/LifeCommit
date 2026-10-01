import { useState, type ReactNode } from 'react';
import type { Todo } from '../../shared/types';
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
  onSave: (edit: TodoEdit) => void;
  /** Нет — это черновик из голосового разбора: его убирают крестиком в списке. */
  onDelete?: () => void;
  onClose: () => void;
}

/** Правка дела: название, день («Сегодня» / «Завтра» в одно касание, остальное — календарём) и время. */
export function TodoSheet({ title: initialTitle, day: initialDay, time: initialTime, today, recurring, source, onSave, onDelete, onClose }: Props): ReactNode {
  const t = useT();
  const [title, setTitle] = useState(initialTitle);
  // Переехавшее со вчера дело показываем как сегодняшнее: прошлым днём его уже не поставить.
  const [day, setDay] = useState(!recurring && initialDay < today ? today : initialDay);
  const [time, setTime] = useState(initialTime);
  const tomorrow = addDays(today, 1);
  const valid = title.trim().length > 0;

  return (
    <Sheet title={t.todo.edit} onClose={onClose}>
      <input className="sheet-input" value={title} maxLength={120} aria-label={t.todo.edit} onChange={(e) => setTitle(e.target.value)} />
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
      </div>
      {source && <p className="sheet-note">{source === 'apple' ? t.todo.fromApple : t.todo.fromGoogle}</p>}
      <button
        className="act primary wide"
        disabled={!valid}
        onClick={() => {
          onSave({ title: title.trim(), day, time });
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
          {t.todo.delete}
        </button>
      )}
    </Sheet>
  );
}
