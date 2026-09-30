import { useState, type ReactNode } from 'react';
import type { AbstainStatus, TodayTask } from '../../shared/types';
import { useT } from '../i18n';

export interface LogChange {
  value: number | null;
  status?: AbstainStatus;
}

export function isDone(task: TodayTask): boolean {
  switch (task.kind) {
    case 'count':
      return task.value >= task.target;
    case 'check':
      return task.value >= 1;
    case 'abstain':
      return task.status !== null;
  }
}

/** Вклад дела в «зелёность» дня, 0..1 — та же формула, что log_score в базе. */
export function taskScore(task: TodayTask): number {
  switch (task.kind) {
    case 'count':
      return Math.min(1, task.value / task.target);
    case 'check':
      return task.value >= 1 ? 1 : 0;
    case 'abstain':
      return task.status === 'clean' ? 1 : 0;
  }
}

const Check = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const Pencil = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M13.5 6.5l3 3" />
  </svg>
);

interface Props {
  task: TodayTask;
  /** Первое несделанное дело на экране — его кнопка залита. */
  primary: boolean;
  onLog: (change: LogChange) => void;
  onEdit: () => void;
}

export function TaskCard({ task, primary, onLog, onEdit }: Props): ReactNode {
  const t = useT();
  // Тап по числу — ввод значения с клавиатуры (только цифры); null — не редактируем.
  const [draft, setDraft] = useState<string | null>(null);
  const done = isDone(task);
  const title = <h2>{task.title}</h2>;

  if (task.kind === 'abstain') {
    // Срыв счёт не обнуляет: сегодняшний день прибавляется, только если он «без».
    const cleanDays = task.clean_before + (task.status === 'clean' ? 1 : 0);
    return (
      <article className={`task stack${done ? ' done' : ''}`}>
        <button className="task-main" onClick={onEdit}>
          {title}
          {cleanDays > 0 && <span className="task-value">{t.cleanDays(cleanDays)}</span>}
        </button>
        <div className="pair" role="group" aria-label={task.title}>
          <button
            className={`act soft${task.status === 'clean' ? ' chosen' : ''}`}
            aria-pressed={task.status === 'clean'}
            onClick={() => onLog({ value: null, status: task.status === 'clean' ? null : 'clean' })}
          >
            {t.clean}
          </button>
          <button
            className={`act outline${task.status === 'slip' ? ' chosen' : ''}`}
            aria-pressed={task.status === 'slip'}
            onClick={() => onLog({ value: null, status: task.status === 'slip' ? null : 'slip' })}
          >
            {t.slip}
          </button>
        </div>
      </article>
    );
  }

  if (task.kind === 'check') {
    return (
      <article className={`task${done ? ' done' : ''}`}>
        <button className="task-main" onClick={onEdit}>
          {title}
        </button>
        <button
          className={`act ${done ? 'soft' : 'todo'}`}
          aria-pressed={done}
          aria-label={task.title}
          onClick={() => onLog({ value: done ? null : 1 })}
        >
          <Check />
        </button>
      </article>
    );
  }

  // Количество: полоса прогресса, карандаш (ввести любое число) и галочка (сделано целиком).
  const unit = task.unit ? ` ${task.unit}` : '';
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft === '') return;
    const next = Number(draft);
    if (next === task.value) return;
    onLog({ value: next > 0 ? next : null });
  };
  const edit = () => setDraft(task.value > 0 ? String(task.value) : '');
  const rest = (
    <>
      {' '}
      {t.of} {task.target}
      {unit}
    </>
  );
  return (
    <article className={`task count${done ? ' done' : ''}`}>
      <div className="task-main">
        <button onClick={onEdit}>{title}</button>
        {draft === null ? (
          <button className="task-value" aria-label={`${task.title}: ${t.enterValue}`} onClick={edit}>
            <b>{task.value}</b>
            {rest}
          </button>
        ) : (
          <label className="task-value editing">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              aria-label={`${task.title}: ${t.enterValue}`}
              value={draft}
              placeholder={String(task.value)}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
              onFocus={(e) => e.target.select()}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setDraft(null);
              }}
            />
            {rest}
          </label>
        )}
      </div>
      <button className="act undo" aria-label={`${task.title}: ${t.enterValue}`} onClick={edit}>
        <Pencil />
      </button>
      <button
        className={`act ${done ? 'soft' : primary ? 'primary' : 'todo'}`}
        aria-pressed={done}
        aria-label={task.title}
        onClick={() => onLog({ value: done ? null : task.target })}
      >
        <Check />
      </button>
      <div className="progress" aria-hidden>
        <i style={{ width: `${Math.min(100, (task.value / task.target) * 100)}%` }} />
      </div>
    </article>
  );
}
