import { useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { addDays } from './Heatmap';
import { DateRow, Sheet } from './Picker';

interface Props {
  title: string;
  day: string;
  /** Сегодняшний логический день: раньше него дело поставить нельзя. */
  today: string;
  onSave: (title: string, day: string) => void;
  /** Нет — это черновик из голосового разбора: его убирают крестиком в списке. */
  onDelete?: () => void;
  onClose: () => void;
}

/** Правка дела: название и день. «Сегодня» и «Завтра» — в одно касание, остальное — календарём. */
export function TodoSheet({ title: initialTitle, day: initialDay, today, onSave, onDelete, onClose }: Props): ReactNode {
  const t = useT();
  const [title, setTitle] = useState(initialTitle);
  // Переехавшее со вчера дело показываем как сегодняшнее: прошлым днём его уже не поставить.
  const [day, setDay] = useState(initialDay < today ? today : initialDay);
  const tomorrow = addDays(today, 1);
  const valid = title.trim().length > 0;

  return (
    <Sheet title={t.todo.edit} onClose={onClose}>
      <input className="sheet-input" value={title} maxLength={120} aria-label={t.todo.edit} onChange={(e) => setTitle(e.target.value)} />
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
      <div className="card flat">
        {/* «Сегодня» и «Завтра» уже видны кнопками — здесь дата только для остальных дней. */}
        <DateRow label={t.todo.otherDay} value={day > tomorrow ? day : ''} placeholder={t.todo.pick} min={addDays(today, 2)} clearable={false} onChange={(v) => v && setDay(v)} />
      </div>
      <button
        className="act primary wide"
        disabled={!valid}
        onClick={() => {
          onSave(title.trim(), day);
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
