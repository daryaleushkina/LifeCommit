// Вкладка «Календарь»: день и месяц из кэша, листание, дела и групповые дела дня, подключённые календари.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { GroupDayBlock, GroupDayItem } from '../../shared/groups';
import type { Todo } from '../../shared/types';
import { ApiError, type CalendarAccount } from '../api';
import { caches } from '../caches';
import { renderApp } from '../test/render';
import { Calendar } from './Calendar';

const m = vi.hoisted(() => ({
  api: {
    calendar: vi.fn(), calendars: vi.fn(), googleUrl: vi.fn(), syncCalendars: vi.fn(), markItem: vi.fn(), updateTodo: vi.fn(),
    createTodo: vi.fn(), deleteTodo: vi.fn(), deleteItem: vi.fn(),
  },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));
// Шторку календарей проверяют отдельно; здесь — только когда она открывается и что делает экран после неё.
vi.mock('../components/CalendarsSheet', async (orig) => {
  const { createElement: h } = await import('react');
  return {
    ...(await orig<typeof import('../components/CalendarsSheet')>()),
    CalendarsSheet: ({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) =>
      h(
        'div',
        { role: 'dialog', 'aria-label': 'Шторка календарей' },
        h('button', { onClick: onClose }, 'Закрыть шторку'),
        h('button', { onClick: onChanged }, 'Календарь подключён'),
        // Вход Google закончен кодом впервые: шторка обновила список (кэш), а onChanged не зовёт — забирать пока нечего.
        h('button', { onClick: () => void import('../caches').then(({ caches: c }) => (c.accounts = [{ id: 7, provider: 'google', login: 'g@gmail.com', status: 'setup', last_sync_at: null, default_url: null, collections: [] }])) }, 'Google ждёт выбора'),
      ),
  };
});

const TODAY = '2026-10-03';
const ME = 1;
const todo = (patch: Partial<Todo>): Todo => ({
  id: 1, title: 'Дело', day: TODAY, done: false, time: null, duration_min: null, recurring: false, source: null, details: null, ...patch,
});
const item = (patch: Partial<GroupDayItem>): GroupDayItem => ({
  id: 1, title: 'Вынести мусор', mode: 'one', time: null, duration_min: null, due_day: null, carried: false, recurring: false,
  people: [ME, 2], all_members: false, rotate: false, turn: null, for_me: true, can_mark: true, done: false, done_by: [],
  target: null, total: null, unit: null, goal_until: null, start: TODAY, rrule: null, assignees: [], ...patch,
});
const family = { id: 10, title: 'Семья', kind: 'family' as const, members: [{ id: ME, name: 'Даша', photo: null }, { id: 2, name: 'Миша', photo: null }] };
let todos: Todo[];
let blocks: GroupDayBlock[];
const account = (patch: Partial<CalendarAccount>): CalendarAccount => ({
  id: 1, provider: 'apple', login: 'me@icloud.com', status: 'ok', last_sync_at: new Date().toISOString(), default_url: null, collections: [], ...patch,
});

async function setup(props: { openSheet?: boolean } = {}, lang: 'ru' | 'en' = 'ru') {
  const cb = { onChanged: vi.fn(), onOpenGroup: vi.fn() };
  await renderApp(<Calendar today={TODAY} me={ME} {...cb} {...props} />, lang);
  return cb;
}
const title = (text: string) => page.getByText(text, { exact: true });
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
  Object.assign(caches, { accounts: null, googleUrl: null, groupList: null, later: null });
  caches.days.clear();
  caches.groups.clear();
  localStorage.clear();
  todos = [
    todo({ id: 1, title: 'Купить молоко' }),
    todo({ id: 2, title: 'Созвон', time: '10:00', source: 'google' }),
    todo({ id: 3, title: 'Завтрашнее', day: '2026-10-04' }),
    todo({ id: 4, title: 'Вчерашнее', day: '2026-10-02', done: true }),
  ];
  blocks = [
    { day: TODAY, group: family, items: [item({})] },
    { day: '2026-10-05', group: family, items: [item({ id: 2, title: 'Ужин', mode: 'event' })] },
  ];
  for (const f of Object.values(m.api)) f.mockReset();
  m.api.calendar.mockImplementation(async (from: string, to: string) => ({
    today: TODAY,
    todos: todos.filter((d) => d.day >= from && d.day <= to),
    groups: blocks.filter((b) => b.day >= from && b.day <= to),
  }));
  m.api.calendars.mockResolvedValue([]);
  m.api.googleUrl.mockResolvedValue({ url: 'https://accounts.google.com/x' });
  m.api.syncCalendars.mockResolvedValue({ ok: true });
  m.api.markItem.mockResolvedValue({ ok: true, taken: false });
  m.api.updateTodo.mockResolvedValue({ ok: true });
  m.api.createTodo.mockResolvedValue({ id: 50 });
  m.api.deleteTodo.mockResolvedValue({ ok: true });
  m.api.deleteItem.mockResolvedValue({ ok: true });
});

describe('день', () => {
  it('дела дня и групповые дела; соседние дни и месяц подтягиваются заранее', async () => {
    await setup();
    await expect.element(page.getByRole('heading', { name: 'Календарь' })).toBeVisible();
    await expect.element(page.getByText('суббота, 3 октября')).toBeVisible();
    await expect.element(title('Купить молоко')).toBeVisible();
    await expect.element(title('Созвон')).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'События и дела' })).toBeVisible();
    await expect.element(title('Вынести мусор')).toBeVisible();
    await expect.element(page.getByRole('radio', { name: 'День' })).toHaveAttribute('aria-checked', 'true');
    // «К сегодня» на сегодняшнем дне есть, но невидимо: место под него держится.
    await expect.element(page.getByRole('button', { name: 'К сегодня', includeHidden: true })).toHaveAttribute('aria-hidden', 'true');
    const ranges = m.api.calendar.mock.calls.map(([a, b]) => `${a}:${b}`);
    expect(ranges).toEqual(expect.arrayContaining(['2026-10-03:2026-10-03', '2026-10-04:2026-10-04', '2026-10-02:2026-10-02', '2026-09-28:2026-11-01']));
  });

  it('уже виденный день — сразу из кэша, без ожидания; соседей повторно не грузит', async () => {
    caches.days.set(`${TODAY}:${TODAY}`, { todos: [todo({ title: 'Из кэша' })], groups: [] });
    caches.days.set('2026-10-04:2026-10-04', { todos: [], groups: [] });
    caches.days.set('2026-10-02:2026-10-02', { todos: [], groups: [] });
    caches.days.set('2026-09-28:2026-11-01', { todos: [], groups: [] });
    let release!: (v: unknown) => void;
    m.api.calendar.mockReturnValue(new Promise((r) => (release = r)));
    await setup();
    await expect.element(title('Из кэша')).toBeVisible();
    expect(m.api.calendar.mock.calls).toEqual([[TODAY, TODAY]]);
    // Отпускаем запрос: повторы одного запроса ждут первый (caches.ts), висящий мешал бы следующим тестам.
    release({ today: TODAY, todos: [todo({ title: 'Из кэша' })], groups: [] });
    await expect.poll(() => caches.days.get(`${TODAY}:${TODAY}`)?.todos[0]?.title).toBe('Из кэша');
  });

  it('день не загрузился — списка дел нет', async () => {
    m.api.calendar.mockRejectedValue(new Error('сеть'));
    await setup();
    await expect.element(page.getByText('суббота, 3 октября')).toBeVisible();
    await expect.poll(() => m.api.calendar.mock.calls.length).toBeGreaterThan(0);
    await expect.element(page.getByRole('button', { name: 'Дело на этот день' })).not.toBeInTheDocument();
  });

  it('листать: завтра — можно добавить дело, «К сегодня» возвращает; вчера — добавлять нельзя', async () => {
    await setup();
    await page.getByRole('button', { name: 'Следующий день' }).click();
    await expect.element(page.getByText('воскресенье, 4 октября')).toBeVisible();
    await expect.element(title('Завтрашнее')).toBeVisible();
    await page.getByRole('button', { name: 'Дело на этот день' }).click();
    const input = page.getByRole('textbox', { name: 'Дело на этот день' });
    await input.fill('Отвезти документы');
    input.element().closest('form')!.requestSubmit();
    await expect.element(title('Отвезти документы')).toBeVisible();
    expect(m.api.createTodo).toHaveBeenCalledWith({ title: 'Отвезти документы', day: '2026-10-04' });

    await page.getByRole('button', { name: 'К сегодня' }).click();
    await expect.element(page.getByText('суббота, 3 октября')).toBeVisible();
    await page.getByRole('button', { name: 'Предыдущий день' }).click();
    await expect.element(page.getByText('пятница, 2 октября')).toBeVisible();
    await expect.element(title('Вчерашнее')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Дело на этот день' })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Предыдущий день' }).click();
    await expect.element(page.getByText('В этот день ничего')).toBeVisible();
  });

  // 05.10.2026 (хук перед пушем, под нагрузкой): перешла на завтра и сразу добавила дело, пока день перечитывался, —
  // перечитка спросила ещё раз, пока дело создавалось, получила день без него, и строка пропала насовсем.
  it('дело, добавленное, пока день перечитывается, не пропадает', async () => {
    await setup();
    await expect.poll(() => caches.days.has('2026-10-04:2026-10-04')).toBe(true); // завтра подтянуто заранее
    const base = m.api.calendar.getMockImplementation()!;
    let reread: ((v: unknown) => void) | null = null;
    m.api.calendar.mockImplementation((from: string, to: string) =>
      from === '2026-10-04' && to === '2026-10-04' && !reread ? new Promise((r) => (reread = r)) : base(from, to),
    );
    let created!: (v: { id: number }) => void;
    m.api.createTodo.mockReturnValue(new Promise((r) => (created = r)));

    await page.getByRole('button', { name: 'Следующий день' }).click();
    await expect.poll(() => reread).not.toBeNull(); // перечитка завтрашнего дня ушла и висит
    await page.getByRole('button', { name: 'Дело на этот день' }).click();
    const input = page.getByRole('textbox', { name: 'Дело на этот день' });
    await input.fill('Отвезти документы');
    input.element().closest('form')!.requestSubmit();
    await expect.element(title('Отвезти документы')).toBeVisible();

    reread!(await base('2026-10-04', '2026-10-04')); // перечитка вернулась — дела там ещё нет
    await new Promise((r) => setTimeout(r, 0)); // и всё, что за ней последовало, уже случилось
    todos.push(todo({ id: 99, title: 'Отвезти документы', day: '2026-10-04' }));
    created({ id: 99 });
    await expect.element(title('Отвезти документы')).toBeVisible();
    await expect.poll(() => caches.days.get('2026-10-04:2026-10-04')!.todos.map((d) => d.id)).toContain(99);
  });

  it('галочка дела — на сервер; не прошла — сообщение, тап убирает', async () => {
    m.api.updateTodo.mockRejectedValueOnce(new Error('сеть'));
    await setup();
    await page.getByRole('button', { name: 'Сделано: Купить молоко' }).click();
    expect(m.api.updateTodo).toHaveBeenCalledWith(1, { done: true });
    const error = page.getByText('Что-то пошло не так. Попробуй ещё раз.');
    await expect.element(error).toBeVisible();
    await error.click();
    await expect.element(error).not.toBeInTheDocument();
  });

  it('отметка не прошла, когда её день уже выпал из кэша (обновили календари) — ничего не ломается', async () => {
    let fail!: (e: Error) => void;
    m.api.updateTodo.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    const { onChanged } = await setup();
    await page.getByRole('button', { name: 'Сделано: Купить молоко' }).click();
    await page.getByRole('button', { name: 'Следующий день' }).click();
    await expect.element(title('Завтрашнее')).toBeVisible();
    await page.getByRole('button', { name: 'Календари' }).click();
    await page.getByRole('button', { name: 'Календарь подключён' }).click();
    // Виденные дни забыты сразу; перечитка завтрашнего ждёт отметку, которая ещё у сервера (caches.ts).
    await expect.poll(() => caches.days.has(`${TODAY}:${TODAY}`)).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
    fail(new Error('сеть'));
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    await expect.element(title('Завтрашнее')).toBeVisible();
  });

  it('удалить дело свайпом — на сервер, день перечитан, «Сегодня» узнаёт', async () => {
    const { onChanged } = await setup();
    swipeAway(title('Купить молоко').element());
    await expect.element(title('Купить молоко')).not.toBeInTheDocument();
    todos = todos.filter((d) => d.id !== 1);
    minimize();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    expect(m.api.deleteTodo).toHaveBeenCalledWith(1);
  });

  it('групповое дело: отметка с этим днём, потом перечитать; шапка и строка открывают группу', async () => {
    const { onChanged, onOpenGroup } = await setup();
    await page.getByRole('button', { name: 'Сделано: Вынести мусор' }).click();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    expect(m.api.markItem).toHaveBeenCalledWith(10, 1, true, TODAY);
    // Отметка удалась — строки ошибки нет.
    expect(page.getByText('Что-то пошло не так. Попробуй ещё раз.').elements()).toEqual([]);
    m.api.markItem.mockRejectedValueOnce(new Error('сеть'));
    await page.getByRole('button', { name: 'Сделано: Вынести мусор' }).click();
    await expect.poll(() => onChanged.mock.calls.length).toBe(2);
    // Отметка не дошла до сервера — сказать об этом, а не молча оставить как было.
    await page.getByText('Что-то пошло не так. Попробуй ещё раз.').click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
    await page.getByRole('button', { name: /^Семья/ }).click();
    await title('Вынести мусор').click();
    expect(onOpenGroup.mock.calls).toEqual([[10], [10]]);
  });

  it('групповое дело уже не на мне (очередь сменилась) — «Это дело сегодня не на тебе», а не «попробуй ещё раз»', async () => {
    const { onChanged } = await setup();
    m.api.markItem.mockRejectedValueOnce(new ApiError(403, 'not_yours'));
    await page.getByRole('button', { name: 'Сделано: Вынести мусор' }).click();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    await expect.element(page.getByText('Это дело сегодня не на тебе')).toBeVisible();
    expect(page.getByText('Что-то пошло не так. Попробуй ещё раз.').elements()).toEqual([]);
  });

  it('групповое дело в будущем — только посмотреть, без галочки', async () => {
    blocks = [{ day: '2026-10-04', group: family, items: [item({ title: 'Завтра в группе' })] }];
    await setup();
    await page.getByRole('button', { name: 'Следующий день' }).click();
    await expect.element(title('Завтра в группе')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Сделано: Завтра в группе' })).not.toBeInTheDocument();
  });

  it('групповое дело свайпом — удаление, экран группы сброшен, день перечитан', async () => {
    caches.groups.set(10, {} as never);
    const { onChanged } = await setup();
    swipeAway(title('Вынести мусор').element());
    await expect.element(title('Вынести мусор')).not.toBeInTheDocument();
    minimize();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    expect(m.api.deleteItem).toHaveBeenCalledWith(10, 1);
    expect(caches.groups.has(10)).toBe(false);
  });
});

describe('месяц', () => {
  it('сетка месяца целыми неделями: точки несделанного (синие — из календаря), выбор дня', async () => {
    await setup();
    await page.getByRole('radio', { name: 'Месяц' }).click();
    const grid = page.getByRole('grid', { name: 'октябрь 2026' });
    await expect.element(grid).toBeVisible();
    const cells = grid.getByRole('gridcell').elements();
    expect(cells).toHaveLength(35);
    expect(cells[0]!.className).toContain('out');
    const third = grid.getByRole('gridcell', { name: '3' }).element();
    expect(third.className).toContain('today');
    expect(third.getAttribute('aria-selected')).toBe('true');
    await expect.poll(() => third.querySelectorAll('.cal-dots i').length).toBe(3);
    expect(third.querySelectorAll('.cal-dots i.ext')).toHaveLength(1);
    // Мероприятие точку не ставит, сделанное — тоже.
    expect(grid.getByRole('gridcell', { name: '5' }).element().querySelectorAll('.cal-dots i')).toHaveLength(0);
    expect(grid.getByRole('gridcell', { name: '2' }).element().querySelectorAll('.cal-dots i')).toHaveLength(0);
    await expect.element(page.getByRole('button', { name: 'К сегодня' })).not.toBeInTheDocument();

    await grid.getByRole('gridcell', { name: '5' }).click();
    await expect.element(page.getByRole('heading', { name: 'понедельник, 5 октября' })).toBeVisible();
    await expect.element(title('Ужин')).toBeVisible();
  });

  it('листать месяцы и вернуться в «День» на выбранный', async () => {
    await setup();
    await page.getByRole('radio', { name: 'Месяц' }).click();
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await expect.element(page.getByRole('grid', { name: 'ноябрь 2026' })).toBeVisible();
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect.element(page.getByRole('grid', { name: 'сентябрь 2026' })).toBeVisible();
    await page.getByRole('radio', { name: 'День' }).click();
    await expect.element(page.getByText('вторник, 1 сентября')).toBeVisible();
  });

  it('по-английски', async () => {
    await setup({}, 'en');
    await page.getByRole('radio', { name: 'Month' }).click();
    await expect.element(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  });
});

describe('подключённые календари', () => {
  it('ничего не подключено — плашка «Подключите календарь»: открывает шторку, крестик прячет насовсем', async () => {
    await setup();
    await expect.element(page.getByText('Подключите календарь')).toBeVisible();
    expect(m.api.googleUrl).toHaveBeenCalled();
    await page.getByRole('button', { name: 'Подключить' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Шторка календарей' })).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть шторку' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect.element(page.getByText('Подключите календарь')).not.toBeInTheDocument();
    expect(localStorage.getItem('lc-cal-banner-hidden')).toBe('1');
  });

  it('плашку уже прятали — её нет', async () => {
    localStorage.setItem('lc-cal-banner-hidden', '1');
    await setup();
    await expect.element(page.getByText('суббота, 3 октября')).toBeVisible();
    await expect.poll(() => m.api.calendars.mock.calls.length).toBe(1);
    await expect.element(page.getByText('Подключите календарь')).not.toBeInTheDocument();
  });

  it('хранилище недоступно — плашка показывается и прячется до закрытия', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('нет хранилища');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('нет хранилища');
    });
    try {
      await setup();
      await page.getByRole('button', { name: 'Отмена' }).click();
      await expect.element(page.getByText('Подключите календарь')).not.toBeInTheDocument();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('список календарей не загрузился — как будто их нет', async () => {
    m.api.calendars.mockRejectedValue(new Error('сеть'));
    await setup();
    await expect.element(page.getByText('Подключите календарь')).toBeVisible();
  });

  it('подключённые: метки состояния, тап по рабочей — обновить, по сломанной — шторка', async () => {
    const accounts = [
      account({ id: 1 }),
      account({ id: 2, provider: 'google', status: 'setup' }),
      account({ id: 3, status: 'auth_failed' }),
      account({ id: 4, provider: 'google', status: 'error' }),
    ];
    caches.accounts = accounts;
    m.api.calendars.mockResolvedValue(accounts);
    const { onChanged } = await setup();
    await expect.element(page.getByRole('button', { name: /обновлено только что/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Выберите календари/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Ввести новый пароль/ })).toHaveClass(/bad/);
    await expect.element(page.getByRole('button', { name: /Подключить заново/ })).toHaveClass(/bad/);
    await expect.element(page.getByText('Подключите календарь')).not.toBeInTheDocument();
    expect(m.api.googleUrl).not.toHaveBeenCalled();

    await page.getByRole('button', { name: /Ввести новый пароль/ }).click();
    await expect.element(page.getByRole('dialog', { name: 'Шторка календарей' })).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть шторку' }).click();

    await page.getByRole('button', { name: /обновлено только что/ }).click();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    expect(m.api.syncCalendars).toHaveBeenCalled();
  });

  it('«Обновить»: крутится, пока идёт; виденные дни забываются и день перечитывается', async () => {
    caches.accounts = [account({})];
    m.api.calendars.mockResolvedValue([account({})]);
    let finish!: () => void;
    m.api.syncCalendars.mockReturnValue(new Promise((r) => (finish = () => r({ ok: true }))));
    const { onChanged } = await setup();
    await expect.element(title('Купить молоко')).toBeVisible();
    const refresh = page.getByRole('button', { name: 'Обновить' });
    await refresh.click();
    await expect.element(refresh).toBeDisabled();
    await expect.element(refresh).toHaveClass(/spinning/);
    todos = [todo({ title: 'После обновления' })];
    finish();
    await expect.element(title('После обновления')).toBeVisible();
    await expect.element(refresh).toBeEnabled();
    expect(onChanged).toHaveBeenCalled();
    expect(caches.days.has('2026-10-04:2026-10-04')).toBe(false);
  });

  it('обновить не вышло и список не перечитался — остаётся прежний', async () => {
    caches.accounts = [account({})];
    m.api.calendars.mockResolvedValueOnce([account({})]).mockRejectedValue(new Error('сеть'));
    m.api.syncCalendars.mockRejectedValue(new Error('сеть'));
    const { onChanged } = await setup();
    await page.getByRole('button', { name: 'Обновить' }).click();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    await expect.element(page.getByRole('button', { name: /обновлено только что/ })).toBeVisible();
  });

  it('и прежнего не было — пусто', async () => {
    caches.accounts = [account({})];
    m.api.calendars.mockResolvedValueOnce([account({})]).mockRejectedValue(new Error('сеть'));
    const { onChanged } = await setup();
    await expect.poll(() => m.api.calendars.mock.calls.length).toBe(1);
    caches.accounts = null;
    await page.getByRole('button', { name: 'Обновить' }).click();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    await expect.element(page.getByText('Подключите календарь')).toBeVisible();
  });

  it('вернулись из входа Google — шторка сразу открыта; подключили — обновление', async () => {
    const { onChanged } = await setup({ openSheet: true });
    await expect.element(page.getByRole('dialog', { name: 'Шторка календарей' })).toBeVisible();
    await page.getByRole('button', { name: 'Календарь подключён' }).click();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    expect(m.api.syncCalendars).toHaveBeenCalled();
  });

  it('Google подключили в шторке впервые — закрыли её, и экран знает о нём: метка «Выберите календари», плашки нет', async () => {
    await setup({ openSheet: true });
    await expect.element(page.getByText('Подключите календарь')).toBeVisible();
    await page.getByRole('button', { name: 'Google ждёт выбора' }).click();
    await page.getByRole('button', { name: 'Закрыть шторку' }).click();
    await expect.element(page.getByRole('button', { name: /Выберите календари/ })).toBeVisible();
    await expect.element(page.getByText('Подключите календарь')).not.toBeInTheDocument();
  });

  it('шестерёнка открывает шторку календарей', async () => {
    await setup();
    await page.getByRole('button', { name: 'Календари' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Шторка календарей' })).toBeVisible();
  });
});
