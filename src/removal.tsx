// Удаление свайпом с «Вернуть» (круг 21, решение владелицы 02.10.2026): строка исчезает сразу, внизу 5 секунд
// «Вернуть»; на сервер удаление уходит, только когда плашка закрылась (или приложение свернули). Вернули —
// просто снова показываем, сервер ничего не узнал. Списки сами не меняются: строки с ключом из «убранных»
// не рисуются, а после удаления экран перечитывает данные.
//
// Повторяющееся общее дело группы сначала спрашивает: «Убрать только сегодня» или «Удалить для всех».
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hapticFeedback } from '@tma.js/sdk-react';
import { useT } from './i18n';
import { Sheet } from './components/Picker';

const UNDO_MS = 5000;

interface Pending {
  key: string;
  text: string;
  commit: () => Promise<unknown>;
}

interface Choice {
  title: string;
  /** Дело общее и повторяется — два пути. */
  onToday: () => void;
  onAll: () => void;
}

let removed = new Set<string>();
let pending: Pending | null = null;
let timer: number | undefined;
let choice: Choice | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Отправить отложенное удаление на сервер прямо сейчас. Строка остаётся скрытой, пока данные не перечитаются. */
function flush() {
  const p = pending;
  if (!p) return;
  pending = null;
  window.clearTimeout(timer);
  emit();
  void p.commit().finally(() => {
    removed = new Set([...removed].filter((k) => k !== p.key));
    emit();
  });
}

if (typeof document !== 'undefined') {
  // Свернули приложение — не теряем удаление.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

/**
 * Убрать строку с «Вернуть». commit — само удаление на сервере и перечитать экран (после этого строки и так нет).
 * key — что прятать: «todo:12», «gi:3:45:2026-10-02».
 */
export function removeWithUndo(key: string, text: string, commit: () => Promise<unknown>) {
  flush();
  removed = new Set(removed).add(key);
  pending = { key, text, commit };
  timer = window.setTimeout(flush, UNDO_MS);
  hapticFeedback.impactOccurred.ifAvailable('medium');
  emit();
}

function undo() {
  const p = pending;
  if (!p) return;
  pending = null;
  window.clearTimeout(timer);
  removed = new Set([...removed].filter((k) => k !== p.key));
  emit();
}

/** Спросить про повторяющееся общее дело: только сегодня или для всех. */
export function askGroupRemoval(c: Choice) {
  choice = c;
  emit();
}

/** Спрятана ли строка (её удалили, «Вернуть» ещё можно нажать). */
export function useRemoved(): (key: string) => boolean {
  useSyncExternalStore(subscribe, () => version);
  return (key) => removed.has(key);
}

/** Плашка «Вернуть» и вопрос про общее дело — один раз на всё приложение. */
export function RemovalHost(): ReactNode {
  const t = useT();
  useSyncExternalStore(subscribe, () => version);
  // Плашка уезжает плавно: держим текст, пока идёт исчезновение.
  const [shown, setShown] = useState<string | null>(null);
  // Снимок на эту отрисовку: сама переменная модуля меняется без перерисовки, зависимостью эффекта быть не может.
  const pendingKey = pending?.key;
  useEffect(() => {
    if (pending) setShown(pending.text);
    else {
      const id = window.setTimeout(() => setShown(null), 200);
      return () => window.clearTimeout(id);
    }
  }, [pendingKey]);

  return (
    <>
      {shown &&
        createPortal(
          <div className={`undo-toast${pending ? '' : ' out'}`} role="status">
            <span>{shown}</span>
            <button onClick={undo}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 14L4 9l5-5" />
                <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
              </svg>
              {t.swipe.undo}
            </button>
          </div>,
          document.body,
        )}
      {choice && (
        <Sheet
          title={`«${choice.title}»`}
          onClose={() => {
            choice = null;
            emit();
          }}
        >
          <p className="sheet-note first">{t.swipe.sharedHint}</p>
          <button
            className="act soft wide"
            onClick={() => {
              const c = choice!;
              choice = null;
              emit();
              c.onToday();
            }}
          >
            {t.swipe.onlyToday}
          </button>
          <button
            className="act danger wide"
            onClick={() => {
              const c = choice!;
              choice = null;
              emit();
              c.onAll();
            }}
          >
            {t.swipe.forAll}
          </button>
        </Sheet>
      )}
    </>
  );
}
