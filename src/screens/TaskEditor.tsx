import { useEffect, useState, type ReactNode } from 'react';
import { hapticFeedback, popup } from '@tma.js/sdk-react';
import type { Schedule, TaskInput, TaskKind, TodayTask, Visibility } from '../../shared/types';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { repeatLabel } from '../repeat';
import { KindTile } from '../components/KindIcon';
import { DateRow, SelectRow, Sheet } from '../components/Picker';
import { useBackButton, useMainButton, type SubmitState } from '../telegram/hooks';

const SCHEDULES: Schedule[] = ['daily', 'weekdays', 'per_week'];
const VISIBILITY: Visibility[] = ['private', 'friends'];

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

function formOf(task: TodayTask): Form {
  return {
    title: task.title,
    kind: task.kind,
    target: task.target,
    unit: task.unit ?? '',
    schedule: task.schedule,
    weekdays: task.weekdays,
    per_week: task.per_week ?? 3,
    visibility: task.visibility,
    last_slip_on: task.last_slip_on ?? '',
  };
}

/** Черновик из голосового разбора — в форму, как новую привычку. */
function formOfInput(input: TaskInput): Form {
  return {
    ...EMPTY,
    title: input.title,
    kind: input.kind,
    target: input.kind === 'count' ? input.target : EMPTY.target,
    unit: input.unit ?? '',
    schedule: input.schedule ?? 'daily',
    weekdays: input.weekdays ?? EMPTY.weekdays,
    per_week: input.per_week ?? EMPTY.per_week,
  };
}

interface Props {
  /** null — новая привычка; undefined — её уже нет (отложили или удалили), редактор закроется. Берётся из кэша, без загрузки. */
  task: TodayTask | null | undefined;
  /** Сегодняшний логический день из кэша: с ним сравнивается дата, с которой действует новая цель. */
  day: string;
  /** Вид новой привычки: его выбирают на экране «Чего я хочу?», в редакторе он уже не меняется. */
  kind?: TaskKind;
  /** Закрыть после сохранения, удаления или «Отложить». */
  onClose: () => void;
  /** Кнопка «назад»: у новой привычки возвращает к выбору намерения. */
  onBack?: () => void;
  /** Перечитать «Сегодня»; deleted — привычку удалили вместе с историей. */
  onSaved: (deleted?: boolean) => Promise<void>;
  /**
   * Правка черновика из голосового разбора: форма заполнена им, а «Готово» ничего не сохраняет —
   * возвращает исправленный черновик в список, добавляет его уже сам список.
   */
  draft?: TaskInput;
  onDraft?: (input: TaskInput) => void;
}

export function TaskEditor({ task, day, kind, onClose, onBack, onSaved, draft, onDraft }: Props): ReactNode {
  const t = useT();
  const id = task?.id ?? null;
  const isNew = task === null;
  const isDraft = draft !== undefined;
  const [form, setForm] = useState<Form>(() => (draft ? formOfInput(draft) : task ? formOf(task) : kind ? { ...EMPTY, kind } : EMPTY));
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useBackButton(onBack ?? onClose);

  useEffect(() => {
    if (task === undefined) onClose();
  }, [task, onClose]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const numeric = form.kind === 'count';
  const valid = form.title.trim().length > 0 && (!numeric || form.target > 0) && (form.schedule !== 'weekdays' || form.weekdays > 0);
  const state: SubmitState = busy ? 'submitting' : valid ? 'idle' : 'blocked';

  // Ошибки ловит сама (сообщение под формой), поэтому кнопке её промис не нужен.
  const save = async () => {
    if (!isDraft) setBusy(true);
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
      if (isDraft) {
        onDraft?.(input);
        return;
      }
      if (id === null) {
        await api.createTask(input);
      } else {
        const { kind: _kind, ...patch } = input;
        const res = await api.updateTask(id, patch);
        if (res.goal_effective_from && res.goal_effective_from > day && popup.show.isAvailable()) {
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
  };
  useMainButton(isDraft ? t.done : isNew ? t.add : t.save, state, () => void save());

  const postpone = async () => {
    if (id === null) return;
    try {
      await api.archiveTask(id);
      await onSaved();
      onClose();
    } catch {
      // Не отложилось — сказать, а не молча ничего не сделать (lc-explore 04.10.2026).
      setMessage(t.error);
    }
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
      await onSaved(true);
      onClose();
    } catch {
      setMessage(t.error);
    }
  };

  const repeat = repeatLabel(t, form.schedule, form.weekdays, form.per_week);

  return (
    <main className="app-shell">
      <header className="page-head">
        <h1>{isNew && !isDraft ? t.newTask : t.editTask}</h1>
      </header>

      {message && <p className="error">{message}</p>}

      <div className="kind-chip">
        <KindTile kind={form.kind} title={form.title} size="sm" />
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
            {/* Поля единицы нет: что считаем, понятно из названия («Читать» — страницы).
                Единица, пришедшая из голоса или шаблона, сохраняется в form.unit и показывается на карточке. */}
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
