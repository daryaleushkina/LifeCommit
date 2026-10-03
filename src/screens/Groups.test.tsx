// Вкладка «Вместе»: список групп с прогрессом дня и «Новая группа».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { GroupDayItem, GroupToday } from '../../shared/groups';
import type { GroupDetail } from '../api';
import { caches } from '../caches';
import { renderApp } from '../test/render';
import { Groups } from './Groups';

const m = vi.hoisted(() => ({ api: { groups: vi.fn(), createGroup: vi.fn(), group: vi.fn(), friends: vi.fn() } }));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));

const ME = 1;
/** Друзей здесь не открываем — их проверяет Friends.test.tsx. */
const friendsProps = { habits: [], onOpenFriend: () => {}, onRequests: () => {}, onShown: () => {} };
const item = (patch: Partial<GroupDayItem>): GroupDayItem => ({
  id: 1, title: 'Дело', mode: 'assign', time: null, duration_min: null, due_day: null, carried: false, recurring: false,
  people: [ME], all_members: false, rotate: false, turn: null, for_me: true, can_mark: true, done: false, done_by: [],
  target: null, total: null, unit: null, goal_until: null, start: '2026-10-03', rrule: null, assignees: [ME], ...patch,
});
const group = (patch: Partial<GroupToday>): GroupToday => ({
  id: 10, title: 'Семья', kind: 'family', color: null, role: 'owner',
  members: [{ id: ME, name: 'Даша', photo: null }, { id: 2, name: 'Миша', photo: null }],
  items: [], planned: 0, done: 0, ...patch,
});

beforeEach(() => {
  localStorage.removeItem('lc-together');
  caches.groupList = null;
  caches.groups.clear();
  m.api.groups.mockReset().mockResolvedValue([]);
  m.api.createGroup.mockReset().mockResolvedValue({ id: 11 });
  m.api.group.mockReset().mockResolvedValue(group({ id: 11, title: 'Бег' }) as GroupDetail);
});

describe('«Группы · Друзья»', () => {
  it('выбор раздела запоминается; «Позвать друга» — только в «Друзьях», открывается и закрывается', async () => {
    m.api.friends.mockResolvedValue({ friends: [], incoming: [], outgoing: [], link: 'https://t.me/x?startapp=f_a', prompt: false });
    await renderApp(<Groups {...friendsProps} me={ME} initial={[]} onOpen={() => {}} />);
    expect(page.getByRole('button', { name: 'Позвать друга' }).elements()).toEqual([]);
    await page.getByRole('radio', { name: 'Друзья' }).click();
    expect(localStorage.getItem('lc-together')).toBe('friends');
    await page.getByRole('button', { name: 'Позвать друга' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Позвать друга' })).toBeVisible();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await page.getByRole('radio', { name: 'Группы' }).click();
    expect(localStorage.getItem('lc-together')).toBe('groups');
  });

  it('хранилище сломалось — открываются группы, переключение всё равно работает', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    m.api.friends.mockResolvedValue({ friends: [], incoming: [], outgoing: [], link: '', prompt: false });
    await renderApp(<Groups {...friendsProps} me={ME} initial={[]} onOpen={() => {}} />);
    await expect.element(page.getByRole('radio', { name: 'Группы' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Друзья' }).click();
    await expect.element(page.getByRole('radio', { name: 'Друзья' })).toHaveAttribute('aria-checked', 'true');
    get.mockRestore();
    set.mockRestore();
  });

  it('раздел можно открыть сразу (пришли со ссылки друга)', async () => {
    m.api.friends.mockResolvedValue({ friends: [], incoming: [], outgoing: [], link: '', prompt: false });
    await renderApp(<Groups {...friendsProps} me={ME} initial={[]} onOpen={() => {}} section="friends" />);
    await expect.element(page.getByRole('radio', { name: 'Друзья' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Вкладка «Вместе»', () => {
  it('пока групп нет — подсказка завести', async () => {
    await renderApp(<Groups {...friendsProps} me={ME} initial={[]} onOpen={() => {}} />);
    await expect.element(page.getByText('Пока ни одной группы. Заведи семейную — или позови друга вдвоём.')).toBeVisible();
  });

  it('первый кадр — из «Сегодня», потом свежий список; прогресс, цель и «Тебе:»', async () => {
    const fresh = group({
      planned: 4,
      done: 1,
      items: [
        item({ id: 1, title: 'Вынести мусор' }),
        item({ id: 2, title: 'Отпуск', mode: 'goal', target: 1000, total: 250 }),
        item({ id: 3, title: 'Чужое', people: [2], for_me: false }),
      ],
    });
    m.api.groups.mockResolvedValue([fresh]);
    const onOpen = vi.fn();
    await renderApp(<Groups {...friendsProps} me={ME} initial={[group({ title: 'Старое имя' })]} onOpen={onOpen} />);
    await expect.element(page.getByText('Семья')).toBeVisible();
    await expect.element(page.getByText('2 человека')).toBeVisible();
    await expect.element(page.getByText('1 из 4 сегодня')).toBeVisible();
    await expect.element(page.getByText('Отпуск: 250 из 1 000')).toBeVisible();
    await expect.element(page.getByText('Тебе: Вынести мусор')).toBeVisible();
    await page.getByRole('button', { name: /Семья/ }).click();
    expect(onOpen).toHaveBeenCalledWith(10);
  });

  it('список уже в кэше — показывается он; не загрузился — остаётся как был', async () => {
    caches.groupList = [group({ title: 'Из кэша', items: [item({ mode: 'goal', target: null })] })];
    m.api.groups.mockRejectedValue(new Error('сеть'));
    await renderApp(<Groups {...friendsProps} me={ME} initial={[]} onOpen={() => {}} />);
    await expect.element(page.getByText('Из кэша')).toBeVisible();
    await expect.element(page.getByText(/из 0 сегодня/)).not.toBeInTheDocument();
  });

  it('ничего не было и список не загрузился — пустое состояние; новая группа станет первой в списке', async () => {
    m.api.groups.mockRejectedValue(new Error('сеть'));
    const onOpen = vi.fn();
    await renderApp(<Groups {...friendsProps} me={ME} initial={null as unknown as GroupToday[]} onOpen={onOpen} />);
    await expect.element(page.getByText(/Пока ни одной группы/)).toBeVisible();
    expect(caches.groupList).toBeNull();
    await page.getByRole('button', { name: 'Новая группа' }).click();
    await page.getByRole('textbox').fill('Бег');
    await page.getByRole('button', { name: 'Создать группу' }).click();
    await expect.poll(() => onOpen.mock.calls).toEqual([[11]]);
    expect(caches.groupList!.map((g) => g.id)).toEqual([11]);
  });

  it('общая цель, куда ещё ничего не положили, — «0 из …»', async () => {
    m.api.groups.mockResolvedValue([group({ items: [item({ title: 'Отпуск', mode: 'goal', target: 500, total: null })] })]);
    await renderApp(<Groups {...friendsProps} me={ME} initial={[]} onOpen={() => {}} />);
    await expect.element(page.getByText('Отпуск: 0 из 500')).toBeVisible();
  });

  it('«Новая группа»: пустое имя не создаёт, Enter создаёт, группа сразу в списке и открывается', async () => {
    m.api.groups.mockResolvedValue([group({})]);
    const onOpen = vi.fn();
    await renderApp(<Groups {...friendsProps} me={ME} initial={[]} onOpen={onOpen} />);
    await page.getByRole('button', { name: 'Новая группа' }).click();
    const create = page.getByRole('button', { name: 'Создать группу' });
    await expect.element(create).toBeDisabled();
    const input = page.getByRole('textbox', { name: 'Как назовём? Например, Семья' });
    await input.fill('   ');
    input.element().closest('form')!.requestSubmit();
    expect(m.api.createGroup).not.toHaveBeenCalled();
    await input.fill('  Бег  ');
    input.element().closest('form')!.requestSubmit();
    await expect.poll(() => onOpen.mock.calls).toEqual([[11]]);
    expect(m.api.createGroup).toHaveBeenCalledWith('Бег', 'other');
    expect(caches.groupList!.map((g) => g.id)).toEqual([10, 11]);
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('экран новой группы не догрузился — всё равно открываем, список не трогаем', async () => {
    caches.groupList = [group({})];
    m.api.groups.mockResolvedValue([group({})]);
    m.api.group.mockRejectedValue(new Error('сеть'));
    const onOpen = vi.fn();
    await renderApp(<Groups {...friendsProps} me={ME} initial={[]} onOpen={onOpen} />);
    await page.getByRole('button', { name: 'Новая группа' }).click();
    await page.getByRole('textbox').fill('Бег');
    await page.getByRole('button', { name: 'Создать группу' }).click();
    await expect.poll(() => onOpen.mock.calls).toEqual([[11]]);
    expect(caches.groupList!.map((g) => g.id)).toEqual([10]);
  });

  it('создать не вышло — ошибка, можно ещё раз; шторка закрывается', async () => {
    m.api.createGroup.mockRejectedValueOnce(new Error('сеть'));
    await renderApp(<Groups {...friendsProps} me={ME} initial={[]} onOpen={() => {}} />);
    await page.getByRole('button', { name: 'Новая группа' }).click();
    await page.getByRole('textbox').fill('Бег');
    await page.getByRole('button', { name: 'Создать группу' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Создать группу' })).toBeEnabled();
    await page.getByRole('dialog').element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });
});
