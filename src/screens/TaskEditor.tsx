import { useEffect, useState, type ReactNode } from 'react';
import { hapticFeedback, popup } from '@tma.js/sdk-react';
import type { Schedule, TaskInput, TaskKind, TaskTemplate } from '../../shared/types';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { useBackButton, useMainButton, type SubmitState } from '../telegram/hooks';

const KINDS: TaskKind[] = ['count', 'check', 'limit', 'abstain'];
const SCHEDULES: Schedule[] = ['daily', 'weekdays', 'per_week'];

interface Form {
  title: string;
  emoji: string;
  kind: TaskKind;
  target: string;
  min_target: string;
  unit: string;
  step: string;
  schedule: Schedule;
  weekdays: number;
  per_week: number;
  subtasks: string;
}

const EMPTY: Form = {
  title: '',
  emoji: '',
  kind: 'count',
  target: '10',
  min_target: '',
  unit: '',
  step: '1',
  schedule: 'daily',
  weekdays: 31,
  per_week: 3,
  subtasks: '',
};

function toInput(f: Form): TaskInput {
  const numeric = f.kind === 'count' || f.kind === 'limit';
  return {
    title: f.title.trim(),
    emoji: f.emoji.trim() || null,
    kind: f.kind,
    target: numeric ? Number(f.target) : 1,
    min_target: f.kind === 'count' && f.min_target ? Number(f.min_target) : null,
    unit: numeric ? f.unit.trim() || null : null,
    step: numeric ? Math.max(1, Number(f.step) || 1) : 1,
    schedule: f.schedule,
    weekdays: f.weekdays,
    per_week: f.schedule === 'per_week' ? f.per_week : null,
    subtasks: f.subtasks.split('\n').map((s) => s.trim()).filter(Boolean),
  };
}

export function TaskEditor({ id, onClose }: { id: number | null; onClose: () => void }): ReactNode {
  const t = useT();
  const isNew = id === null;
  const [form, setForm] = useState<Form>(EMPTY);
  const [tab, setTab] = useState<'templates' | 'custom'>(isNew ? 'templates' : 'custom');
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [state, setState] = useState<SubmitState>('blocked');
  const [message, setMessage] = useState<string | null>(null);

  useBackButton(onClose);

  useEffect(() => {
    if (isNew) {
      api.templates().then(setTemplates, () => {});
      return;
    }
    api.today().then((d) => {
      const task = d.tasks.find((x) => x.id === id);
      if (!task) return onClose();
      setForm({
        title: task.title,
        emoji: task.emoji ?? '',
        kind: task.kind,
        target: String(task.target),
        min_target: task.min_target ? String(task.min_target) : '',
        unit: task.unit ?? '',
        step: String(task.step),
        schedule: task.schedule,
        weekdays: task.weekdays,
        per_week: task.per_week ?? 3,
        subtasks: task.subtasks.map((s) => s.title).join('\n'),
      });
    });
  }, [id, isNew, onClose]);

  const valid =
    form.title.trim().length > 0 &&
    (form.kind === 'check' || form.kind === 'abstain' || Number(form.target) > 0) &&
    (form.schedule !== 'weekdays' || form.weekdays > 0);
  useEffect(() => {
    setState((s) => (s === 'submitting' ? s : valid ? 'idle' : 'blocked'));
  }, [valid]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const fromTemplate = (tpl: TaskTemplate) => {
    setForm({
      ...EMPTY,
      title: tpl.title,
      emoji: tpl.emoji,
      kind: tpl.kind,
      target: String(tpl.target),
      min_target: tpl.min_target ? String(tpl.min_target) : '',
      unit: tpl.unit ?? '',
      step: String(tpl.step),
      subtasks: tpl.subtasks.join('\n'),
    });
    setTab('custom');
  };

  useMainButton(isNew ? t.add : t.save, tab === 'custom' ? state : 'blocked', async () => {
    setState('submitting');
    try {
      const input = toInput(form);
      if (isNew) {
        await api.createTask(input);
      } else {
        // Шаги в правке пока не меняем — только поля задачи и цель.
        const { subtasks: _s, kind: _k, ...patch } = input;
        const res = await api.updateTask(id, patch);
        const today = (await api.today()).day;
        if (res.goal_effective_from && res.goal_effective_from > today && popup.show.isAvailable()) {
          await popup.show({ message: t.goalTomorrow, buttons: [{ type: 'ok' }] });
        }
      }
      hapticFeedback.notificationOccurred.ifAvailable('success');
      onClose();
    } catch (e) {
      setMessage(e instanceof ApiError && e.code === 'task_limit' ? t.limitReached(5) : t.error);
      setState('idle');
    }
  });

  const archive = async () => {
    if (id === null) return;
    const confirmed = popup.show.isAvailable()
      ? (await popup.show({ message: `${t.archive}? ${t.archiveHint}`, buttons: [{ id: 'ok', type: 'destructive', text: t.archive }, { type: 'cancel' }] })) === 'ok'
      : true;
    if (!confirmed) return;
    await api.archiveTask(id);
    onClose();
  };

  const numeric = form.kind === 'count' || form.kind === 'limit';

  return (
    <main className="app-shell">
      <header className="page-head">
        <h1>{isNew ? t.addTask : t.editTask}</h1>
      </header>

      {isNew && (
        <div className="segmented">
          <button className={tab === 'templates' ? 'on' : ''} onClick={() => setTab('templates')}>
            {t.templates}
          </button>
          <button className={tab === 'custom' ? 'on' : ''} onClick={() => setTab('custom')}>
            {t.custom}
          </button>
        </div>
      )}

      {message && <p className="error">{message}</p>}

      {tab === 'templates' ? (
        <div className="tiles">
          {templates.map((tpl) => (
            <button key={tpl.slug} className="tile" onClick={() => fromTemplate(tpl)}>
              <span className="tile-emoji">{tpl.emoji}</span>
              <span className="tile-title">{tpl.title}</span>
            </button>
          ))}
        </div>
      ) : (
        <form className="form" onSubmit={(e) => e.preventDefault()}>
          <div className="field-row">
            <label className="field emoji">
              <input value={form.emoji} maxLength={4} placeholder="🙂" onChange={(e) => set('emoji', e.target.value)} />
            </label>
            <label className="field grow">
              <span>{t.title}</span>
              <input value={form.title} maxLength={80} placeholder={t.titlePh} onChange={(e) => set('title', e.target.value)} />
            </label>
          </div>

          {isNew && (
            <fieldset className="field">
              <span>{t.kind}</span>
              <div className="segmented wrap">
                {KINDS.map((k) => (
                  <button type="button" key={k} className={form.kind === k ? 'on' : ''} onClick={() => set('kind', k)}>
                    {t.kinds[k]}
                  </button>
                ))}
              </div>
              <small className="muted">{t.kindHints[form.kind]}</small>
            </fieldset>
          )}

          {numeric && (
            <div className="field-row">
              <label className="field">
                <span>{form.kind === 'limit' ? t.limitTarget : t.target}</span>
                <input inputMode="decimal" value={form.target} onChange={(e) => set('target', e.target.value)} />
              </label>
              <label className="field">
                <span>{t.unit}</span>
                <input value={form.unit} placeholder={t.unitPh} onChange={(e) => set('unit', e.target.value)} />
              </label>
              <label className="field">
                <span>{t.step}</span>
                <input inputMode="numeric" value={form.step} onChange={(e) => set('step', e.target.value)} />
              </label>
            </div>
          )}

          {form.kind === 'count' && (
            <label className="field">
              <span>{t.minTarget}</span>
              <input inputMode="decimal" value={form.min_target} placeholder="—" onChange={(e) => set('min_target', e.target.value)} />
            </label>
          )}

          <fieldset className="field">
            <span>{t.schedule}</span>
            <div className="segmented wrap">
              {SCHEDULES.map((s) => (
                <button type="button" key={s} className={form.schedule === s ? 'on' : ''} onClick={() => set('schedule', s)}>
                  {t.schedules[s]}
                </button>
              ))}
            </div>
            {form.schedule === 'weekdays' && (
              <div className="weekdays">
                {t.weekdaysShort.map((d, i) => {
                  const on = (form.weekdays & (1 << i)) !== 0;
                  return (
                    <button type="button" key={d} className={on ? 'on' : ''} aria-pressed={on} onClick={() => set('weekdays', form.weekdays ^ (1 << i))}>
                      {d}
                    </button>
                  );
                })}
              </div>
            )}
            {form.schedule === 'per_week' && (
              <div className="stepper">
                <button type="button" className="round" onClick={() => set('per_week', Math.max(1, form.per_week - 1))}>
                  −
                </button>
                <strong>{form.per_week}</strong>
                <button type="button" className="round" onClick={() => set('per_week', Math.min(7, form.per_week + 1))}>
                  +
                </button>
                <span className="muted">{t.perWeek}</span>
              </div>
            )}
          </fieldset>

          {isNew && (
            <label className="field">
              <span>{t.subtasks}</span>
              <textarea rows={3} value={form.subtasks} onChange={(e) => set('subtasks', e.target.value)} />
            </label>
          )}

          {!isNew && (
            <button type="button" className="btn danger-ghost" onClick={() => void archive()}>
              {t.archive}
            </button>
          )}
        </form>
      )}
    </main>
  );
}
