// «Сегодня»: порядок привычек, отметки с откатом, дела, фоновое обновление и удаление свайпом с «Вернуть».
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { GroupDayItem, GroupToday } from '../../shared/groups';
import type { TodayResponse, TodayTask, Todo } from '../../shared/types';
import { RemovalHost } from '../removal';
import { renderApp } from '../test/render';
import type { Cache } from '../useTaskLog';
import { Today } from './Today';

const m = vi.hoisted(() => ({
  api: { today: vi.fn(), log: vi.fn(), deleteTask: vi.fn(), updateTodo: vi.fn(), createTodo: vi.fn(), deleteTodo: vi.fn(), markItem: vi.fn() },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));

const DAY = '2026-10-03';
const task = (patch: Partial<TodayTask>): TodayTask => ({
  id: 1, title: 'Вода', emoji: null, kind: 'check', unit: null, step: 1, schedule: 'daily', weekdays: 127, per_week: null,
  visibility: 'private', target: 1, value: 0, logged: false, status: null, week_done: 0, due: true, subtasks: [], challenge_id: null,
  clean_before: 0, last_slip_on: null, ...patch,
});
const todo = (patch: Partial<Todo>): Todo => ({
  id: 100, title: 'Купить молоко', day: DAY, done: false, time: null, duration_min: null, recurring: false, source: null, details: null, ...patch,
});
const response = (patch: Partial<TodayResponse> = {}): TodayResponse => ({
  day: DAY, tasks: [], archived: [], limits: { max_tasks: null, active: 0 }, todos: [], todos_later: 0, groups: [], ...patch,
});
const groupItem: GroupDayItem = {
  id: 1, title: 'Вынести мусор', mode: 'one', time: null, duration_min: null, due_day: null, carried: false, recurring: false,
  people: [1, 2], all_members: false, rotate: false, turn: null, for_me: true, can_mark: true, done: false, done_by: [],
  target: null, total: null, unit: null, goal_until: null, start: DAY, rrule: null, assignees: [],
};
const family: GroupToday = {
  id: 10, title: 'Семья', kind: 'family', color: null, role: 'owner', members: [{ id: 1, name: 'Даша', photo: null }], items: [groupItem], planned: 1, done: 0,
};

/** «Сегодня» с настоящим состоянием кэша, как в приложении, и плашкой «Вернуть». */
function Screen({ today, loadedAt = Date.now(), ...props }: { today: TodayResponse; loadedAt?: number } & Partial<Parameters<typeof Today>[0]>) {
  const [cache, setCache] = useState<Cache>({ today, heat: [], loadedAt });
  return (
    <>
      <Today cache={cache} setCache={setCache} me={1} onEdit={() => {}} onArchive={() => {}} onOpenGroup={() => {}} onDeleted={async () => {}} {...props} />
      <RemovalHost />
    </>
  );
}

/** Смахнуть строку влево до конца — срабатывает крайняя кнопка («Удалить»). */
function swipeAway(inside: Element) {
  const body = inside.closest('.swipe')!.querySelector('.swipe-body')!;
  const r = body.getBoundingClientRect();
  const at = (x: number) => ({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: r.top + r.height / 2, bubbles: true });
  body.dispatchEvent(new PointerEvent('pointerdown', at(r.right - 10)));
  body.dispatchEvent(new PointerEvent('pointermove', at(r.right - 40)));
  body.dispatchEvent(new PointerEvent('pointermove', at(r.left - 20)));
  body.dispatchEvent(new PointerEvent('pointerup', at(r.left - 20)));
}

/** Свернули приложение — отложенное удаление уходит на сервер сразу. */
function minimize() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  delete (document as { visibilityState?: unknown }).visibilityState;
}

beforeEach(() => {
  for (const f of Object.values(m.api)) f.mockReset();
  m.api.today.mockResolvedValue(response());
  m.api.log.mockResolvedValue({ ok: true });
  m.api.deleteTask.mockResolvedValue({ ok: true });
  m.api.updateTodo.mockResolvedValue({ ok: true });
  m.api.createTodo.mockResolvedValue({ id: 101 });
  m.api.deleteTodo.mockResolvedValue({ ok: true });
  m.api.markItem.mockResolvedValue({ ok: true, taken: false });
  localStorage.clear();
});

describe('«Сегодня»', () => {
  it('пусто — дата, «На сегодня всё» и «Добавить привычку»', async () => {
    const onEdit = vi.fn();
    await renderApp(<Screen today={response()} onEdit={onEdit} />);
    await expect.element(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible();
    await expect.element(page.getByText('суббота, 3 октября')).toBeVisible();
    await expect.element(page.getByText('На сегодня всё')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить привычку' }).click();
    expect(onEdit).toHaveBeenCalledWith(null);
    expect(m.api.today).not.toHaveBeenCalled();
  });

  it('по-английски дата в английском формате', async () => {
    await renderApp(<Screen today={response()} />, 'en');
    await expect.element(page.getByText('Saturday, October 3')).toBeVisible();
  });

  it('несделанные сверху, сделанные ниже, «не на сегодня» — отдельно и без кнопки', async () => {
    const onEdit = vi.fn();
    const tasks = [
      task({ id: 1, title: 'Сделанное', value: 1 }),
      task({ id: 2, title: 'Несделанное' }),
      task({ id: 3, title: 'Спортзал', due: false, schedule: 'per_week', per_week: 3 }),
      task({ id: 4, title: 'Йога', due: false, schedule: 'weekdays' }),
      task({ id: 5, title: 'Растяжка', due: false, schedule: 'per_week', per_week: null }),
    ];
    await renderApp(<Screen today={response({ tasks })} onEdit={onEdit} />);
    const titles = page.getByRole('heading', { level: 2 }).elements().map((h) => h.textContent);
    expect(titles.filter((x) => x !== 'Привычки' && x !== 'Дела')).toEqual(['Несделанное', 'Сделанное', 'Спортзал', 'Йога', 'Растяжка']);
    await expect.element(page.getByText('3 раза в неделю')).toBeVisible();
    await expect.element(page.getByText('По дням недели')).toBeVisible();
    await expect.element(page.getByText('0 раз в неделю')).toBeVisible();
    await page.getByRole('button', { name: /Спортзал/ }).click();
    await page.getByRole('button', { name: 'Несделанное', exact: true }).click();
    expect(onEdit.mock.calls).toEqual([[3], [2]]);
  });

  it('лимит привычек исчерпан — вместо «Добавить» подсказка; есть отложенные — ссылка на них', async () => {
    const onArchive = vi.fn();
    await renderApp(
      <Screen today={response({ limits: { max_tasks: 5, active: 5 }, archived: [{ id: 9, title: 'Бег', emoji: null }] })} onArchive={onArchive} />,
    );
    await expect.element(page.getByText('Бесплатно — до 5 привычек. Можно отложить какую-нибудь.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Добавить привычку' })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Отложенные · 1' }).click();
    expect(onArchive).toHaveBeenCalled();
  });

  it('место под лимитом есть — «Добавить привычку» на месте', async () => {
    await renderApp(<Screen today={response({ limits: { max_tasks: 5, active: 2 } })} />);
    await expect.element(page.getByRole('button', { name: 'Добавить привычку' })).toBeVisible();
  });

  it('галочка отмечает сразу и уходит на сервер; ошибка — откат и сообщение, тап по нему убирает', async () => {
    await renderApp(<Screen today={response({ tasks: [task({ title: 'Бег' })] })} />);
    const check = page.getByRole('button', { name: 'Бег — сделано' });
    await check.click();
    await expect.element(check).toHaveAttribute('aria-pressed', 'true');
    expect(m.api.log).toHaveBeenCalledWith(1, 1, undefined);

    m.api.log.mockRejectedValueOnce(new Error('сеть'));
    await check.click();
    const error = page.getByText('Что-то пошло не так. Попробуй ещё раз.');
    await expect.element(error).toBeVisible();
    await expect.element(check).toHaveAttribute('aria-pressed', 'true');
    await error.click();
    await expect.element(error).not.toBeInTheDocument();
  });

  it('дела: новое уходит на сервер с сегодняшним днём, отметка не прошла — сообщение', async () => {
    m.api.updateTodo.mockRejectedValueOnce(new Error('сеть'));
    await renderApp(<Screen today={response({ todos: [todo({})] })} />);
    await page.getByRole('button', { name: 'Дело на сегодня' }).click();
    const input = page.getByRole('textbox', { name: 'Дело на сегодня' });
    await input.fill('Позвонить маме');
    input.element().closest('form')!.requestSubmit();
    await expect.element(page.getByText('Позвонить маме')).toBeVisible();
    expect(m.api.createTodo).toHaveBeenCalledWith({ title: 'Позвонить маме', day: DAY });

    await page.getByRole('button', { name: 'Сделано: Купить молоко' }).click();
    expect(m.api.updateTodo).toHaveBeenCalledWith(100, { done: true });
    const error = page.getByText('Что-то пошло не так. Попробуй ещё раз.');
    await expect.element(error).toBeVisible();
    await error.click();
    await expect.element(error).not.toBeInTheDocument();
  });

  it('данные устарели — тихо перечитывает при открытии', async () => {
    m.api.today.mockResolvedValue(response({ tasks: [task({ title: 'С сервера' })] }));
    await renderApp(<Screen today={response()} loadedAt={0} />);
    await expect.element(page.getByRole('heading', { name: 'С сервера' })).toBeVisible();
  });

  it('ответ пришёл после отметки — устарел и не затирает её', async () => {
    let resolve!: (v: TodayResponse) => void;
    m.api.today.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderApp(<Screen today={response({ tasks: [task({ title: 'Бег' })] })} loadedAt={0} />);
    await page.getByRole('button', { name: 'Бег — сделано' }).click();
    resolve(response({ tasks: [task({ title: 'Старый ответ' })] }));
    await expect.element(page.getByRole('button', { name: 'Бег — сделано' })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByText('Старый ответ')).not.toBeInTheDocument();
  });

  it('фоновое обновление не вышло — экран остаётся как был', async () => {
    m.api.today.mockRejectedValue(new Error('сеть'));
    await renderApp(<Screen today={response({ tasks: [task({ title: 'Бег' })] })} loadedAt={0} />);
    await expect.poll(() => m.api.today.mock.calls.length).toBe(1);
    await expect.element(page.getByRole('heading', { name: 'Бег' })).toBeVisible();
  });

  it('свайп удаляет привычку сразу, «Вернуть» возвращает без запроса', async () => {
    await renderApp(<Screen today={response({ tasks: [task({ title: 'Бег' })] })} />);
    swipeAway(page.getByRole('heading', { name: 'Бег' }).element());
    await expect.element(page.getByRole('heading', { name: 'Бег' })).not.toBeInTheDocument();
    await expect.element(page.getByText('«Бег» удалено')).toBeVisible();
    await page.getByRole('button', { name: 'Вернуть' }).click();
    await expect.element(page.getByRole('heading', { name: 'Бег' })).toBeVisible();
    expect(m.api.deleteTask).not.toHaveBeenCalled();
  });

  it('свайп по привычке «не на сегодня»; свернули приложение — удаление ушло и экран перечитан, даже при ошибке', async () => {
    m.api.deleteTask.mockRejectedValueOnce(new Error('сеть'));
    const onDeleted = vi.fn(async () => {});
    await renderApp(<Screen today={response({ tasks: [task({ id: 7, title: 'Йога', due: false })] })} onDeleted={onDeleted} />);
    swipeAway(page.getByRole('heading', { name: 'Йога' }).element());
    await expect.element(page.getByRole('heading', { name: 'Йога' })).not.toBeInTheDocument();
    minimize();
    await expect.poll(() => onDeleted.mock.calls.length).toBe(1);
    expect(m.api.deleteTask).toHaveBeenCalledWith(7);
    // Сервер не удалил — привычка снова на экране, и человеку сказано, что не вышло (раньше — молча).
    await expect.element(page.getByRole('heading', { name: 'Йога' })).toBeVisible();
    await page.getByText('Что-то пошло не так. Попробуй ещё раз.').click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
  });

  it('свайп по привычке: сервер удалил — ошибки нет', async () => {
    await renderApp(<Screen today={response({ tasks: [task({ id: 7, title: 'Йога' })] })} />);
    swipeAway(page.getByRole('heading', { name: 'Йога' }).element());
    minimize();
    await expect.poll(() => m.api.deleteTask.mock.calls.length).toBe(1);
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
  });

  it('группы — под личным, заголовок открывает группу', async () => {
    const onOpenGroup = vi.fn();
    await renderApp(<Screen today={response({ groups: [family] })} onOpenGroup={onOpenGroup} />);
    await expect.element(page.getByText('Вынести мусор')).toBeVisible();
    await page.getByRole('button', { name: /Семья/ }).click();
    expect(onOpenGroup).toHaveBeenCalledWith(10);
  });

  it('старый ответ без групп — блоков групп нет', async () => {
    await renderApp(<Screen today={{ ...response(), groups: undefined as unknown as GroupToday[] }} />);
    await expect.element(page.getByText('На сегодня всё')).toBeVisible();
  });
});
