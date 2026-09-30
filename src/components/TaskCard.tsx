import type { ReactNode } from 'react';
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
    case 'limit':
      return task.logged && task.value <= task.target;
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
    case 'limit':
      return task.logged && task.value <= task.target ? 1 : 0;
    case 'abstain':
      return task.status === 'clean' ? 1 : 0;
  }
}

const Check = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
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
  const done = isDone(task);
  const title = <h2>{task.title}</h2>;

  if (task.kind === 'abstain') {
    return (
      <article className={`task stack${done ? ' done' : ''}`}>
        <button className="task-main" onClick={onEdit}>
          {title}
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

  // Количество и лимит: число и одна кнопка «+N».
  const over = task.kind === 'limit' && task.value > task.target;
  const unit = task.unit ? ` ${task.unit}` : '';
  const minus = () => {
    const next = task.value - task.step;
    onLog({ value: next > 0 ? next : task.kind === 'limit' ? 0 : null });
  };
  return (
    <article className={`task${done ? ' done' : ''}${over ? ' over' : ''}`}>
      <button className="task-main" onClick={onEdit}>
        {title}
        <span className="task-value">
          <b>{task.value}</b> {task.kind === 'limit' ? t.of : '/'} {task.target}
          {unit}
        </span>
      </button>
      {task.value > 0 && (
        <button className="act undo" aria-label="−" onClick={minus}>
          −
        </button>
      )}
      {task.kind === 'limit' && !task.logged && (
        <button className="act undo" aria-label={task.title} onClick={() => onLog({ value: 0 })}>
          <Check />
        </button>
      )}
      <button
        className={`act ${done && task.kind === 'count' ? 'soft' : primary && task.kind === 'count' ? 'primary' : 'outline'}`}
        onClick={() => onLog({ value: task.value + task.step })}
      >
        +{task.step}
      </button>
    </article>
  );
}
