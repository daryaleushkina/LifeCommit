// Экран группы: дела дня с отметками, «Скоро», люди и приглашение, вклад в цель, настройки и чат Telegram.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { GroupDayItem } from '../../shared/groups';
import { ApiError, type GroupDetail } from '../api';
import { caches } from '../caches';
import { renderApp } from '../test/render';
import { Group } from './Group';

const m = vi.hoisted(() => ({
  api: {
    group: vi.fn(), markItem: vi.fn(), invite: vi.fn(), checkGroupChat: vi.fn(), disconnectGroupChat: vi.fn(), deleteGroup: vi.fn(),
    leaveGroup: vi.fn(), updateGroup: vi.fn(), addEntry: vi.fn(), deleteItem: vi.fn(),
  },
  tg: { popup: false, answer: 'ok' as string | null, popups: [] as unknown[], link: false, links: [] as string[] },
  back: { current: null as (() => void) | null },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));
vi.mock('../telegram/hooks', () => ({
  useBackButton: (fn: (() => void) | null) => {
    m.back.current = fn;
  },
  useMainButton: () => {},
}));
vi.mock('@tma.js/sdk-react', async (orig) => {
  const real = await orig<typeof import('@tma.js/sdk-react')>();
  const show = Object.assign(
    async (p: unknown) => {
      m.tg.popups.push(p);
      return m.tg.answer;
    },
    { isAvailable: () => m.tg.popup },
  );
  const openTelegramLink = Object.assign((url: string) => void m.tg.links.push(url), { isAvailable: () => m.tg.link });
  return { ...real, popup: { ...real.popup, show }, openTelegramLink };
});
// Шторку дела проверяют отдельно; здесь — когда она открывается и что экран делает после неё.
vi.mock('../components/GroupItemSheet', async () => {
  const { createElement: h } = await import('react');
  return {
    GroupItemSheet: ({ item, onSaved, onClose }: { item?: GroupDayItem; onSaved: () => void; onClose: () => void }) =>
      h('div', { role: 'dialog', 'aria-label': item ? `Правка: ${item.title}` : 'Новое дело' }, h('button', { onClick: onSaved }, 'Сохранить дело'), h('button', { onClick: onClose }, 'Закрыть дело')),
  };
});

const TODAY = '2026-10-03';
const ME = 1;
const item = (patch: Partial<GroupDayItem>): GroupDayItem => ({
  id: 1, title: 'Дело', mode: 'one', time: null, duration_min: null, due_day: null, carried: false, recurring: false,
  people: [ME, 2], all_members: false, rotate: false, turn: null, for_me: true, can_mark: true, done: false, done_by: [],
  target: null, total: null, unit: null, goal_until: null, start: TODAY, rrule: null, assignees: [], ...patch,
});
const members = [{ id: ME, name: 'Даша', photo: null }, { id: 2, name: 'Миша', photo: null }];
const detail = (patch: Partial<GroupDetail> = {}): GroupDetail => ({
  id: 10, title: 'Семья', kind: 'family', color: null, role: 'owner', members, planned: 2, done: 1,
  items: [
    item({ id: 1, title: 'Вынести мусор' }),
    item({ id: 2, title: 'Погулять с собакой', mode: 'assign', time: '08:00', people: [ME] }),
    item({ id: 3, title: 'Ужин', mode: 'event', time: '19:00', can_mark: false }),
    item({ id: 4, title: 'Помыть посуду', mode: 'assign', done: true, done_by: [2], people: [2] }),
    item({ id: 5, title: 'Отпуск', mode: 'goal', target: 100000, total: 25000 }),
  ],
  settings: { admins_only_edit: false, rating_enabled: false, chat_digest: false, chat_reminders: false, tg_chat_title: null },
  upcoming: [
    { day: '2026-10-05', group: { id: 10, title: 'Семья', kind: 'family', members }, items: [item({ id: 6, title: 'Поездка', mode: 'event', recurring: true }), item({ id: 7, title: 'Полить цветы', recurring: true })] },
    { day: '2026-10-06', group: { id: 10, title: 'Семья', kind: 'family', members }, items: [item({ id: 8, title: 'Каждый день', recurring: true })] },
  ],
  ...patch,
});

async function setup(g: GroupDetail | null = detail()) {
  if (g) {
    caches.groups.set(10, g);
    m.api.group.mockResolvedValue(g);
  }
  const cb = { onBack: vi.fn(), onChanged: vi.fn() };
  await renderApp(<Group id={10} me={ME} today={TODAY} {...cb} />);
  return cb;
}
const text = (s: string) => page.getByText(s, { exact: true });
const toast = () => page.getByRole('status');
const openSettings = () => page.getByRole('button', { name: 'Настройки группы' }).click();
const settings = () => page.getByRole('dialog', { name: 'Настройки группы' });

beforeEach(() => {
  caches.groups.clear();
  caches.groupList = null;
  for (const f of Object.values(m.api)) f.mockReset();
  m.api.markItem.mockResolvedValue({ ok: true, taken: false });
  m.api.invite.mockResolvedValue({ code: 'abc123', link: 'https://t.me/LifeCommit_bot?startapp=g_abc123', expires_at: '' });
  m.api.checkGroupChat.mockResolvedValue({ tg_chat_title: null });
  m.api.disconnectGroupChat.mockResolvedValue({ ok: true });
  m.api.deleteGroup.mockResolvedValue({ ok: true });
  m.api.leaveGroup.mockResolvedValue({ ok: true });
  m.api.updateGroup.mockResolvedValue({ ok: true });
  m.api.addEntry.mockResolvedValue({ ok: true });
  m.api.deleteItem.mockResolvedValue({ ok: true });
  Object.assign(m.tg, { popup: false, answer: 'ok', popups: [], link: false, links: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('дела группы', () => {
  it('из кэша сразу: шапка с прогрессом, цель, дела по порядку, «Скоро» — разовые и мероприятия', async () => {
    await setup();
    await expect.element(page.getByRole('heading', { name: 'Семья' })).toBeVisible();
    await expect.element(page.getByText(/2 человека · 1 из 2 сегодня/)).toBeVisible();
    await expect.element(page.getByText('25 000 из 100 000')).toBeVisible();
    const today = [...document.querySelectorAll('.section-label + ul .todo-text > span')].map((e) => e.textContent);
    expect(today).toEqual(['Погулять с собакой', 'Вынести мусор', 'Ужин', 'Помыть посуду']);
    await expect.element(page.getByRole('heading', { name: 'Скоро' })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'понедельник, 5 октября' })).toBeVisible();
    await expect.element(text('Поездка')).toBeVisible();
    await expect.element(text('Полить цветы')).not.toBeInTheDocument();
    await expect.element(text('Каждый день')).not.toBeInTheDocument();
    expect(m.api.checkGroupChat).not.toHaveBeenCalled();
  });

  it('без кэша — пусто, пока не загрузится; не нашлась — «Приглашение не найдено»', async () => {
    m.api.group.mockRejectedValue(new ApiError(404, 'not_found'));
    await setup(null);
    await expect.element(page.getByText('Приглашение не найдено.')).toBeVisible();
  });

  it('без кэша и без сети — показать нечего, тоже «не найдено»', async () => {
    m.api.group.mockRejectedValue(new TypeError('Failed to fetch'));
    await setup(null);
    await expect.element(page.getByText('Приглашение не найдено.')).toBeVisible();
  });

  it('группу удалили или меня исключили (404) — «не найдено», даже если экран был в кэше', async () => {
    caches.groups.set(10, detail());
    m.api.group.mockRejectedValue(new ApiError(404, 'not_found'));
    await setup(null);
    await expect.element(page.getByText('Приглашение не найдено.')).toBeVisible();
  });

  it('моргнула сеть при перечитывании после отметки — экран группы остаётся', async () => {
    const { onChanged } = await setup();
    m.api.group.mockRejectedValue(new TypeError('Failed to fetch'));
    await page.getByRole('button', { name: 'Сделано: Вынести мусор' }).click();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    await expect.poll(() => m.api.group.mock.calls.length).toBe(2);
    await expect.element(page.getByRole('button', { name: 'Не сделано: Вынести мусор' })).toBeVisible();
    await expect.element(page.getByText('Приглашение не найдено.')).not.toBeInTheDocument();
  });

  it('ничего на сегодня и без плана — подсказка, прогресса нет, «Скоро» нет', async () => {
    await setup(detail({ items: [], planned: 0, upcoming: [] }));
    await expect.element(page.getByText('На сегодня в группе ничего')).toBeVisible();
    await expect.element(page.getByText(/2 человека$/)).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Скоро' })).not.toBeInTheDocument();
  });

  it('галочка — сразу на экране и на сервер, потом «Сегодня» и экран перечитываются', async () => {
    let answer!: (v: { ok: true; taken: boolean }) => void;
    m.api.markItem.mockReturnValueOnce(new Promise((r) => (answer = r)));
    const { onChanged } = await setup();
    await page.getByRole('button', { name: 'Сделано: Вынести мусор' }).click();
    await expect.element(page.getByRole('button', { name: 'Не сделано: Вынести мусор' })).toHaveAttribute('aria-pressed', 'true');
    expect(m.api.markItem).toHaveBeenCalledWith(10, 1, true);
    m.api.group.mockResolvedValue(detail({ items: detail().items.map((x) => (x.id === 1 ? { ...x, done: true, done_by: [ME] } : x)) }));
    answer({ ok: true, taken: false });
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    await expect.poll(() => m.api.group.mock.calls.length).toBe(2);
    await expect.element(page.getByRole('button', { name: 'Не сделано: Вынести мусор' })).toBeVisible();
    await page.getByRole('button', { name: 'Не сделано: Помыть посуду' }).click();
    expect(m.api.markItem).toHaveBeenLastCalledWith(10, 4, false);
  });

  it('кто-то успел раньше — «Уже кто-то сделал», тап убирает', async () => {
    m.api.markItem.mockResolvedValue({ ok: true, taken: true });
    await setup();
    await page.getByRole('button', { name: 'Сделано: Вынести мусор' }).click();
    await expect.element(toast()).toHaveTextContent('Уже кто-то сделал');
    await toast().click();
    await expect.element(toast()).not.toBeInTheDocument();
  });

  it('не моё дело — «Это дело сегодня не на тебе»; другая ошибка — общая; подсказка уходит сама', async () => {
    m.api.markItem.mockRejectedValueOnce(new ApiError(403, 'not_yours')).mockRejectedValueOnce(new Error('сеть'));
    await setup();
    await page.getByRole('button', { name: 'Сделано: Вынести мусор' }).click();
    await expect.element(toast()).toHaveTextContent('Это дело сегодня не на тебе');
    await page.getByRole('button', { name: 'Сделано: Погулять с собакой' }).click();
    await expect.element(toast()).toHaveTextContent('Что-то пошло не так. Попробуй ещё раз.');
    await expect.element(toast(), { timeout: 5000 }).not.toBeInTheDocument();
  });

  it('«+ Дело» и тап по делу открывают шторку дела; сохранили — перечитать', async () => {
    const { onChanged } = await setup();
    await page.getByRole('button', { name: 'Дело', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: 'Новое дело' })).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть дело' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await text('Ужин').click();
    await expect.element(page.getByRole('dialog', { name: 'Правка: Ужин' })).toBeVisible();
    await page.getByRole('button', { name: 'Сохранить дело' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    await text('Отпуск').click();
    await expect.element(page.getByRole('dialog', { name: 'Правка: Отпуск' })).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть дело' }).click();
    await text('Поездка').click();
    await expect.element(page.getByRole('dialog', { name: 'Правка: Поездка' })).toBeVisible();
  });

  it('удалить дело свайпом — экран перечитывается', async () => {
    const { onChanged } = await setup();
    const body = text('Вынести мусор').element().closest('.swipe')!.querySelector('.swipe-body')!;
    const r = body.getBoundingClientRect();
    const at = (x: number) => ({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: r.top + r.height / 2, bubbles: true });
    body.dispatchEvent(new PointerEvent('pointerdown', at(r.right - 10)));
    body.dispatchEvent(new PointerEvent('pointermove', at(r.right - 40)));
    body.dispatchEvent(new PointerEvent('pointermove', at(r.left - 20)));
    body.dispatchEvent(new PointerEvent('pointerup', at(r.left - 20)));
    await expect.element(text('Вынести мусор')).not.toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as { visibilityState?: unknown }).visibilityState;
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    expect(m.api.deleteItem).toHaveBeenCalledWith(10, 1);
  });

  it('по-английски — даты «Скоро» по-английски', async () => {
    caches.groups.set(10, detail());
    m.api.group.mockResolvedValue(detail());
    await renderApp(<Group id={10} me={ME} today={TODAY} onBack={() => {}} onChanged={() => {}} />, 'en');
    await expect.element(page.getByRole('heading', { name: 'Monday, October 5' })).toBeVisible();
  });

  it('кнопка «назад» Telegram — на вкладку, откуда пришли', async () => {
    const { onBack } = await setup();
    m.back.current?.();
    expect(onBack).toHaveBeenCalled();
  });
});

describe('вклад в общую цель', () => {
  it('«Положить»: только цифры, видно, сколько станет; уходит на сервер и перечитывается', async () => {
    const { onChanged } = await setup();
    await page.getByRole('button', { name: '+ Положить' }).click();
    const sheet = page.getByRole('dialog', { name: 'Положить · Отпуск' });
    const put = sheet.getByRole('button', { name: 'Положить' });
    await expect.element(put).toBeDisabled();
    const input = sheet.getByRole('textbox', { name: '5 000' });
    await input.fill('5 000р');
    await expect.element(input).toHaveValue('5 000');
    await expect.element(sheet.getByText('30 000 из 100 000')).toBeVisible();
    await put.click();
    await expect.element(sheet).not.toBeInTheDocument();
    expect(m.api.addEntry).toHaveBeenCalledWith(10, 5, 5000);
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
  });

  it('шторку «Положить» можно закрыть без вклада', async () => {
    await setup();
    await page.getByRole('button', { name: '+ Положить' }).click();
    const sheet = page.getByRole('dialog', { name: 'Положить · Отпуск' });
    sheet.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.element(sheet).not.toBeInTheDocument();
    expect(m.api.addEntry).not.toHaveBeenCalled();
  });

  it('цель без числа — без подсказки; не вышло — сообщение', async () => {
    m.api.addEntry.mockRejectedValue(new Error('сеть'));
    await setup(detail({ items: [item({ id: 5, title: 'Мечта', mode: 'goal', target: null, total: null })] }));
    await page.getByRole('button', { name: '+ Положить' }).click();
    const sheet = page.getByRole('dialog', { name: 'Положить · Мечта' });
    await sheet.getByRole('textbox').fill('1,5');
    await expect.element(sheet.getByText(/ из /)).not.toBeInTheDocument();
    await sheet.getByRole('button', { name: 'Положить' }).click();
    await expect.element(toast()).toHaveTextContent('Что-то пошло не так. Попробуй ещё раз.');
    expect(m.api.addEntry).toHaveBeenCalledWith(10, 5, 1.5);
  });
});

describe('люди', () => {
  it('участники, я отмечена, кто что сделал сегодня', async () => {
    await setup();
    await page.getByRole('radio', { name: 'Люди' }).click();
    await expect.element(text('Даша (Я)')).toBeVisible();
    await expect.element(text('Миша')).toBeVisible();
    await expect.element(page.getByText('сделано: Помыть посуду')).toBeVisible();
    await page.getByRole('radio', { name: 'Дела' }).click();
    await expect.element(text('Вынести мусор')).toBeVisible();
  });

  it('«Позвать в группу» в Telegram — окно «поделиться» со ссылкой и названием', async () => {
    m.tg.link = true;
    await setup();
    await page.getByRole('radio', { name: 'Люди' }).click();
    await page.getByRole('button', { name: 'Позвать в группу' }).click();
    await expect.element(toast()).toHaveTextContent('Ссылка готова — отправь её в чат');
    expect(m.api.invite).toHaveBeenCalledWith(10);
    expect(m.tg.links).toEqual([
      `https://t.me/share/url?url=${encodeURIComponent('https://t.me/LifeCommit_bot?startapp=g_abc123')}&text=${encodeURIComponent('Семья · LifeCommit')}`,
    ]);
  });

  it('вне Telegram — ссылка в новой вкладке', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await setup();
    await page.getByRole('radio', { name: 'Люди' }).click();
    await page.getByRole('button', { name: 'Позвать в группу' }).click();
    await expect.element(toast()).toBeVisible();
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://t.me/share/url?url='), '_blank');
  });
});

describe('настройки группы', () => {
  it('владелец переименовывает: Enter сохраняет, то же имя повторно не шлётся', async () => {
    const { onChanged } = await setup();
    await openSettings();
    const name = settings().getByRole('textbox', { name: 'Название группы' });
    await expect.element(name).toHaveValue('Семья');
    await name.fill('  Ивановы ');
    name.element().closest('form')!.requestSubmit();
    await expect.element(page.getByRole('heading', { name: 'Ивановы' })).toBeVisible();
    expect(m.api.updateGroup).toHaveBeenCalledWith(10, { title: 'Ивановы' });
    expect(onChanged).toHaveBeenCalled();
    settings().element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.element(settings()).not.toBeInTheDocument();
  });

  it('закрыли шторку с новым именем — сохраняется', async () => {
    await setup();
    await openSettings();
    await settings().getByRole('textbox').fill('Дача');
    settings().element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.element(page.getByRole('heading', { name: 'Дача' })).toBeVisible();
    expect(m.api.updateGroup).toHaveBeenCalledWith(10, { title: 'Дача' });
  });

  // 04.10.2026: раньше новое имя оставалось на экране, хотя сервер его не сохранил.
  it('имя не сохранилось на сервере — на экране прежнее и подсказка «что-то пошло не так»', async () => {
    m.api.updateGroup.mockRejectedValue(new Error('сеть'));
    const { onChanged } = await setup();
    await openSettings();
    const name = settings().getByRole('textbox');
    await name.fill('Дача');
    name.element().closest('form')!.requestSubmit();
    // Шторка открыта — ошибка в ней, в поле снова прежнее имя.
    await expect.element(settings().getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(name).toHaveValue('Семья');
    settings().element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.element(settings()).not.toBeInTheDocument();
    await expect.element(page.getByRole('heading', { name: 'Семья' })).toBeVisible();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('закрыли шторку с новым именем, а сервер не сохранил — прежнее имя и подсказка на экране группы', async () => {
    m.api.updateGroup.mockRejectedValue(new Error('сеть'));
    await setup();
    await openSettings();
    await settings().getByRole('textbox').fill('Дача');
    settings().element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.element(toast()).toHaveTextContent('Что-то пошло не так. Попробуй ещё раз.');
    await expect.element(page.getByRole('heading', { name: 'Семья' })).toBeVisible();
  });

  it('пустое имя не сохраняется', async () => {
    await setup();
    await openSettings();
    const name = settings().getByRole('textbox');
    await name.fill('   ');
    name.element().closest('form')!.requestSubmit();
    expect(m.api.updateGroup).not.toHaveBeenCalled();
  });

  it('«Дела заводят только админы» — сразу на экране и на сервер', async () => {
    await setup();
    await openSettings();
    const box = settings().getByRole('checkbox', { name: 'Дела заводят только админы' });
    await box.click();
    await expect.element(box).toBeChecked();
    expect(m.api.updateGroup).toHaveBeenCalledWith(10, { admins_only_edit: true });
    expect(settings().getByText('Что-то пошло не так. Попробуй ещё раз.').elements()).toEqual([]);
  });

  // 04.10.2026, сквозной тест под нагрузкой: перечитка группы (после удаления свайпом) ушла раньше, чем человек включил
  // «только админы», а пришла позже — и выключила переключатель обратно, хотя на сервере уже «включено».
  it('ответ, запрошенный до правки, её не затирает: «только админы» остаётся, экран перечитан после сервера', async () => {
    let answer: (g: GroupDetail) => void = () => {};
    caches.groups.set(10, detail());
    m.api.group.mockReturnValueOnce(new Promise<GroupDetail>((r) => (answer = r))).mockResolvedValue(detail({ settings: { ...detail().settings, admins_only_edit: true } }));
    await renderApp(<Group id={10} me={ME} today={TODAY} onBack={vi.fn()} onChanged={vi.fn()} />);
    await openSettings();
    const box = settings().getByRole('checkbox', { name: 'Дела заводят только админы' });
    await box.click();
    await expect.element(box).toBeChecked();
    answer(detail());
    await expect.poll(() => m.api.group.mock.calls.length).toBe(2);
    await expect.element(box).toBeChecked();
  });

  // 04.10.2026: раньше переключатель оставался включённым, хотя сервер настройку не сохранил.
  it('«только админы» не сохранилось — переключатель возвращается, в шторке ошибка', async () => {
    m.api.updateGroup.mockRejectedValue(new Error('сеть'));
    await setup();
    await openSettings();
    const box = settings().getByRole('checkbox', { name: 'Дела заводят только админы' });
    await box.click();
    await expect.element(settings().getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(box).not.toBeChecked();
  });

  it('без чата — «Подключить чат Telegram»: ссылка добавить бота в группу', async () => {
    m.tg.link = true;
    await setup();
    await openSettings();
    await expect.element(settings().getByText(/Бот будет присылать в чат/)).toBeVisible();
    await settings().getByRole('button', { name: 'Подключить чат Telegram' }).click();
    await expect.poll(() => m.tg.links).toEqual(['https://t.me/LifeCommit_bot?startgroup=g_abc123']);
  });

  it('вне Telegram — ссылка подключения в новой вкладке', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await setup();
    await openSettings();
    await settings().getByRole('button', { name: 'Подключить чат Telegram' }).click();
    await expect.poll(() => open.mock.calls).toEqual([['https://t.me/LifeCommit_bot?startgroup=g_abc123', '_blank']]);
  });

  it('подключённый чат: проверка, что жив; «Другой чат» и «Отключить» с подтверждением', async () => {
    m.tg.link = true;
    m.tg.popup = true;
    m.tg.answer = null;
    m.api.checkGroupChat.mockResolvedValue({ tg_chat_title: 'Семейный чат' });
    await setup(detail({ settings: { ...detail().settings, tg_chat_title: 'Семейный чат' } }));
    await expect.poll(() => m.api.checkGroupChat.mock.calls).toEqual([[10]]);
    await openSettings();
    await expect.element(settings().getByText('Чат Telegram')).toBeVisible();
    await expect.element(settings().getByText('Семейный чат')).toBeVisible();
    await settings().getByRole('button', { name: 'Другой чат' }).click();
    await expect.poll(() => m.tg.links.length).toBe(1);

    await settings().getByRole('button', { name: 'Отключить' }).click();
    await expect.poll(() => m.tg.popups.length).toBe(1);
    expect(m.tg.popups[0]).toMatchObject({ message: 'Отключить чат «Семейный чат»? Бот попрощается и выйдет из него.' });
    expect(m.api.disconnectGroupChat).not.toHaveBeenCalled();

    m.tg.answer = 'ok';
    await settings().getByRole('button', { name: 'Отключить' }).click();
    await expect.element(settings().getByRole('button', { name: 'Подключить чат Telegram' })).toBeVisible();
    expect(m.api.disconnectGroupChat).toHaveBeenCalledWith(10);
  });

  it('отключить вне Telegram — сразу; не вышло — экран перечитывается', async () => {
    m.api.checkGroupChat.mockRejectedValue(new Error('сеть'));
    m.api.disconnectGroupChat.mockRejectedValue(new Error('сеть'));
    await setup(detail({ settings: { ...detail().settings, tg_chat_title: 'Чат' } }));
    await openSettings();
    await settings().getByRole('button', { name: 'Отключить' }).click();
    await expect.poll(() => m.api.group.mock.calls.length).toBe(2);
  });

  it('чат удалили в Telegram — из настроек пропадает сразу', async () => {
    const stale = detail({ settings: { ...detail().settings, tg_chat_title: 'Старый чат' } });
    caches.groups.set(10, stale);
    let reload!: (g: GroupDetail) => void;
    m.api.group.mockReturnValue(new Promise((r) => (reload = r)));
    await setup(null);
    await expect.poll(() => m.api.checkGroupChat.mock.calls.length).toBe(1);
    await openSettings();
    await expect.element(settings().getByRole('button', { name: 'Подключить чат Telegram' })).toBeVisible();
    expect(caches.groups.get(10)!.settings.tg_chat_title).toBeNull();
    // Сервер при проверке уже отвязал чат — перечитанная группа тоже без него.
    reload(detail());
    await expect.poll(() => m.api.group.mock.calls.length).toBe(1);
    await expect.element(settings().getByRole('button', { name: 'Подключить чат Telegram' })).toBeVisible();
  });

  it('участник: имя без правки, без «только админы», чата и «Удалить группу»; подключённый чат — без кнопок', async () => {
    m.api.checkGroupChat.mockResolvedValue({ tg_chat_title: 'Чат' });
    await setup(detail({ role: 'member', settings: { ...detail().settings, tg_chat_title: 'Чат' } }));
    await openSettings();
    await expect.element(settings().getByText('Семья')).toBeVisible();
    await expect.element(settings().getByRole('textbox')).not.toBeInTheDocument();
    await expect.element(settings().getByRole('checkbox')).not.toBeInTheDocument();
    await expect.element(settings().getByRole('button', { name: 'Отключить' })).not.toBeInTheDocument();
    await expect.element(settings().getByRole('button', { name: 'Удалить группу' })).not.toBeInTheDocument();
  });

  it('участник без чата — кнопки подключения нет', async () => {
    await setup(detail({ role: 'member' }));
    await openSettings();
    await expect.element(settings().getByRole('button', { name: 'Выйти из группы' })).toBeVisible();
    await expect.element(settings().getByRole('button', { name: 'Подключить чат Telegram' })).not.toBeInTheDocument();
  });

  it('«Выйти из группы» вне Telegram — сразу: группа уходит из кэшей, возврат на вкладку', async () => {
    caches.groupList = [detail(), detail({ id: 11 })];
    const { onBack, onChanged } = await setup();
    await openSettings();
    await settings().getByRole('button', { name: 'Выйти из группы' }).click();
    await expect.poll(() => onBack.mock.calls.length).toBe(1);
    expect(m.api.leaveGroup).toHaveBeenCalledWith(10);
    expect(onChanged).toHaveBeenCalled();
    expect(caches.groups.has(10)).toBe(false);
    expect(caches.groupList!.map((g) => g.id)).toEqual([11]);
  });

  // 04.10.2026: раньше при ошибке сервера экран всё равно закрывался, а группа пропадала из кэшей — и возвращалась потом.
  it('«Удалить группу» в Telegram — с подтверждением; «Отмена» — остаёмся; выйти не вышло — остаёмся с подсказкой', async () => {
    m.tg.popup = true;
    m.tg.answer = null;
    m.api.leaveGroup.mockRejectedValue(new Error('сеть'));
    caches.groupList = [detail(), detail({ id: 11 })];
    const { onBack, onChanged } = await setup();
    await openSettings();
    await settings().getByRole('button', { name: 'Удалить группу' }).click();
    await expect.poll(() => m.tg.popups.length).toBe(1);
    expect(m.tg.popups[0]).toMatchObject({ message: 'Удалить группу для всех? Дела и отметки пропадут у всех участников.' });
    expect(m.api.deleteGroup).not.toHaveBeenCalled();
    m.tg.answer = 'ok';
    await settings().getByRole('button', { name: 'Выйти из группы' }).click();
    expect(m.tg.popups[1]).toMatchObject({ message: 'Выйти из группы? Её дела пропадут у тебя с «Сегодня».' });
    await expect.element(toast()).toHaveTextContent('Что-то пошло не так. Попробуй ещё раз.');
    await expect.element(settings()).not.toBeInTheDocument();
    await expect.element(page.getByRole('heading', { name: 'Семья' })).toBeVisible();
    expect(onBack).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(caches.groups.has(10)).toBe(true);
    expect(caches.groupList!.map((g) => g.id)).toEqual([10, 11]);
  });

  it('«Удалить группу» подтвердили — удаляется', async () => {
    m.tg.popup = true;
    const { onBack } = await setup();
    await openSettings();
    await settings().getByRole('button', { name: 'Удалить группу' }).click();
    await expect.poll(() => onBack.mock.calls.length).toBe(1);
    expect(m.api.deleteGroup).toHaveBeenCalledWith(10);
  });
});
