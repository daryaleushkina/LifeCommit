import type { ReactNode } from 'react';
import type { AbstainStatus, DayMode, TodayTask } from '../../shared/types';
import { useT } from '../i18n';

export interface LogChange {
  value: number | null;
  status?: AbstainStatus;
}

interface Props {
  task: TodayTask;
  mode: DayMode;
  onLog: (change: LogChange) => void;
  onEdit: () => void;
}

/** Цель с учётом «минималки» на тяжёлый день. */
export function effectiveTarget(task: TodayTask, mode: DayMode): number {
  return mode === 'minimum' && task.kind === 'count' && task.min_target ? task.min_target : task.target;
}

export function isDone(task: TodayTask, mode: DayMode): boolean {
  switch (task.kind) {
    case 'count':
      return task.value >= effectiveTarget(task, mode);
    case 'check':
      return task.value >= 1;
    case 'limit':
      return task.logged && task.value <= task.target;
    case 'abstain':
      return task.status === 'clean';
  }
}

export function TaskCard({ task, mode, onLog, onEdit }: Props): ReactNode {
  const t = useT();
  const target = effectiveTarget(task, mode);
  const done = isDone(task, mode);
  const progress = task.kind === 'count' ? Math.min(1, task.value / target) : done ? 1 : 0;

  const head = (
    <button className="task-head" onClick={onEdit}>
      <span className="task-emoji" aria-hidden>
        {task.emoji ?? '•'}
      </span>
      <span className="task-title">{task.title}</span>
      {task.schedule === 'per_week' && task.per_week && (
        <span className="task-meta">{t.weekProgress(task.week_done + (task.logged ? 1 : 0), task.per_week)}</span>
      )}
    </button>
  );

  if (task.kind === 'check') {
    return (
      <article className={`task${done ? ' done' : ''}`}>
        {head}
        <button
          className={`check${done ? ' on' : ''}`}
          aria-pressed={done}
          aria-label={task.title}
          onClick={() => onLog({ value: done ? null : 1 })}
        >
          ✓
        </button>
      </article>
    );
  }

  if (task.kind === 'abstain') {
    return (
      <article className={`task${done ? ' done' : ''}`}>
        {head}
        <div className="pair">
          <button
            className={`chip${task.status === 'clean' ? ' on' : ''}`}
            onClick={() => onLog({ value: null, status: task.status === 'clean' ? null : 'clean' })}
          >
            💪 {t.clean}
          </button>
          <button
            className={`chip quiet${task.status === 'slip' ? ' on-quiet' : ''}`}
            onClick={() => onLog({ value: null, status: task.status === 'slip' ? null : 'slip' })}
          >
            {t.slip}
          </button>
        </div>
        {task.status === 'slip' && <p className="task-note">{t.slipKind}</p>}
      </article>
    );
  }

  // count и limit: счётчик с кнопкой шага.
  const over = task.kind === 'limit' && task.value > task.target;
  const minus = () => {
    const next = task.value - task.step;
    onLog({ value: next > 0 ? next : task.kind === 'limit' && task.logged && task.value > 0 ? 0 : null });
  };
  return (
    <article className={`task${done ? ' done' : ''}${over ? ' over' : ''}`}>
      {head}
      <div className="counter">
        <button className="round" aria-label="−" disabled={!task.logged} onClick={minus}>
          −
        </button>
        <div className="count-value">
          <strong>{task.value}</strong>
          <span className="muted">
            {task.kind === 'limit' ? ' ≤ ' : ' / '}
            {target} {task.unit ?? ''}
          </span>
        </div>
        {task.kind === 'count' ? (
          <>
            <button className="round primary" onClick={() => onLog({ value: task.value + task.step })}>
              +{task.step}
            </button>
            <button className="chip" disabled={done} onClick={() => onLog({ value: target })}>
              {t.all}
            </button>
          </>
        ) : (
          <>
            <button className="round" onClick={() => onLog({ value: task.value + task.step })}>
              +{task.step}
            </button>
            <button
              className={`chip${done ? ' on' : ''}`}
              disabled={task.logged}
              onClick={() => onLog({ value: task.value })}
            >
              ✓
            </button>
          </>
        )}
      </div>
      {task.kind === 'count' && (
        <div className="bar" aria-hidden>
          <i style={{ transform: `scaleX(${progress})` }} />
        </div>
      )}
      {over && <p className="task-note">{t.overLimit}</p>}
    </article>
  );
}
