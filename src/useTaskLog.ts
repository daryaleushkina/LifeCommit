import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { hapticFeedback } from '@tma.js/sdk-react';
import type { HeatDay, TodayResponse, TodayTask } from '../shared/types';
import { api } from './api';
import { isDone, type LogChange } from './components/TaskCard';

/** Данные, загруженные ещё на заставке: экраны открываются сразу, без второго ожидания. */
export interface Cache {
  today: TodayResponse;
  heat: HeatDay[];
}

// Счётчики общие на всё приложение, а не на экран: отметить можно и в «Сегодня», и на экране привычки,
// а запрос, начатый одним экраном, может вернуться, когда открыт уже другой.
let changeSeq = 0;
let heatSeq = 0;

/** Номер последнего изменения привычек. Фоновое обновление сверяет его до и после запроса. */
export const currentChange = (): number => changeSeq;
/** Отметить, что привычки изменились (отметка, правка, удаление): начатые раньше ответы устарели. */
export const bumpChange = (): number => ++changeSeq;

/**
 * Отметка привычки за сегодня — общая для «Сегодня» и экрана привычки.
 * Экран меняется сразу, сервер догоняет; при ошибке отметка откатывается.
 */
export function useTaskLog(setCache: Dispatch<SetStateAction<Cache>>, errorText: string) {
  const [error, setError] = useState<string | null>(null);

  const log = useCallback(
    async (task: TodayTask, change: LogChange) => {
      const patchTask = (patch: Partial<TodayTask>) =>
        setCache((c) => ({ ...c, today: { ...c.today, tasks: c.today.tasks.map((x) => (x.id === task.id ? { ...x, ...patch } : x)) } }));
      const cleared = task.kind === 'abstain' ? !change.status : change.value === null;
      const next: Partial<TodayTask> = {
        value: change.value ?? (change.status === 'clean' ? 1 : 0),
        status: change.status ?? null,
        logged: !cleared,
      };
      const wasDone = isDone(task);
      bumpChange();
      patchTask(next);
      if (!wasDone && isDone({ ...task, ...next })) hapticFeedback.notificationOccurred.ifAvailable('success');
      try {
        await api.log(task.id, change.value, change.status);
        // Ответы могут прийти не по порядку (быстрые нажатия) — берём только самый свежий запрос.
        const seq = ++heatSeq;
        api.heatmap(371).then((h) => seq === heatSeq && setCache((c) => ({ ...c, heat: h.days })), () => {});
      } catch {
        patchTask(task); // откат
        setError(errorText);
      }
    },
    [setCache, errorText],
  );

  return { log, error, clearError: () => setError(null) };
}
