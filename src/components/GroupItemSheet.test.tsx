// Новое и правка группового дела: кто делает, люди, очередь, повтор, день, время, цель.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { GroupDayItem } from '../../shared/groups';
import { api } from '../api';
import { renderApp } from '../test/render';
import { GroupItemSheet } from './GroupItemSheet';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: { createItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn() } }));

// 3 октября 2026 — суббота.
const TODAY = '2026-10-03';
const ME = 1;
const group = { id: 10, title: 'Семья', members: [{ id: 1, name: 'Даша', photo: null }, { id: 2, name: 'Лёша', photo: null }, { id: 3, name: 'Вера', photo: null }] };
const existing = (p: Partial<GroupDayItem> = {}): GroupDayItem => ({
  id: 7, title: 'Полить цветы', mode: 'assign', time: '19:30', duration_min: null, due_day: null, carried: false, recurring: true,
  people: [2], all_members: false, rotate: true, turn: 2, for_me: false, can_mark: false, done: false, done_by: [],
  target: null, total: null, unit: null, goal_until: null, start: '2026-09-29', rrule: 'FREQ=WEEKLY;BYDAY=TU', assignees: [1, 2], ...p,
});

function setup(item?: GroupDayItem) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const r = renderApp(<GroupItemSheet group={group} me={ME} today={TODAY} item={item} onSaved={onSaved} onClose={onClose} />);
  return { r, onSaved, onClose };
}

const mode = (name: string) => page.getByRole('radio', { name: new RegExp(`^${name}`) });
const chip = (name: string) => page.getByRole('button', { name: new RegExp(`${name}$`) });
const addBtn = () => page.getByRole('button', { name: 'Добавить' });
async function repeat(label: string) {
  await page.getByRole('button', { name: /^Повторять/ }).click();
  await page.getByRole('option', { name: label }).click();
}
const sent = () => vi.mocked(api.createItem).mock.calls.at(-1)![1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.createItem).mockResolvedValue({ id: 99 });
  vi.mocked(api.updateItem).mockResolvedValue({ ok: true });
  vi.mocked(api.deleteItem).mockResolvedValue({ ok: true });
});

describe('новое дело', () => {
  it('по умолчанию «Кто-то один», один раз, сегодня, весь день', async () => {
    const { r, onSaved } = setup();
    await r;
    await expect.element(page.getByRole('dialog', { name: 'Новое дело · Семья' })).toBeVisible();
    const title = page.getByRole('textbox', { name: 'Что сделать?' });
    await expect.element(title).toHaveFocus();
    await expect.element(mode('Кто-то один')).toHaveAttribute('aria-checked', 'true');
    await expect.element(addBtn()).toBeDisabled();
    await expect.element(page.getByRole('button', { name: /^Когда/ })).toMatchTextContent(/3 октября/);
    await expect.element(page.getByRole('button', { name: /^Время/ })).toMatchTextContent(/Весь день/);
    // У «кто-то один» людей не выбирают.
    await expect.element(chip('Все')).not.toBeInTheDocument();
    await title.fill('  Вынести мусор ');
    await addBtn().click();
    expect(api.createItem).toHaveBeenCalledWith(10, { title: 'Вынести мусор', mode: 'one', day: TODAY, time: null, rrule: null, assignees: [], all_members: false, rotate: false, target: null, goal_until: null });
    await expect.poll(() => onSaved).toHaveBeenCalledOnce();
  });

  it('«Назначить»: люди, «По очереди», каждый день в 19:00', async () => {
    await setup().r;
    await page.getByRole('textbox', { name: 'Что сделать?' }).fill('Погулять с собакой');
    await mode('Назначить').click();
    await expect.element(chip('Я')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(chip('Лёша')).toHaveAttribute('aria-pressed', 'false');
    // Один человек — очереди нет.
    await expect.element(page.getByText('По очереди')).not.toBeInTheDocument();
    await chip('Лёша').click();
    await expect.element(page.getByText('каждый отмечает сам')).toBeVisible();
    await page.getByRole('checkbox').click();
    await expect.element(page.getByText('Я → Лёша')).toBeVisible();
    await repeat('Каждый день');
    await expect.element(page.getByRole('button', { name: /^Когда/ })).not.toBeInTheDocument();
    await page.getByRole('button', { name: /^Время/ }).click();
    await page.getByRole('dialog', { name: 'Время' }).getByRole('button', { name: 'Готово' }).click();
    await addBtn().click();
    expect(sent()).toEqual({ title: 'Погулять с собакой', mode: 'assign', day: TODAY, time: '19:00', rrule: 'FREQ=DAILY', assignees: [1, 2], all_members: false, rotate: true, target: null, goal_until: null });
  });

  it('никого не выбрали — нельзя; «Все» — все, в том числе будущие участники', async () => {
    await setup().r;
    await page.getByRole('textbox', { name: 'Что сделать?' }).fill('Уборка');
    await mode('Назначить').click();
    await chip('Я').click();
    await expect.element(addBtn()).toBeDisabled();
    await chip('Все').click();
    for (const name of ['Все', 'Я', 'Лёша', 'Вера']) await expect.element(chip(name)).toHaveAttribute('aria-pressed', 'true');
    await addBtn().click();
    expect(sent()).toMatchObject({ assignees: [], all_members: true, rotate: false });
  });

  it('при «Все» снять одного — остаются остальные; «Все» туда-обратно возвращает выбор', async () => {
    await setup().r;
    await page.getByRole('textbox', { name: 'Что сделать?' }).fill('Уборка');
    await mode('Назначить').click();
    await chip('Все').click();
    await chip('Вера').click();
    await expect.element(chip('Все')).toHaveAttribute('aria-pressed', 'false');
    await expect.element(chip('Вера')).toHaveAttribute('aria-pressed', 'false');
    await expect.element(chip('Лёша')).toHaveAttribute('aria-pressed', 'true');
    await chip('Все').click();
    await chip('Все').click();
    await expect.element(chip('Вера')).toHaveAttribute('aria-pressed', 'false');
    await expect.element(chip('Лёша')).toHaveAttribute('aria-pressed', 'true');
    await addBtn().click();
    expect(sent()).toMatchObject({ assignees: [1, 2], all_members: false });
  });

  it('«Мероприятие»: будни, выходные, раз в неделю — в день выбранной даты', async () => {
    const cases: [string, string | null, string][] = [
      ['Будни', null, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
      ['Выходные', null, 'FREQ=WEEKLY;BYDAY=SA,SU'],
      ['Раз в неделю', null, 'FREQ=WEEKLY;BYDAY=SA'],
      ['Раз в неделю', '6', 'FREQ=WEEKLY;BYDAY=TU'],
    ];
    for (const [label, day, rrule] of cases) {
      const { unmount } = await setup().r;
      await mode('Мероприятие').click();
      await page.getByRole('textbox', { name: 'Что будет? Например, семейный ужин' }).fill('Ужин');
      // У мероприятия очереди не бывает, даже если людей много.
      await chip('Лёша').click();
      await expect.element(page.getByText('По очереди')).not.toBeInTheDocument();
      await repeat(label);
      if (day) {
        await page.getByRole('button', { name: /^Когда/ }).click();
        await page.getByRole('dialog', { name: 'Когда' }).getByRole('button', { name: day, exact: true }).click();
      }
      await addBtn().click();
      expect(sent()).toMatchObject({ mode: 'event', rrule, day: day ? `2026-10-0${day}` : TODAY, assignees: [1, 2], rotate: false });
      await unmount();
    }
  });

  it('«Общая цель»: число с пробелами, без срока', async () => {
    await setup().r;
    await mode('Общая цель').click();
    await page.getByRole('textbox', { name: 'Например, отпуск в Грузии' }).fill('Отпуск');
    await expect.element(addBtn()).toBeDisabled();
    const target = page.getByPlaceholder('150 000');
    await target.fill('150 000 руб.');
    await expect.element(target).toHaveValue('150 000 .');
    await target.fill('150 000');
    await expect.element(page.getByRole('button', { name: /^Время/ })).not.toBeInTheDocument();
    await addBtn().click();
    expect(sent()).toEqual({ title: 'Отпуск', mode: 'goal', day: TODAY, time: null, rrule: null, assignees: [], all_members: false, rotate: false, target: 150000, goal_until: null });
  });

  it('«Общая цель»: дробное через запятую и срок', async () => {
    await setup().r;
    await mode('Общая цель').click();
    await page.getByRole('textbox', { name: 'Например, отпуск в Грузии' }).fill('Книги');
    await page.getByPlaceholder('150 000').fill('1,5');
    await page.getByRole('button', { name: /^К какому дню/ }).click();
    await page.getByRole('dialog', { name: 'К какому дню' }).getByRole('button', { name: '31', exact: true }).click();
    await addBtn().click();
    expect(sent()).toMatchObject({ target: 1.5, goal_until: '2026-10-31' });
  });

  it('ошибка сервера — текст и можно попробовать снова; Escape закрывает', async () => {
    vi.mocked(api.createItem).mockRejectedValueOnce(new Error('offline'));
    const { r, onSaved, onClose } = setup();
    await r;
    await page.getByRole('textbox', { name: 'Что сделать?' }).fill('Мусор');
    await addBtn().click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(addBtn()).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
    await addBtn().click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
    await expect.poll(() => onSaved).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('правка дела', () => {
  it('поля из дела, «Сохранить» отправляет правку', async () => {
    const { r, onSaved } = setup(existing());
    await r;
    await expect.element(page.getByRole('dialog', { name: 'Полить цветы' })).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Что сделать?' })).not.toHaveFocus();
    await expect.element(mode('Назначить')).toHaveAttribute('aria-checked', 'true');
    await expect.element(page.getByRole('checkbox')).toBeChecked();
    await expect.element(page.getByText('Я → Лёша')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Повторять/ })).toMatchTextContent(/Раз в неделю/);
    await expect.element(page.getByRole('button', { name: /^Когда/ })).toMatchTextContent(/29 сентября/);
    await expect.element(page.getByRole('button', { name: /^Время/ })).toMatchTextContent(/19:30/);
    await page.getByRole('button', { name: 'Сохранить' }).click();
    expect(api.updateItem).toHaveBeenCalledWith(10, 7, { title: 'Полить цветы', mode: 'assign', day: '2026-09-29', time: '19:30', rrule: 'FREQ=WEEKLY;BYDAY=TU', assignees: [1, 2], all_members: false, rotate: true, target: null, goal_until: null });
    await expect.poll(() => onSaved).toHaveBeenCalledOnce();
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it('повтор из правила: каждый день, будни, выходные, один раз', async () => {
    const cases: [string | null, RegExp][] = [
      ['freq=daily', /Каждый день/],
      ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', /Будни/],
      ['FREQ=WEEKLY;BYDAY=SA,SU', /Выходные/],
      [null, /Один раз/],
    ];
    for (const [rrule, label] of cases) {
      const { r } = setup(existing({ rrule }));
      const { unmount } = await r;
      await expect.element(page.getByRole('button', { name: /^Повторять/ })).toMatchTextContent(label);
      await unmount();
    }
  });

  // Повтор, заведённый голосом («вт и чт»), шторка не умеет показать отдельно — он «раз в неделю». Поправили только
  // название — правило уходит как было, а не «по дню недели первого дня» (code-review 07.10.2026).
  it('повтор не меняли — правило уходит как было, даже если шторка его не различает', async () => {
    const { r } = setup(existing({ rrule: 'FREQ=WEEKLY;BYDAY=TU,TH', start: '2026-09-28' }));
    await r;
    await page.getByRole('textbox', { name: 'Что сделать?' }).fill('Полить цветы и кактус');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    expect(api.updateItem).toHaveBeenCalledWith(10, 7, expect.objectContaining({ title: 'Полить цветы и кактус', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH' }));
  });

  it('удалить дело — даже если сервер не ответил, экран перечитывается', async () => {
    vi.mocked(api.deleteItem).mockRejectedValueOnce(new Error('offline'));
    const { r, onSaved } = setup(existing());
    await r;
    await page.getByRole('button', { name: 'Удалить дело' }).click();
    expect(api.deleteItem).toHaveBeenCalledWith(10, 7);
    await expect.poll(() => onSaved).toHaveBeenCalledOnce();
    await expect.element(page.getByRole('button', { name: 'Удалить дело' })).toBeDisabled();
  });

  it('«Все» у дела; ушедший из группы в очереди без имени; цель со сроком', async () => {
    const { r } = setup(existing({ all_members: true, assignees: [] }));
    const { unmount } = await r;
    for (const name of ['Все', 'Я', 'Лёша', 'Вера']) await expect.element(chip(name)).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByText('Я → Лёша → Вера')).toBeVisible();
    await unmount();
    const gone = await setup(existing({ assignees: [1, 42] })).r;
    await expect.element(page.getByText('Я →', { exact: true })).toBeVisible();
    await gone.unmount();
    await setup(existing({ mode: 'goal', target: 40, goal_until: '2026-12-31', rrule: null, time: null })).r;
    await expect.element(page.getByPlaceholder('150 000')).toHaveValue('40');
    await expect.element(page.getByRole('button', { name: /^К какому дню/ })).toMatchTextContent(/31 декабря/);
    await page.getByRole('button', { name: 'Сохранить' }).click();
    expect(vi.mocked(api.updateItem).mock.calls[0]![2]).toMatchObject({ mode: 'goal', target: 40, goal_until: '2026-12-31', day: TODAY });
  });
});
