import { useState, type ReactNode } from 'react';
import { popup } from '@tma.js/sdk-react';
import type { ArchivedTask } from '../../shared/types';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { useBackButton } from '../telegram/hooks';

interface Props {
  /** Список уже лежит в кэше «Сегодня» — экран открывается без загрузки. */
  archived: ArchivedTask[];
  onClose: () => void;
  /** Перечитать «Сегодня»; deleted — привычку удалили вместе с историей. */
  onChanged: (deleted?: boolean) => Promise<void>;
}

/** Отложенные дела: вернуть одним тапом или удалить насовсем. */
export function Archive({ archived, onClose, onChanged }: Props): ReactNode {
  const t = useT();
  const [items, setItems] = useState<ArchivedTask[]>(archived);
  const [message, setMessage] = useState<string | null>(null);

  useBackButton(onClose);

  const drop = (id: number) =>
    setItems((list) => {
      const next = list.filter((x) => x.id !== id);
      if (next.length === 0) onClose();
      return next;
    });

  const restore = async (id: number) => {
    try {
      await api.restoreTask(id);
      await onChanged();
      drop(id);
    } catch (e) {
      setMessage(e instanceof ApiError && e.code === 'task_limit' ? t.limitReached(5) : t.error);
    }
  };

  const remove = async (id: number) => {
    if (popup.show.isAvailable()) {
      const answer = await popup.show({
        message: t.deleteForeverConfirm,
        buttons: [{ id: 'delete', type: 'destructive', text: t.deleteForever }, { type: 'cancel' }],
      });
      if (answer !== 'delete') return;
    }
    try {
      await api.deleteTask(id);
      await onChanged(true);
      drop(id);
    } catch {
      // Не удалилось — привычка остаётся в списке, сказано (lc-explore 04.10.2026).
      setMessage(t.error);
    }
  };

  return (
    <main className="app-shell">
      <header className="page-head">
        <h1>{t.archive}</h1>
      </header>
      {message && <p className="error">{message}</p>}
      {items.length > 0 && (
        <section className="card">
          {items.map((task) => (
            <div key={task.id} className="archive-item">
              <span className="label">{task.title}</span>
              <button className="act undo" onClick={() => void remove(task.id)}>
                {t.deleteForever}
              </button>
              <button className="act soft" onClick={() => void restore(task.id)}>
                {t.restore}
              </button>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
