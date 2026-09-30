import { useEffect, useState, type ReactNode } from 'react';
import { hapticFeedback, popup } from '@tma.js/sdk-react';
import type { Schedule, TaskInput, TaskKind, Visibility } from '../../shared/types';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { repeatLabel } from '../repeat';
import { KindTile } from '../components/KindIcon';
import { DateRow, SelectRow, Sheet } from '../components/Picker';
import { useBackButton, useMainButton, type SubmitState } from '../telegram/hooks';

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
  kind: 'check',
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

const Chevron = () => (
  <svg className="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9.5 6l6 6-6 6" />
  </svg>
);

const Tick = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

interface Props {
  id: number | null;
  /** Вид новой привычки: его выбирают на экране «Чего я хочу?», в редакторе он уже не меняется. */
  kind?: TaskKind;
  /** Закрыть после сохранения, удаления или «Отложить». */
  onClose: () => void;
  /** Кнопка «назад»: у новой привычки возвращает к выбору намерения. */
  onBack?: () => void;
  onSaved: () => Promise<void>;
}

export function TaskEditor({ id, kind, onClose, onBack, onSaved }: Props): ReactNode {
  const t = useT();
  const isNew = id === null;
  const [form, setForm] = useState<Form>(kind ? { ...EMPTY, kind } : EMPTY);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useBackButton(onBack ?? onClose);

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
    });
  }, [id, isNew, onClose]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const numeric = form.kind === 'count';
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
        schedule: form.kind === 'abstain' ? 'daily' : form.schedule,
        weekdays: form.weekdays,
        per_week: form.kind !== 'abstain' && form.schedule === 'per_week' ? form.per_week : null,
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

  // Удаление стирает и историю привычки — поэтому с подтверждением.
  const remove = async () => {
    if (id === null) return;
    if (popup.show.isAvailable()) {
      const answer = await popup.show({
        message: t.deleteForeverConfirm,
        buttons: [{ id: 'delete', type: 'destructive', text: t.deleteForever }, { type: 'cancel' }],
      });
      if (answer !== 'delete') return;
    }
    try {
      await api.deleteTask(id);
      await onSaved();
      onClose();
    } catch {
      setMessage(t.error);
    }
  };

  const repeat = repeatLabel(t, form.schedule, form.weekdays, form.per_week);

  return (
    <main className="app-shell">
      <header className="page-head">
        <h1>{isNew ? t.newTask : t.editTask}</h1>
      </header>

      {message && <p className="error">{message}</p>}

      <div className="kind-chip">
        <KindTile kind={form.kind} size="sm" />
        {t.intents[form.kind].title}
      </div>

      <input className="title-input" value={form.title} maxLength={80} placeholder={t.titlePh[form.kind]} aria-label={t.newTask} onChange={(e) => set('title', e.target.value)} />

      <section className="card">
        {form.kind === 'abstain' && (
          <DateRow label={t.lastSlip} value={form.last_slip_on} max={localToday()} onChange={(v) => set('last_slip_on', v)} />
        )}
        {numeric && (
          <div className="row">
            <span className="label">{t.goal}</span>
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
            <input className="unit-input" value={form.unit} maxLength={12} placeholder={t.unitPh} aria-label={t.unitLabel} onChange={(e) => set('unit', e.target.value)} />
          </div>
        )}

        {/* «Бросить» — это про каждый день, расписания у него нет. */}
        {form.kind !== 'abstain' && (
          <button className="row" aria-haspopup="dialog" onClick={() => setRepeatOpen(true)}>
            <span className="label">{t.repeat}</span>
            <span className="value">{repeat}</span>
            <Chevron />
          </button>
        )}

        <SelectRow label={t.who} value={form.visibility} options={VISIBILITY.map((v) => ({ value: v, label: t.visibility[v] }))} onChange={(v) => set('visibility', v)} />
      </section>

      {repeatOpen && (
        <Sheet title={t.repeat} onClose={() => setRepeatOpen(false)}>
          <div className="options" role="radiogroup" aria-label={t.repeat}>
            {SCHEDULES.map((sch) => (
              <button key={sch} role="radio" aria-checked={form.schedule === sch} className={form.schedule === sch ? 'on' : ''} onClick={() => set('schedule', sch)}>
                {t.schedules[sch]}
                {form.schedule === sch && <Tick />}
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
            <div className="per-week">
              <div className="stepper">
                <button type="button" aria-label="−" onClick={() => set('per_week', Math.max(1, form.per_week - 1))}>
                  −
                </button>
                <input readOnly value={form.per_week} aria-label={t.schedules.per_week} />
                <button type="button" aria-label="+" onClick={() => set('per_week', Math.min(6, form.per_week + 1))}>
                  +
                </button>
              </div>
              <span>{t.perWeekHint(form.per_week)}</span>
            </div>
          )}
          {/* Ни одного дня не выбрано — закрыть нельзя: такую привычку некогда было бы делать. */}
          <button className="act primary wide" disabled={form.schedule === 'weekdays' && form.weekdays === 0} onClick={() => setRepeatOpen(false)}>
            {t.done}
          </button>
        </Sheet>
      )}

      {!isNew && (
        <div className="quiet-links">
          <button className="quiet-link" onClick={() => void postpone()}>
            {t.postpone}
          </button>
          <button className="quiet-link danger" onClick={() => void remove()}>
            {t.deleteTask}
          </button>
        </div>
      )}
    </main>
  );
}
