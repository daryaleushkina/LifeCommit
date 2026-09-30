import { useEffect, useState, type ReactNode } from 'react';
import { hapticFeedback, popup } from '@tma.js/sdk-react';
import type { Schedule, TaskInput, TaskKind, Visibility } from '../../shared/types';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { useBackButton, useMainButton, type SubmitState } from '../telegram/hooks';

const KINDS: TaskKind[] = ['count', 'check', 'limit', 'abstain'];
const SCHEDULES: Schedule[] = ['daily', 'weekdays', 'per_week'];
const VISIBILITY: Visibility[] = ['private', 'followers', 'public'];

interface Form {
  title: string;
  kind: TaskKind;
  target: number;
  unit: string;
  schedule: Schedule;
  weekdays: number;
  per_week: number;
  visibility: Visibility;
  last_slip_on: string;
}

const EMPTY: Form = {
  title: '',
  kind: 'count',
  target: 10,
  unit: '',
  schedule: 'daily',
  weekdays: 31,
  per_week: 3,
  visibility: 'private',
  last_slip_on: '',
};

/** Сегодняшняя дата устройства, YYYY-MM-DD (граница для «последний раз»; точную проверку делает сервер). */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg className="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={open ? 'M6 9.5l6 6 6-6' : 'M9.5 6l6 6-6 6'} />
  </svg>
);

interface Props {
  id: number | null;
  /** Тип цели, выбранный ещё до редактора (намерение на первом экране). */
  kind?: TaskKind;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function TaskEditor({ id, kind, onClose, onSaved }: Props): ReactNode {
  const t = useT();
  const isNew = id === null;
  const [form, setForm] = useState<Form>(kind ? { ...EMPTY, kind } : EMPTY);
  const [open, setOpen] = useState<'when' | 'who' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cleanDays, setCleanDays] = useState<number | null>(null);

  useBackButton(onClose);

  useEffect(() => {
    if (isNew) return;
    api.today().then((d) => {
      const task = d.tasks.find((x) => x.id === id);
      if (!task) return onClose();
      setForm({
        title: task.title,
        kind: task.kind,
        target: task.target,
        unit: task.unit ?? '',
        schedule: task.schedule,
        weekdays: task.weekdays,
        per_week: task.per_week ?? 3,
        visibility: task.visibility,
        last_slip_on: task.last_slip_on ?? '',
      });
      if (task.kind === 'abstain') setCleanDays(task.clean_before + (task.status === 'clean' ? 1 : 0));
    });
  }, [id, isNew, onClose]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const numeric = form.kind === 'count' || form.kind === 'limit';
  const valid = form.title.trim().length > 0 && (!numeric || form.target > 0) && (form.schedule !== 'weekdays' || form.weekdays > 0);
  const state: SubmitState = busy ? 'submitting' : valid ? 'idle' : 'blocked';

  useMainButton(isNew ? t.add : t.save, state, async () => {
    setBusy(true);
    try {
      const input: TaskInput = {
        title: form.title.trim(),
        kind: form.kind,
        target: numeric ? form.target : 1,
        unit: numeric ? form.unit.trim() || null : null,
        schedule: form.schedule,
        weekdays: form.weekdays,
        per_week: form.schedule === 'per_week' ? form.per_week : null,
        visibility: form.visibility,
        last_slip_on: form.kind === 'abstain' ? form.last_slip_on || null : null,
      };
      if (isNew) {
        await api.createTask(input);
      } else {
        const { kind: _kind, ...patch } = input;
        const res = await api.updateTask(id, patch);
        const today = (await api.today()).day;
        if (res.goal_effective_from && res.goal_effective_from > today && popup.show.isAvailable()) {
          await popup.show({ message: t.goalTomorrow, buttons: [{ type: 'ok' }] });
        }
      }
      await onSaved();
      hapticFeedback.notificationOccurred.ifAvailable('success');
      onClose();
    } catch (e) {
      setMessage(e instanceof ApiError && e.code === 'task_limit' ? t.limitReached(5) : t.error);
      setBusy(false);
    }
  });

  const postpone = async () => {
    if (id === null) return;
    await api.archiveTask(id);
    await onSaved();
    onClose();
  };

  const whenLabel = form.schedule === 'per_week' ? t.perWeek(form.per_week) : t.schedules[form.schedule];

  return (
    <main className="app-shell">
      <header className="page-head">
        <h1>{isNew ? t.newTask : t.editTask}</h1>
        {cleanDays !== null && cleanDays > 0 && <p>{t.cleanDays(cleanDays)}</p>}
      </header>

      {message && <p className="error">{message}</p>}

      <input className="title-input" value={form.title} maxLength={80} placeholder={t.titlePh[form.kind]} aria-label={t.newTask} onChange={(e) => set('title', e.target.value)} />

      {isNew && (
        <>
          <p className="field-label" id="kind-label">
            {t.kindLabel}
          </p>
          <div className="segmented" role="radiogroup" aria-labelledby="kind-label">
            {KINDS.map((k) => (
              <button key={k} role="radio" aria-checked={form.kind === k} className={form.kind === k ? 'on' : ''} onClick={() => set('kind', k)}>
                {t.kinds[k]}
              </button>
            ))}
          </div>
          <p className="field-hint">{t.kindHints[form.kind]}</p>
        </>
      )}

      <section className="card">
        {form.kind === 'abstain' && (
          <label className="row">
            <span className="label">{t.lastSlip}</span>
            <input type="date" className="date-input" max={localToday()} value={form.last_slip_on} onChange={(e) => set('last_slip_on', e.target.value)} />
          </label>
        )}
        {numeric && (
          <div className="row">
            <span className="label">{form.kind === 'limit' ? t.limitGoal : t.goal}</span>
            <div className="stepper">
              <button type="button" aria-label="−" onClick={() => set('target', Math.max(1, form.target - (form.target > 20 ? 5 : 1)))}>
                −
              </button>
              <input
                inputMode="numeric"
                value={form.target}
                aria-label={t.goal}
                onChange={(e) => set('target', Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0)))}
              />
              <button type="button" aria-label="+" onClick={() => set('target', form.target + (form.target >= 20 ? 5 : 1))}>
                +
              </button>
            </div>
            <input className="unit-input" value={form.unit} maxLength={12} placeholder={t.unitPh} aria-label="unit" onChange={(e) => set('unit', e.target.value)} />
          </div>
        )}

        <button className="row" onClick={() => setOpen(open === 'when' ? null : 'when')} aria-expanded={open === 'when'}>
          <span className="label">{t.when}</span>
          <span className="value">{whenLabel}</span>
          <Chevron open={open === 'when'} />
        </button>
        {open === 'when' && (
          <div className="sub">
            <div className="segmented three">
              {SCHEDULES.map((s) => (
                <button key={s} className={form.schedule === s ? 'on' : ''} onClick={() => set('schedule', s)}>
                  {t.schedules[s]}
                </button>
              ))}
            </div>
            {form.schedule === 'weekdays' && (
              <div className="weekdays">
                {t.weekdaysShort.map((d, i) => {
                  const on = (form.weekdays & (1 << i)) !== 0;
                  return (
                    <button key={d} className={on ? 'on' : ''} aria-pressed={on} onClick={() => set('weekdays', form.weekdays ^ (1 << i))}>
                      {d}
                    </button>
                  );
                })}
              </div>
            )}
            {form.schedule === 'per_week' && (
              <div className="stepper">
                <button type="button" aria-label="−" onClick={() => set('per_week', Math.max(1, form.per_week - 1))}>
                  −
                </button>
                <input readOnly value={form.per_week} aria-label={t.schedules.per_week} />
                <button type="button" aria-label="+" onClick={() => set('per_week', Math.min(7, form.per_week + 1))}>
                  +
                </button>
              </div>
            )}
          </div>
        )}

        <button className="row" onClick={() => setOpen(open === 'who' ? null : 'who')} aria-expanded={open === 'who'}>
          <span className="label">{t.who}</span>
          <span className="value">{t.visibility[form.visibility]}</span>
          <Chevron open={open === 'who'} />
        </button>
        {open === 'who' && (
          <div className="sub">
            <div className="segmented three">
              {VISIBILITY.map((v) => (
                <button key={v} className={form.visibility === v ? 'on' : ''} onClick={() => set('visibility', v)}>
                  {t.visibility[v]}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {!isNew && (
        <button className="quiet-link" onClick={() => void postpone()}>
          {t.postpone}
        </button>
      )}
    </main>
  );
}
