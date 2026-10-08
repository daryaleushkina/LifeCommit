// Общие кусочки групп: аватарки, значок, число цели и строка группового дела (с удалением свайпом).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { GroupDayItem, GroupMember } from '../../shared/groups';
import { api, ApiError } from '../api';
import { RemovalHost } from '../removal';
import { renderApp } from '../test/render';
import { Avatar, AvatarStack, GroupBadge, GroupItemRow, goalNumber } from './groupUi';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: { deleteItem: vi.fn(), skipItem: vi.fn() } }));
const tg = vi.hoisted(() => ({ popup: true, show: vi.fn() }));
vi.mock('@tma.js/sdk-react', async (orig) => ({
  ...(await orig<typeof import('@tma.js/sdk-react')>()),
  popup: { show: Object.assign((p: unknown) => tg.show(p), { isAvailable: () => tg.popup }) },
}));

const TODAY = '2026-10-03';
const ME = 1;
const members: GroupMember[] = [
  { id: 1, name: 'Даша', photo: null },
  { id: 2, name: 'алёна', photo: null },
  { id: 3, name: 'Вера', photo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
];
const item = (p: Partial<GroupDayItem> = {}): GroupDayItem => ({
  id: 5, title: 'Вынести мусор', mode: 'one', time: null, duration_min: null, due_day: null, carried: false, recurring: false,
  people: [1, 2], all_members: false, rotate: false, turn: null, for_me: true, can_mark: true, done: false, done_by: [],
  target: null, total: null, unit: null, goal_until: null, start: TODAY, rrule: null, assignees: [], ...p,
});

function appHidden() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  delete (document as { visibilityState?: unknown }).visibilityState;
}

async function openSwipe(el: Element) {
  const body = el.closest('li')!.querySelector<HTMLElement>('.swipe-body')!;
  const fire = (type: string, x: number) => body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: 10 }));
  fire('pointerdown', 300);
  fire('pointermove', 280);
  fire('pointermove', 150);
  await expect.poll(() => body.style.transform).toBe('translateX(-150px)');
  fire('pointerup', 150);
}

beforeEach(() => {
  vi.clearAllMocks();
  tg.popup = true;
  vi.mocked(api.deleteItem).mockResolvedValue({ ok: true });
  vi.mocked(api.skipItem).mockResolvedValue({ ok: true });
});
afterEach(() => appHidden());

function row(it: GroupDayItem, extra: Partial<Parameters<typeof GroupItemRow>[0]> = {}) {
  const cb = { onToggle: vi.fn(), onOpen: vi.fn(), onPut: vi.fn(), after: vi.fn() };
  const r = renderApp(
    <>
      <ul className="card todo-list">
        <GroupItemRow item={it} members={members} me={ME} onToggle={cb.onToggle} onOpen={cb.onOpen} onPut={cb.onPut} swipe={{ groupId: 9, day: TODAY, after: cb.after }} {...extra} />
      </ul>
      <RemovalHost />
    </>,
  );
  return { r, ...cb };
}

const meta = (container: HTMLElement) => container.querySelector('.group-meta')?.textContent ?? null;

describe('аватарки и значок', () => {
  it('фото или первая буква с цветом по id; без имени — «?»', async () => {
    const { container } = await renderApp(
      <>
        <Avatar member={members[2]!} size={40} />
        <Avatar member={members[1]!} />
        <Avatar member={{ id: -8, name: '', photo: null }} />
      </>,
    );
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(members[2]!.photo);
    expect(img.style.width).toBe('40px');
    const [a, b] = [...container.querySelectorAll<HTMLElement>('span.avatar')] as [HTMLElement, HTMLElement];
    expect(a.textContent).toBe('А');
    expect(a.style.width).toBe('28px');
    expect(a.style.fontSize).toBe('12px');
    expect(b.textContent).toBe('?');
    // id −8 и 2 дают один цвет: берётся модуль.
    expect(b.style.background).toBe(a.style.background);
  });

  // 04.10.2026 (/lc-explore): «🏠 Дом» и «🌸Аня» давали половинку суррогатной пары — пустой квадрат или «?» в ромбе.
  it('название или имя начинается с эмодзи — в кружке и значке эмодзи целиком', async () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    const { container } = await renderApp(
      <>
        <Avatar member={{ id: 3, name: '\u{1F338}Аня', photo: null }} />
        <GroupBadge id={5} title={'\u{1F3E0} Дом'} />
        <GroupBadge id={6} title={`${family} Семья`} />
      </>,
    );
    expect(container.querySelector('span.avatar')!.textContent).toBe('\u{1F338}');
    expect([...container.querySelectorAll('.group-badge')].map((b) => b.textContent)).toEqual(['\u{1F3E0}', family]);
  });

  it('стопка: не больше четырёх, остальные — «+N»', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Имя${i}`, photo: null }));
    const { container, rerender } = await renderApp(<AvatarStack members={many} size={20} />);
    expect(container.querySelectorAll('.avatar:not(.more)')).toHaveLength(4);
    expect(container.querySelector('.avatar.more')!.textContent).toBe('+2');
    await rerender(<AvatarStack members={many.slice(0, 3)} />);
    expect(container.querySelector('.avatar.more')).toBeNull();
    expect(container.querySelectorAll('.avatar')).toHaveLength(3);
  });

  it('значок группы — заглавная первая буква и размеры', async () => {
    const { container } = await renderApp(<GroupBadge id={4} title="семья" size={30} />);
    const badge = container.querySelector<HTMLElement>('.group-badge')!;
    expect(badge.textContent).toBe('С');
    expect(badge.style.borderRadius).toBe('10px');
    const big = await renderApp(<GroupBadge id={-4} title="Спорт" />);
    expect(big.container.querySelector<HTMLElement>('.group-badge')!.style.width).toBe('48px');
  });

  it('число цели: просто число, деньги или слово в нужной форме', () => {
    const fmt = (n: number) => String(n);
    expect(goalNumber(27, { unit: null }, fmt)).toBe('27');
    expect(goalNumber(62400, { unit: { type: 'money', forms: ['рубль', 'рубля', 'рублей'], currency: '₽' } }, fmt)).toBe('62400 ₽');
    expect(goalNumber(3, { unit: { type: 'book', forms: ['книга', 'книги', 'книг'] } }, fmt)).toBe('3 книги');
  });
});

describe('строка группового дела', () => {
  it('«кто-то один»: время, галочка, кто сделал', async () => {
    const { r, onToggle, onOpen } = row(item({ time: '19:00', done: true, done_by: [1, 2, 99] }));
    const { container } = await r;
    expect(meta(container)).toBe('19:00кто-то одинсделано: Я, алёна, …');
    const check = page.getByRole('button', { name: 'Не сделано: Вынести мусор' });
    await expect.element(check).toHaveAttribute('aria-pressed', 'true');
    expect(check.element().closest('li')!.classList.contains('done')).toBe(true);
    await check.click();
    expect(onToggle).toHaveBeenCalledOnce();
    await page.getByText('Вынести мусор').click();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('мероприятие — без галочки', async () => {
    const { container } = await row(item({ mode: 'event', can_mark: false })).r;
    expect(meta(container)).toBe('мероприятие');
    expect(container.querySelector('.todo-event')).not.toBeNull();
    expect(container.querySelector('.todo-check')).toBeNull();
  });

  it('назначенное: очередь, одному, каждому; чужое — галочка без кнопки', async () => {
    const assign = item({ mode: 'assign', can_mark: false });
    const cases: [Partial<GroupDayItem>, string, string][] = [
      [{ turn: ME, people: [ME] }, 'твоя очередь', 'badge me'],
      [{ turn: 2, people: [2] }, 'очередь: алёна', 'badge gray'],
      [{ people: [ME] }, 'тебе', 'badge me'],
      [{ people: [2] }, 'алёна', 'badge amber'],
      [{ people: [1, 2] }, 'каждому', 'badge blue'],
    ];
    for (const [patch, text, cls] of cases) {
      const { container } = await row({ ...assign, ...patch }, { swipe: undefined }).r;
      expect(meta(container)).toBe(text);
      expect(container.querySelector('.group-meta .badge')!.className).toBe(cls);
      expect(container.querySelector('span.todo-check')!.className).toBe('todo-check ghost');
    }
    const { container } = await row({ ...assign, people: [2], done: true, done_by: [2] }).r;
    expect(container.querySelector('span.todo-check')!.className).toBe('todo-check filled');
  });

  it('без пометок — только название', async () => {
    const { container } = await row(item({ mode: 'assign', people: [], can_mark: true })).r;
    expect(meta(container)).toBe('каждому');
    const plain = await renderApp(
      <ul>
        <GroupItemRow item={item({ mode: 'goal', target: null, total: null })} members={members} me={ME} />
      </ul>,
    );
    // Цель без чисел: 0 из 1, кнопки «Положить» нет, смахнуть нельзя.
    await expect.element(page.getByText('0 из 1')).toBeVisible();
    expect(plain.container.querySelector('.goal-put')).toBeNull();
    expect(plain.container.querySelector('.swipe-body')).toBeNull();
  });

  it('общая цель: прогресс, единица, «Положить»', async () => {
    const goal = item({ mode: 'goal', title: 'Отпуск', total: 30000, target: 120000, unit: { type: 'money', forms: ['рубль', 'рубля', 'рублей'], currency: '₽' }, done_by: [1] });
    const { r, onPut, onOpen } = row(goal);
    const { container } = await r;
    await expect.element(page.getByText('30 000 ₽ из 120 000 ₽')).toBeVisible();
    expect(container.querySelector<HTMLElement>('.goal-bar i')!.style.width).toBe('25%');
    expect(container.querySelector('li')!.classList.contains('group-goal')).toBe(true);
    // У цели «кто сделал» не пишем.
    expect(container.textContent).not.toMatch(/сделано/);
    await page.getByRole('button', { name: '+ Положить' }).click();
    expect(onPut).toHaveBeenCalledOnce();
    await page.getByText('Отпуск').click();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('перевыполненная цель — полоса не шире 100%', async () => {
    const { container } = await row(item({ mode: 'goal', total: 50, target: 40 })).r;
    expect(container.querySelector<HTMLElement>('.goal-bar i')!.style.width).toBe('100%');
  });
});

describe('удаление свайпом', () => {
  it('разовое — сразу с «Вернуть», потом удаляется на сервере и экран перечитывается', async () => {
    const { r, after } = row(item());
    const { container } = await r;
    await openSwipe(page.getByText('Вынести мусор').element());
    await page.getByRole('button', { name: 'Удалить' }).click();
    await expect.element(page.getByRole('status')).toHaveTextContent('«Вынести мусор» удаленоВернуть');
    expect(container.querySelector('li')).toBeNull();
    appHidden();
    expect(api.deleteItem).toHaveBeenCalledWith(9, 5);
    await expect.poll(() => after.mock.calls.length).toBe(1);
    expect(tg.show).not.toHaveBeenCalled();
  });

  it('повторяющееся — спрашивает: «Убрать только сегодня»', async () => {
    const { r, after } = row(item({ recurring: true, rrule: 'FREQ=DAILY' }));
    await r;
    await openSwipe(page.getByText('Вынести мусор').element());
    await page.getByRole('button', { name: 'Удалить' }).click();
    const ask = page.getByRole('dialog', { name: '«Вынести мусор»' });
    await expect.element(ask).toBeVisible();
    await expect.element(ask.getByText('Дело общее и повторяется. Убрать его только сегодня или удалить у всех в группе?')).toBeVisible();
    await page.getByRole('button', { name: 'Убрать только сегодня' }).click();
    await expect.element(ask).not.toBeInTheDocument();
    await expect.element(page.getByRole('status')).toHaveTextContent('«Вынести мусор» убрано на сегодняВернуть');
    appHidden();
    expect(api.skipItem).toHaveBeenCalledWith(9, 5, TODAY);
    expect(api.deleteItem).not.toHaveBeenCalled();
    await expect.poll(() => after.mock.calls.length).toBe(1);
  });

  it('повторяющееся — «Удалить для всех»; передумали — Escape', async () => {
    const { r } = row(item({ recurring: true, rrule: 'FREQ=DAILY' }));
    await r;
    await openSwipe(page.getByText('Вынести мусор').element());
    await page.getByRole('button', { name: 'Удалить' }).click();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(page.getByText('Вынести мусор')).toBeVisible();
    await openSwipe(page.getByText('Вынести мусор').element());
    await page.getByRole('button', { name: 'Удалить' }).click();
    await page.getByRole('button', { name: 'Удалить для всех' }).click();
    appHidden();
    expect(api.deleteItem).toHaveBeenCalledWith(9, 5);
    expect(api.skipItem).not.toHaveBeenCalled();
  });

  it('повторяющаяся цель удаляется без вопроса', async () => {
    await row(item({ mode: 'goal', recurring: true, total: 1, target: 2 })).r;
    await openSwipe(page.getByText('Вынести мусор').element());
    await page.getByRole('button', { name: 'Удалить' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    appHidden();
    expect(api.deleteItem).toHaveBeenCalledWith(9, 5);
  });

  it('удалять могут только админы — объясняем всплывающим окном; другая ошибка — общий текст', async () => {
    vi.mocked(api.deleteItem).mockRejectedValueOnce(new ApiError(403, 'admins_only'));
    const first = row(item());
    const { unmount } = await first.r;
    await openSwipe(page.getByText('Вынести мусор').element());
    await page.getByRole('button', { name: 'Удалить' }).click();
    appHidden();
    await expect.poll(() => tg.show.mock.calls.length).toBe(1);
    expect(tg.show).toHaveBeenCalledWith({ message: 'В этой группе дела удаляют только админы' });
    await expect.poll(() => first.after.mock.calls.length).toBe(1);
    await unmount();

    vi.mocked(api.deleteItem).mockRejectedValueOnce(new Error('network'));
    await row(item({ id: 6 })).r;
    await openSwipe(page.getByText('Вынести мусор').element());
    await page.getByRole('button', { name: 'Удалить' }).click();
    appHidden();
    await expect.poll(() => tg.show.mock.calls.length).toBe(2);
    expect(tg.show).toHaveBeenLastCalledWith({ message: 'Что-то пошло не так. Попробуй ещё раз.' });
  });

  it('вне Telegram ошибку не показываем, экран всё равно перечитываем', async () => {
    tg.popup = false;
    vi.mocked(api.deleteItem).mockRejectedValueOnce(new ApiError(403, 'admins_only'));
    const { r, after } = row(item());
    await r;
    await openSwipe(page.getByText('Вынести мусор').element());
    await page.getByRole('button', { name: 'Удалить' }).click();
    appHidden();
    await expect.poll(() => after.mock.calls.length).toBe(1);
    expect(tg.show).not.toHaveBeenCalled();
  });
});
