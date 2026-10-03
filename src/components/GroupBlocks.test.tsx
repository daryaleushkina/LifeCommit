// Блоки групп на «Сегодня»: мои дела каждой группы, отметка с откатом при ошибке, удаление свайпом.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { GroupDayItem, GroupToday } from '../../shared/groups';
import type { TodayResponse } from '../../shared/types';
import { api, type GroupDetail } from '../api';
import { caches } from '../caches';
import { RemovalHost } from '../removal';
import { renderApp } from '../test/render';
import type { Cache } from '../useTaskLog';
import { GroupBlocks } from './GroupBlocks';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: { today: vi.fn(), markItem: vi.fn(), deleteItem: vi.fn(), skipItem: vi.fn() } }));
const tg = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('@tma.js/sdk-react', async (orig) => ({
  ...(await orig<typeof import('@tma.js/sdk-react')>()),
  hapticFeedback: { notificationOccurred: { ifAvailable: tg.notify }, impactOccurred: { ifAvailable: vi.fn() } },
}));

const TODAY = '2026-10-03';
const ME = 1;
const item = (p: Partial<GroupDayItem>): GroupDayItem => ({
  id: 1, title: 'Дело', mode: 'one', time: null, duration_min: null, due_day: null, carried: false, recurring: false,
  people: [1, 2], all_members: false, rotate: false, turn: null, for_me: true, can_mark: true, done: false, done_by: [],
  target: null, total: null, unit: null, goal_until: null, start: TODAY, rrule: null, assignees: [], ...p,
});
const group = (p: Partial<GroupToday>): GroupToday => ({
  id: 10, title: 'Семья', kind: 'family', color: null, role: 'owner',
  members: [{ id: 1, name: 'Даша', photo: null }, { id: 2, name: 'Лёша', photo: null }], items: [], planned: 0, done: 0, ...p,
});
const todayOf = (groups: GroupToday[]): TodayResponse => ({ day: TODAY, tasks: [], archived: [], limits: { max_tasks: null, active: 0 }, todos: [], todos_later: 0, groups });

let latest: Cache;
function setup(groups: GroupToday[]) {
  const onOpen = vi.fn();
  function Harness() {
    const [cache, setCache] = useState<Cache>({ today: todayOf(groups), heat: [], loadedAt: 0 });
    latest = cache;
    return <GroupBlocks groups={cache.today.groups} me={ME} setCache={setCache} onOpen={onOpen} today={TODAY} />;
  }
  const r = renderApp(
    <>
      <Harness />
      <RemovalHost />
    </>,
  );
  return { r, onOpen };
}

function appHidden() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  delete (document as { visibilityState?: unknown }).visibilityState;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.markItem).mockResolvedValue({ ok: true, taken: false });
  vi.mocked(api.deleteItem).mockResolvedValue({ ok: true });
});
afterEach(() => appHidden());

const titles = (section: Element) => [...section.querySelectorAll('.todo-text > span:first-child')].map((s) => s.textContent);

describe('блоки групп', () => {
  it('только моё, по порядку: цель, по времени, без времени, мероприятия, сделанное', async () => {
    const family = group({
      planned: 3,
      done: 1,
      items: [
        item({ id: 1, title: 'Сделанное', done: true, done_by: [2] }),
        item({ id: 2, title: 'Ужин', mode: 'event', can_mark: false }),
        item({ id: 3, title: 'Без времени' }),
        item({ id: 4, title: 'В 18', time: '18:00' }),
        item({ id: 5, title: 'В 9', time: '09:00' }),
        item({ id: 6, title: 'Отпуск', mode: 'goal', total: 1, target: 2 }),
        item({ id: 7, title: 'Не моё', mode: 'assign', for_me: false }),
      ],
    });
    const empty = group({ id: 11, title: 'Работа', items: [item({ id: 8, title: 'Чужое', for_me: false })] });
    const sport = group({ id: 12, title: 'Спорт', items: [item({ id: 9, title: 'Пробежка', mode: 'event' })] });
    const { r, onOpen } = setup([family, empty, sport]);
    const { container } = await r;
    const sections = [...container.querySelectorAll('section.group-block')];
    expect(sections).toHaveLength(2);
    expect(titles(sections[0]!)).toEqual(['Отпуск', 'В 9', 'В 18', 'Без времени', 'Ужин', 'Сделанное']);
    await expect.element(page.getByText('1 из 3 сегодня')).toBeVisible();
    // Нет дел с отметкой — счётчика нет.
    expect(sections[1]!.querySelector('.group-block-head small')).toBeNull();
    await page.getByRole('button', { name: /^Семья/ }).click();
    expect(onOpen).toHaveBeenLastCalledWith(10);
    await page.getByText('Пробежка').click();
    expect(onOpen).toHaveBeenLastCalledWith(12);
    await page.getByRole('button', { name: '+ Положить' }).click();
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(onOpen).toHaveBeenLastCalledWith(10);
  });

  it('отметка: сразу на экране и вибрация, потом сервер и свежие «Сегодня»', async () => {
    const it1 = item({ id: 3, title: 'Мусор' });
    const fresh = todayOf([group({ planned: 1, done: 1, items: [{ ...it1, done: true, done_by: [ME] }] })]);
    let answer!: (v: TodayResponse) => void;
    vi.mocked(api.today).mockReturnValue(new Promise((res) => (answer = res)));
    await setup([group({ planned: 1, items: [it1] })]).r;
    await page.getByRole('button', { name: 'Сделано: Мусор' }).click();
    await expect.element(page.getByRole('button', { name: 'Не сделано: Мусор' })).toHaveAttribute('aria-pressed', 'true');
    expect(tg.notify).toHaveBeenCalledWith('success');
    await expect.poll(() => vi.mocked(api.markItem).mock.calls[0]).toEqual([10, 3, true]);
    expect(latest.today.groups[0]!.items[0]!.done_by).toEqual([ME]);
    answer(fresh);
    await expect.element(page.getByText('1 из 1 сегодня')).toBeVisible();
    expect(latest.today).toBe(fresh);
    expect(latest.loadedAt).toBeGreaterThan(0);
  });

  it('снять отметку — без вибрации; ошибка сервера откатывает', async () => {
    const it1 = item({ id: 3, title: 'Мусор', done: true, done_by: [2, ME] });
    vi.mocked(api.markItem).mockRejectedValue(new Error('offline'));
    vi.mocked(api.today).mockRejectedValue(new Error('offline'));
    await setup([group({ items: [it1, item({ id: 4, title: 'Другое' })] }), group({ id: 11, title: 'Работа', items: [item({ id: 3, title: 'Отчёт' })] })]).r;
    await page.getByRole('button', { name: 'Не сделано: Мусор' }).click();
    await expect.poll(() => vi.mocked(api.markItem).mock.calls[0]).toEqual([10, 3, false]);
    expect(tg.notify).not.toHaveBeenCalled();
    await expect.poll(() => api.today).toHaveBeenCalled();
    // Откат: дело снова сделано, как было до нажатия; соседние дела и группы не тронуты.
    await expect.element(page.getByRole('button', { name: 'Не сделано: Мусор' })).toHaveAttribute('aria-pressed', 'true');
    expect(latest.today.groups[0]!.items[0]).toEqual(it1);
    expect(latest.today.groups[1]!.items[0]!.title).toBe('Отчёт');
  });
});

describe('удаление свайпом', () => {
  it('после удаления забываем экран группы и перечитываем «Сегодня»', async () => {
    caches.groups.set(10, {} as GroupDetail);
    const fresh = todayOf([]);
    vi.mocked(api.today).mockResolvedValue(fresh);
    const { r } = setup([group({ items: [item({ id: 3, title: 'Мусор' })] })]);
    const { container } = await r;
    const body = container.querySelector<HTMLElement>('.swipe-body')!;
    const fire = (type: string, x: number) => body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: 10 }));
    fire('pointerdown', 300);
    fire('pointermove', 280);
    fire('pointermove', 150);
    await expect.poll(() => body.style.transform).toBe('translateX(-150px)');
    fire('pointerup', 150);
    await page.getByRole('button', { name: 'Удалить' }).click();
    appHidden();
    expect(api.deleteItem).toHaveBeenCalledWith(10, 3);
    await expect.poll(() => latest.today).toBe(fresh);
    expect(caches.groups.has(10)).toBe(false);
    expect(container.querySelector('section')).toBeNull();
  });

  it('не получилось перечитать — экран остаётся как есть', async () => {
    vi.mocked(api.today).mockRejectedValue(new Error('offline'));
    const { r } = setup([group({ items: [item({ id: 3, title: 'Мусор' }), item({ id: 4, title: 'Посуда' })] })]);
    const { container } = await r;
    const before = latest.today;
    const body = container.querySelector<HTMLElement>('.swipe-body')!;
    const fire = (type: string, x: number) => body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: 10 }));
    fire('pointerdown', 300);
    fire('pointermove', 280);
    fire('pointermove', 150);
    await expect.poll(() => body.style.transform).toBe('translateX(-150px)');
    fire('pointerup', 150);
    await page.getByRole('button', { name: 'Удалить' }).click();
    appHidden();
    await expect.poll(() => api.today).toHaveBeenCalled();
    expect(latest.today).toBe(before);
    await expect.element(page.getByText('Посуда')).toBeVisible();
  });
});
