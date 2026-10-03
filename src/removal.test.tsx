// Удаление с «Вернуть»: строка пропадает сразу, на сервер уходит через 5 секунд (или когда приложение свернули),
// «Вернуть» отменяет. Повторяющееся общее дело сначала спрашивает: только сегодня или для всех.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from './test/render';

const haptic = vi.hoisted(() => vi.fn());
vi.mock('@tma.js/sdk-react', () => ({ hapticFeedback: { impactOccurred: { ifAvailable: haptic } } }));

import { askGroupRemoval, RemovalHost, removeWithUndo, useRemoved } from './removal';

function Row({ k }: { k: string }) {
  const isRemoved = useRemoved();
  return isRemoved(k) ? null : <p>{k}</p>;
}

function Screen() {
  return (
    <>
      <Row k="todo:1" />
      <Row k="todo:2" />
      <RemovalHost />
    </>
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Свернуть приложение (или вернуться в него). */
function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  delete (document as { visibilityState?: string }).visibilityState;
}

const toast = page.getByRole('status');
const undoButton = page.getByRole('button', { name: 'Вернуть' });

/** Ждём, пока React поставит таймер исчезновения плашки, и прокручиваем его. */
async function finishFade() {
  await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
  vi.advanceTimersByTime(200);
  await expect.element(toast).not.toBeInTheDocument();
}

beforeEach(() => {
  haptic.mockReset();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  setVisibility('hidden'); // недоотправленное — отправить, чтобы следующий тест начинал с чистого
  vi.useRealTimers();
});

describe('удаление с «Вернуть»', () => {
  it('строка пропадает сразу, через 5 секунд — на сервер; после ответа ключ больше не прячется', async () => {
    const d = deferred();
    const commit = vi.fn(() => d.promise);
    await renderApp(<Screen />);
    removeWithUndo('todo:1', '«Молоко» удалено', commit);

    await expect.element(toast.getByText('«Молоко» удалено')).toBeVisible();
    await expect.element(undoButton).toBeVisible();
    await expect.element(page.getByText('todo:1')).not.toBeInTheDocument();
    await expect.element(page.getByText('todo:2')).toBeVisible();
    expect(haptic).toHaveBeenCalledWith('medium');

    vi.advanceTimersByTime(4999);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);

    // Плашка уезжает плавно, строка остаётся скрытой, пока экран не перечитал данные.
    await expect.element(toast).toHaveClass(/out/);
    await finishFade();
    await expect.element(page.getByText('todo:1')).not.toBeInTheDocument();
    d.resolve();
    await expect.element(page.getByText('todo:1')).toBeVisible();
  });

  it('«Вернуть» — строка на месте, сервер ничего не узнаёт', async () => {
    const commit = vi.fn(async () => {});
    await renderApp(<Screen />);
    removeWithUndo('todo:2', '«Хлеб» удалено', commit);
    await expect.element(page.getByText('todo:2')).not.toBeInTheDocument();
    await undoButton.click();
    await expect.element(page.getByText('todo:2')).toBeVisible();
    await expect.element(toast).toHaveClass(/out/);
    // Пока плашка уезжает, повторное нажатие ни на что не влияет.
    await undoButton.click();
    vi.advanceTimersByTime(10_000);
    expect(commit).not.toHaveBeenCalled();
    await expect.element(toast).not.toBeInTheDocument();
  });

  it('новое удаление сразу отправляет предыдущее', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    await renderApp(<Screen />);
    removeWithUndo('todo:1', 'первое', first);
    await expect.element(toast.getByText('первое')).toBeVisible();
    removeWithUndo('todo:2', 'второе', second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    await expect.element(toast.getByText('второе')).toBeVisible();
    await expect.element(page.getByText('todo:1')).toBeVisible(); // первое ушло на сервер и вернулось
    await expect.element(page.getByText('todo:2')).not.toBeInTheDocument();
    await undoButton.click();
    await expect.element(page.getByText('todo:2')).toBeVisible();
    expect(second).not.toHaveBeenCalled();
  });

  it('свернули приложение — удаление уходит сразу; вернулись — ничего не происходит', async () => {
    const commit = vi.fn(async () => {});
    await renderApp(<Screen />);
    removeWithUndo('todo:1', 'удалено', commit);
    await expect.element(toast).toBeVisible();
    setVisibility('visible');
    expect(commit).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(commit).toHaveBeenCalledTimes(1);
    await expect.element(toast).toHaveClass(/out/);
    // Второй раз отправлять нечего.
    setVisibility('hidden');
    expect(commit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(commit).toHaveBeenCalledTimes(1);
    await expect.element(toast).not.toBeInTheDocument();
  });
});

describe('общее повторяющееся дело', () => {
  it('«Убрать только сегодня»', async () => {
    const onToday = vi.fn();
    const onAll = vi.fn();
    await renderApp(<Screen />);
    askGroupRemoval({ title: 'Ужин', onToday, onAll });
    const sheet = page.getByRole('dialog', { name: '«Ужин»' });
    await expect.element(sheet).toBeVisible();
    await expect.element(sheet.getByText('Дело общее и повторяется', { exact: false })).toBeVisible();
    await sheet.getByRole('button', { name: 'Убрать только сегодня' }).click();
    expect(onToday).toHaveBeenCalledTimes(1);
    expect(onAll).not.toHaveBeenCalled();
    await expect.element(sheet).not.toBeInTheDocument();
  });

  it('«Удалить для всех»', async () => {
    const onToday = vi.fn();
    const onAll = vi.fn();
    await renderApp(<Screen />);
    askGroupRemoval({ title: 'Ужин', onToday, onAll });
    await page.getByRole('button', { name: 'Удалить для всех' }).click();
    expect(onAll).toHaveBeenCalledTimes(1);
    expect(onToday).not.toHaveBeenCalled();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('закрыли шторку — ни то, ни другое', async () => {
    const onToday = vi.fn();
    const onAll = vi.fn();
    await renderApp(<Screen />, 'en');
    askGroupRemoval({ title: 'Dinner', onToday, onAll });
    await expect.element(page.getByRole('button', { name: 'Delete for everyone' })).toBeVisible();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(onToday).not.toHaveBeenCalled();
    expect(onAll).not.toHaveBeenCalled();
  });
});
