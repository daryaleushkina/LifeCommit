// Блок «Дела»: строки, галочки, фильтр «Осталось», добавление, «Потом», правка и удаление свайпом с «Вернуть».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Todo } from '../../shared/types';
import { api } from '../api';
import { caches } from '../caches';
import { RemovalHost } from '../removal';
import { renderApp } from '../test/render';
import { endTime, SourceMark, TodoList } from './TodoList';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: { laterTodos: vi.fn() } }));

const TODAY = '2026-10-03';
const todo = (p: Partial<Todo> = {}): Todo => ({ id: 1, title: 'Купить молоко', day: TODAY, done: false, time: null, duration_min: null, recurring: false, source: null, details: null, ...p });

function setup(todos: Todo[], props: Partial<Parameters<typeof TodoList>[0]> = {}) {
  const cb = {
    onToggle: vi.fn(),
    onAdd: vi.fn(),
    onUpdate: vi.fn(async () => {}),
    onRemove: vi.fn(async () => {}),
    onHide: vi.fn(async () => {}),
  };
  const r = renderApp(
    <>
      <TodoList todos={todos} today={TODAY} {...cb} {...props} />
      <RemovalHost />
    </>,
  );
  return { r, ...cb };
}

/** Свернули приложение — отложенное удаление уходит на сервер сразу. */
function appHidden() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  delete (document as { visibilityState?: unknown }).visibilityState;
}

/** Смахнуть строку влево так, чтобы открылись кнопки. */
async function openSwipe(row: Element) {
  const body = row.closest('li')!.querySelector<HTMLElement>('.swipe-body')!;
  const fire = (type: string, x: number) => body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: 10 }));
  fire('pointerdown', 300);
  fire('pointermove', 280);
  fire('pointermove', 120);
  await expect.poll(() => body.style.transform).toBe('translateX(-180px)');
  fire('pointerup', 120);
}

const main = (title: string) => page.getByText(title, { exact: true });
const rowOf = (title: string) => main(title).element().closest('li')!;

beforeEach(() => {
  vi.clearAllMocks();
  caches.later = null;
  try {
    localStorage.clear();
  } catch {
    // нет хранилища
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  appHidden(); // не оставлять отложенное удаление следующему тесту
});

describe('вспомогательное', () => {
  it('endTime: конец события в пределах суток', () => {
    expect(endTime('10:00', 60)).toBe('11:00');
    expect(endTime('09:45', 30)).toBe('10:15');
    expect(endTime('23:30', 45)).toBeNull();
  });

  it('метка источника: A — Apple, G — Google, своё — без метки', async () => {
    const { container } = await renderApp(
      <>
        <SourceMark source="apple" />
        <SourceMark source="google" />
        <SourceMark source={null} />
      </>,
    );
    await expect.element(page.getByLabelText('Apple')).toHaveTextContent('A');
    await expect.element(page.getByLabelText('Google')).toHaveTextContent('G');
    expect(container.querySelectorAll('.src-mark')).toHaveLength(2);
  });
});

describe('заголовок блока', () => {
  it('«Дела», «События», «События и дела» или свой', async () => {
    const { r } = setup([]);
    const { rerender } = await r;
    const heading = page.getByRole('heading', { level: 2 });
    await expect.element(heading).toHaveTextContent('Дела');
    const cb = { onToggle: vi.fn(), onAdd: vi.fn(), onUpdate: vi.fn(), onRemove: vi.fn() };
    await rerender(<TodoList todos={[todo({ source: 'google' })]} today={TODAY} {...cb} />);
    await expect.element(heading).toHaveTextContent('События');
    await rerender(<TodoList todos={[todo({ source: 'google' }), todo({ id: 2, title: 'Своё' })]} today={TODAY} {...cb} />);
    await expect.element(heading).toHaveTextContent('События и дела');
    await rerender(<TodoList todos={[todo()]} today={TODAY} heading="Пятница, 3 октября" {...cb} />);
    await expect.element(heading).toHaveTextContent('Пятница, 3 октября');
  });
});

describe('строки', () => {
  it('своё дело: кружок отмечает, время, «со вчера» и «до …» мелко', async () => {
    const { r, onToggle } = setup([
      todo({ id: 1, title: 'Позвонить', day: '2026-10-02', time: '10:00', duration_min: 60 }),
      todo({ id: 2, title: 'Сделанное', done: true, day: '2026-10-02' }),
      todo({ id: 3, title: 'Поздно', time: '23:30', duration_min: 60 }),
      todo({ id: 4, title: 'Каждый вторник', recurring: true, day: '2026-09-29' }),
      todo({ id: 5, title: 'Давнее', day: '2026-09-20' }),
    ]);
    await r;
    await expect.element(page.getByText('со вчера · до 11:00')).toBeVisible();
    await expect.element(page.getByText('10:00', { exact: true })).toBeVisible();
    await expect.element(page.getByText('с 20 сентября')).toBeVisible();
    // Сделанное — без подписи; повторяющееся — без «со вчера»; конец после полуночи не пишем.
    expect(rowOf('Сделанное').querySelector('small')).toBeNull();
    expect(rowOf('Каждый вторник').querySelector('small')).toBeNull();
    expect(rowOf('Поздно').querySelector('small')).toBeNull();
    await page.getByRole('button', { name: 'Сделано: Позвонить' }).click();
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    const done = page.getByRole('button', { name: 'Не сделано: Сделанное' });
    await expect.element(done).toHaveAttribute('aria-pressed', 'true');
    expect(done.element().closest('li')!.classList.contains('done')).toBe(true);
  });

  it('событие календаря — без кружка, с меткой; «со вчера» только на «Сегодня»', async () => {
    const { r } = setup([todo({ title: 'Планёрка', source: 'apple', day: '2026-10-02' })], { showCarry: false });
    await r;
    await expect.element(page.getByRole('button', { name: /Сделано/ })).not.toBeInTheDocument();
    await expect.element(page.getByLabelText('Apple')).toBeVisible();
    expect(rowOf('Планёрка').querySelector('small')).toBeNull();
  });

  it('только что добавленное (без номера с сервера) не отмечается и не смахивается', async () => {
    const { r, onToggle } = setup([todo({ id: -5, title: 'Новое' })]);
    await r;
    const check = page.getByRole('button', { name: 'Сделано: Новое' });
    await expect.element(check).toBeDisabled();
    const li = check.element().closest('li')!;
    expect(li.className).toBe('pending');
    expect(li.querySelector('.swipe-body')).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('«Все · Осталось»', () => {
  it('прячет сделанные и запоминает выбор на устройстве', async () => {
    const list = [todo({ id: 1, title: 'Открытое' }), todo({ id: 2, title: 'Закрытое', done: true })];
    const { r } = setup(list, { filterable: true });
    const { unmount } = await r;
    const left = page.getByRole('button', { name: 'Осталось' });
    await expect.element(page.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true');
    await left.click();
    await expect.element(left).toHaveAttribute('aria-pressed', 'true');
    await expect.element(main('Закрытое')).not.toBeInTheDocument();
    await expect.element(main('Открытое')).toBeVisible();
    expect(localStorage.getItem('lc-todos-left')).toBe('1');
    await unmount();
    await setup(list, { filterable: true }).r;
    await expect.element(page.getByRole('button', { name: 'Осталось' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Все' }).click();
    await expect.element(main('Закрытое')).toBeVisible();
    expect(localStorage.getItem('lc-todos-left')).toBeNull();
  });

  // 05.10.2026: прошедший созвон из календаря висел в «Осталось» — отметить событие нельзя, оно не уходило никогда.
  it('прошедшие события из календаря уходят; идущие, «на весь день» и свои несделанные — остаются', async () => {
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
    try {
      const list = [
        todo({ id: 1, title: 'Дейлик', time: '10:00', duration_min: 45, source: 'google' }),
        todo({ id: 2, title: 'Идёт сейчас', time: '11:30', duration_min: 60, source: 'google' }),
        todo({ id: 3, title: 'Утро без конца', time: '10:00', source: 'apple' }),
        todo({ id: 4, title: 'Только что без конца', time: '11:30', source: 'apple' }),
        todo({ id: 5, title: 'Конференция', source: 'google' }),
        todo({ id: 6, title: 'Созвон с мамой', time: '09:00' }),
        todo({ id: 7, title: 'Сделанное', done: true }),
      ];
      await setup(list, { filterable: true }).r;
      await page.getByRole('button', { name: 'Осталось' }).click();
      for (const gone of ['Дейлик', 'Утро без конца', 'Сделанное']) await expect.element(main(gone)).not.toBeInTheDocument();
      for (const left of ['Идёт сейчас', 'Только что без конца', 'Конференция', 'Созвон с мамой']) await expect.element(main(left)).toBeVisible();
      await page.getByRole('button', { name: 'Все' }).click();
      await expect.element(main('Дейлик')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('только события со временем — переключатель есть; экран открыт — закончившееся уходит само', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(`${TODAY}T12:20:00`) });
    try {
      await setup([todo({ id: 1, title: 'Встреча', time: '11:30', duration_min: 60, source: 'google' })], { filterable: true }).r;
      await page.getByRole('button', { name: 'Осталось' }).click();
      await expect.element(main('Встреча')).toBeVisible();
      vi.advanceTimersByTime(11 * 60_000); // 12:31 — встреча кончилась в 12:30
      await expect.element(main('Встреча')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('только события — переключателя нет; без хранилища переключатель всё равно работает', async () => {
    const { r } = setup([todo({ source: 'google' })], { filterable: true });
    const { unmount } = await r;
    await expect.element(page.getByRole('group', { name: 'Какие дела показывать' })).not.toBeInTheDocument();
    await unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await setup([todo({ id: 1, title: 'Открытое' }), todo({ id: 2, title: 'Закрытое', done: true })], { filterable: true }).r;
    await expect.element(page.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Осталось' }).click();
    await expect.element(main('Закрытое')).not.toBeInTheDocument();
  });
});

describe('новое дело', () => {
  it('Enter добавляет и оставляет поле открытым; пустое не добавляется; уход из поля — добавить и закрыть', async () => {
    const { r, onAdd } = setup([]);
    await r;
    await page.getByRole('button', { name: 'Дело на сегодня' }).click();
    const input = page.getByRole('textbox', { name: 'Дело на сегодня' });
    await expect.element(input).toHaveFocus();
    await input.fill('  Хлеб ');
    await userEvent.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledWith('Хлеб');
    await expect.element(input).toHaveValue('');
    await userEvent.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledOnce();
    await input.fill('Сыр');
    (input.element() as HTMLInputElement).blur();
    expect(onAdd).toHaveBeenLastCalledWith('Сыр');
    await expect.element(input).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Дело на сегодня' })).toBeVisible();
  });

  it('своя подпись строки; в прошедший день добавить нельзя — «В этот день ничего»', async () => {
    const { r } = setup([], { addLabel: 'Дело на этот день' });
    const { rerender } = await r;
    await page.getByRole('button', { name: 'Дело на этот день' }).click();
    await expect.element(page.getByRole('textbox', { name: 'Дело на этот день' })).toBeVisible();
    await rerender(<TodoList todos={[]} today={TODAY} canAdd={false} onToggle={vi.fn()} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    await expect.element(page.getByText('В этот день ничего')).toBeVisible();
    await expect.element(page.getByRole('textbox')).not.toBeInTheDocument();
    await rerender(<TodoList todos={[todo()]} today={TODAY} canAdd={false} onToggle={vi.fn()} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    await expect.element(page.getByText('В этот день ничего')).not.toBeInTheDocument();
  });
});

describe('правка дела', () => {
  it('тап по делу открывает шторку: «Готово» сохраняет, «Удалить дело» удаляет', async () => {
    const d = todo({ title: 'Купить молоко', time: '18:00' });
    const { r, onUpdate, onRemove } = setup([d]);
    await r;
    await main('Купить молоко').click();
    const sheet = page.getByRole('dialog', { name: 'Дело' });
    await expect.element(sheet).toBeVisible();
    await page.getByRole('textbox', { name: 'Дело' }).fill('Купить кефир');
    await sheet.getByRole('button', { name: 'Готово' }).click();
    expect(onUpdate).toHaveBeenCalledWith(d, { title: 'Купить кефир', day: TODAY, time: '18:00', location: '' });
    await expect.element(sheet).not.toBeInTheDocument();
    await main('Купить молоко').click();
    await page.getByRole('button', { name: 'Удалить дело' }).click();
    expect(onRemove).toHaveBeenCalledWith(d);
    await expect.element(sheet).not.toBeInTheDocument();
  });

  it('событие открывается как «Событие» с подробностями', async () => {
    await setup([todo({ title: 'Созвон', source: 'google', details: { link: 'https://zoom.us/j/1' } })]).r;
    await main('Созвон').click();
    await expect.element(page.getByRole('dialog', { name: 'Событие' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Подключиться/ })).toBeVisible();
  });
});

describe('удаление свайпом', () => {
  it('строка исчезает сразу, «Вернуть» возвращает, сервер ничего не узнаёт', async () => {
    const { r, onRemove } = setup([todo()]);
    await r;
    await openSwipe(main('Купить молоко').element());
    await page.getByRole('button', { name: 'Удалить' }).click();
    await expect.element(main('Купить молоко')).not.toBeInTheDocument();
    await expect.element(page.getByRole('status')).toHaveTextContent('«Купить молоко» удаленоВернуть');
    await page.getByRole('button', { name: 'Вернуть' }).click();
    await expect.element(main('Купить молоко')).toBeVisible();
    await expect.element(page.getByRole('status')).not.toBeInTheDocument();
    appHidden();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('через 5 секунд удаление уходит на сервер', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const d = todo();
      const { r, onRemove } = setup([d]);
      await r;
      await openSwipe(main('Купить молоко').element());
      await page.getByRole('button', { name: 'Удалить' }).click();
      await expect.element(page.getByRole('status')).toBeVisible();
      vi.advanceTimersByTime(4900);
      expect(onRemove).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(onRemove).toHaveBeenCalledWith(d);
    } finally {
      vi.useRealTimers();
    }
  });

  it('событие календаря: «Скрыть» — крайняя кнопка, «Удалить» — удалить и в календаре', async () => {
    const ev = todo({ id: 7, title: 'Планёрка', source: 'google' });
    const { r, onHide, onRemove } = setup([ev, todo({ id: 8, title: 'Своё' })]);
    await r;
    await openSwipe(main('Планёрка').element());
    await page.getByRole('button', { name: 'Скрыть' }).click();
    await expect.element(page.getByRole('status')).toHaveTextContent('«Планёрка» скрытоВернуть');
    await expect.element(main('Планёрка')).not.toBeInTheDocument();
    appHidden();
    expect(onHide).toHaveBeenCalledWith(ev);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('без onHide у события только «Удалить»', async () => {
    const ev = todo({ id: 7, title: 'Планёрка', source: 'apple' });
    const { r, onRemove } = setup([ev], { onHide: undefined });
    await r;
    await openSwipe(main('Планёрка').element());
    await expect.element(page.getByRole('button', { name: 'Скрыть' })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Удалить' }).click();
    appHidden();
    expect(onRemove).toHaveBeenCalledWith(ev);
  });
});

describe('«Потом»', () => {
  const later = [
    todo({ id: 21, title: 'Стрижка', day: '2026-10-04', time: '15:00' }),
    todo({ id: 22, title: 'Отчёт', day: '2026-10-06' }),
    todo({ id: 23, title: 'Подарок', day: '2026-10-06' }),
  ];

  it('ссылка «Потом · N» открывает список по дням; правка и удаление перечитывают его', async () => {
    vi.mocked(api.laterTodos).mockResolvedValue(later);
    const { r, onUpdate, onRemove } = setup([], { later: 3 });
    await r;
    await page.getByRole('button', { name: 'Потом · 3' }).click();
    const sheet = page.getByRole('dialog', { name: 'Запланировано' });
    await expect.element(sheet.getByRole('heading', { name: 'завтра' })).toBeVisible();
    await expect.element(sheet.getByRole('heading', { name: 'вт, 6 октября' })).toBeVisible();
    await expect.element(sheet.getByText('15:00')).toBeVisible();
    expect(sheet.getByRole('heading', { level: 3 }).elements()).toHaveLength(2);
    expect(api.laterTodos).toHaveBeenCalledOnce();

    await sheet.getByText('Отчёт').click();
    const edit = page.getByRole('dialog', { name: 'Дело' });
    await edit.getByRole('radio', { name: 'Завтра' }).click();
    await edit.getByRole('button', { name: 'Готово' }).click();
    expect(onUpdate).toHaveBeenCalledWith(later[1], { title: 'Отчёт', day: '2026-10-04', time: null, location: '' });
    await expect.poll(() => vi.mocked(api.laterTodos).mock.calls.length).toBe(2);

    await sheet.getByText('Подарок').click();
    await page.getByRole('button', { name: 'Удалить дело' }).click();
    expect(onRemove).toHaveBeenCalledWith(later[2]);
    await expect.poll(() => vi.mocked(api.laterTodos).mock.calls.length).toBe(3);

    // Смахнуть в «Потом»: убрать с «Вернуть», после удаления список перечитывается.
    await openSwipe(sheet.getByText('Стрижка').element());
    await sheet.getByRole('button', { name: 'Удалить' }).click();
    await expect.element(sheet.getByText('Стрижка')).not.toBeInTheDocument();
    appHidden();
    expect(onRemove).toHaveBeenLastCalledWith(later[0]);
    await expect.poll(() => vi.mocked(api.laterTodos).mock.calls.length).toBe(4);

    await userEvent.keyboard('{Escape}');
    await expect.element(sheet).not.toBeInTheDocument();
  });

  it('открывается сразу из подтянутого заранее; не загрузилось — остаётся, что было', async () => {
    caches.later = [later[1]!];
    vi.mocked(api.laterTodos).mockRejectedValue(new Error('offline'));
    await setup([], { later: 1 }).r;
    await page.getByRole('button', { name: 'Потом · 1' }).click();
    const sheet = page.getByRole('dialog', { name: 'Запланировано' });
    await expect.element(sheet.getByText('Отчёт')).toBeVisible();
    await expect.poll(() => api.laterTodos).toHaveBeenCalled();
    await expect.element(sheet.getByText('Отчёт')).toBeVisible();
  });

  it('ничего не подтянуто и не загрузилось — пустой список', async () => {
    vi.mocked(api.laterTodos).mockRejectedValue(new Error('offline'));
    await setup([], { later: 2 }).r;
    await page.getByRole('button', { name: 'Потом · 2' }).click();
    await expect.poll(() => api.laterTodos).toHaveBeenCalled();
    const sheet = page.getByRole('dialog', { name: 'Запланировано' });
    await expect.element(sheet).toBeVisible();
    expect(sheet.element().querySelectorAll('section')).toHaveLength(0);
  });

  it('по-английски — английские подписи дней', async () => {
    vi.mocked(api.laterTodos).mockResolvedValue([later[1]!]);
    const cb = { onToggle: vi.fn(), onAdd: vi.fn(), onUpdate: vi.fn(async () => {}), onRemove: vi.fn(async () => {}) };
    await renderApp(<TodoList todos={[todo({ day: '2026-10-02' })]} later={1} today={TODAY} {...cb} />, 'en');
    await expect.element(page.getByRole('heading', { name: 'To-dos' })).toBeVisible();
    await page.getByRole('button', { name: /Later/ }).click();
    await expect.element(page.getByRole('heading', { name: 'Tue, October 6' })).toBeVisible();
  });
});
