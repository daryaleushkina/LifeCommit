import { useState, type ReactNode } from 'react';
import type { AbstainStatus, TodayTask } from '../../shared/types';
import { useT } from '../i18n';
import { KindTile } from './KindIcon';

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

/** Вклад привычки в «зелёность» дня, 0..1 — та же формула, что log_score в базе. */
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

/** «Бросить»: счёт «дней без этого» — срыв его не обнуляет, сегодня прибавляется, только если получилось. */
export const cleanDaysOf = (task: TodayTask): number => task.clean_before + (task.status === 'clean' ? 1 : 0);

const GLYPH = {
  ok: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  no: <path d="M7 7l10 10M17 7L7 17" />,
  edit: (
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </>
  ),
};

interface RoundBtnProps {
  kind: keyof typeof GLYPH;
  /** on — выбрано, dim — выбрано другое. */
  state?: 'on' | 'dim';
  label: string;
  onClick: () => void;
}

/** Круглая кнопка отметки: галочка, крестик или карандаш — везде одного размера. */
export function RoundBtn({ kind, state, label, onClick }: RoundBtnProps): ReactNode {
  return (
    <button className={`rb ${kind}${state ? ` ${state}` : ''}`} aria-label={label} aria-pressed={kind === 'edit' ? undefined : state === 'on'} onClick={onClick}>
      <svg width={kind === 'edit' ? 20 : 24} height={kind === 'edit' ? 20 : 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={kind === 'edit' ? 2 : 3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {GLYPH[kind]}
      </svg>
    </button>
  );
}

/** «Считать»: строка «12 из 20 страниц», которая по тапу превращается в поле ввода (только цифры). */
export function useCountValue(task: TodayTask, onLog: (change: LogChange) => void): { value: ReactNode; edit: () => void } {
  const t = useT();
  // null — не редактируем.
  const [draft, setDraft] = useState<string | null>(null);
  const edit = () => setDraft(task.value > 0 ? String(task.value) : '');
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft === '') return;
    const next = Number(draft);
    if (next === task.value) return;
    onLog({ value: next > 0 ? next : null });
  };
  const rest = (
    <>
      {' '}
      {t.of} {task.target}
      {task.unit ? ` ${task.unit}` : ''}
    </>
  );
  const label = `${task.title}: ${t.enterValue}`;
  const value =
    draft === null ? (
      <button className="task-value" aria-label={label} onClick={edit}>
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
          aria-label={label}
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
    );
  return { value, edit };
}

/** Кнопки «получилось / было» для «бросить»: повторный тап по выбранной снимает ответ. */
export function QuitButtons({ task, onLog }: { task: TodayTask; onLog: (change: LogChange) => void }): ReactNode {
  const t = useT();
  const pick = (status: 'clean' | 'slip') => onLog({ value: null, status: task.status === status ? null : status });
  const state = (status: 'clean' | 'slip') => (task.status === status ? 'on' : task.status ? 'dim' : undefined);
  return (
    <div className="rb-pair" role="group" aria-label={t.didIt}>
      <RoundBtn kind="no" state={state('slip')} label={t.answerNo} onClick={() => pick('slip')} />
      <RoundBtn kind="ok" state={state('clean')} label={t.answerYes} onClick={() => pick('clean')} />
    </div>
  );
}

/** Галочка «сделано целиком»: повторный тап снимает отметку. */
export function DoneButton({ task, onLog }: { task: TodayTask; onLog: (change: LogChange) => void }): ReactNode {
  const done = isDone(task);
  const full = task.kind === 'count' ? task.target : 1;
  return <RoundBtn kind="ok" state={done ? 'on' : undefined} label={task.title} onClick={() => onLog({ value: done ? null : full })} />;
}

interface Props {
  task: TodayTask;
  onLog: (change: LogChange) => void;
  /** Тап по названию — экран привычки со статистикой. */
  onOpen: () => void;
}

export function TaskCard({ task, onLog, onOpen }: Props): ReactNode {
  const t = useT();
  const count = useCountValue(task, onLog);
  const done = isDone(task);
  const title = <h2>{task.title}</h2>;

  if (task.kind === 'abstain') {
    const days = cleanDaysOf(task);
    return (
      <article className={`task${done ? ' done' : ''}`}>
        <KindTile kind="abstain" title={task.title} />
        <button className="task-main" onClick={onOpen}>
          {title}
          {/* Пока не ответили — вопрос; после ответа его место занимает счёт. */}
          <span className="task-value">{task.status === null ? t.didItShort : t.cleanDays(days)}</span>
        </button>
        <QuitButtons task={task} onLog={onLog} />
      </article>
    );
  }

  if (task.kind === 'check') {
    return (
      <article className={`task${done ? ' done' : ''}`}>
        <KindTile kind="check" title={task.title} />
        <button className="task-main" onClick={onOpen}>
          {title}
        </button>
        <DoneButton task={task} onLog={onLog} />
      </article>
    );
  }

  // Считать: полоса прогресса, карандаш (ввести любое число) и галочка (сделано целиком).
  return (
    <article className={`task count${done ? ' done' : ''}`}>
      <KindTile kind="count" title={task.title} />
      <div className="task-main">
        <button onClick={onOpen}>{title}</button>
        {count.value}
      </div>
      <div className="rb-pair">
        <RoundBtn kind="edit" label={`${task.title}: ${t.enterValue}`} onClick={count.edit} />
        <DoneButton task={task} onLog={onLog} />
      </div>
      <Progress task={task} />
    </article>
  );
}

export function Progress({ task }: { task: TodayTask }): ReactNode {
  return (
    <div className="progress" aria-hidden>
      <i style={{ width: `${Math.min(100, (task.value / task.target) * 100)}%` }} />
    </div>
  );
}
