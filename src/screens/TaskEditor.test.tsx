// Редактор привычки: что уходит на сервер по главной кнопке Telegram, расписание, «Отложить» и «Удалить».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { TodayTask } from '../../shared/types';
import { ApiError } from '../api';
import { renderApp } from '../test/render';
import { TaskEditor } from './TaskEditor';

const m = vi.hoisted(() => ({
  api: { createTask: vi.fn(), updateTask: vi.fn(), archiveTask: vi.fn(), deleteTask: vi.fn() },
  popup: { available: false, answer: 'delete' as string | null, calls: [] as unknown[] },
  main: { text: '', state: '', press: null as null | (() => void) },
  back: { current: null as (() => void) | null },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));
vi.mock('../telegram/hooks', () => ({
  useBackButton: (fn: (() => void) | null) => {
    m.back.current = fn;
  },
  useMainButton: (text: string, state: string, onPress: () => void) => {
    m.main.text = text;
    m.main.state = state;
    m.main.press = onPress;
  },
}));
vi.mock('@tma.js/sdk-react', async (orig) => {
  const real = await orig<typeof import('@tma.js/sdk-react')>();
  const show = Object.assign(
    async (p: unknown) => {
      m.popup.calls.push(p);
      return m.popup.answer;
    },
    { isAvailable: () => m.popup.available },
  );
  return { ...real, popup: { ...real.popup, show } };
});

const task = (patch: Partial<TodayTask> = {}): TodayTask => ({
  id: 5, title: 'Вода', emoji: null, kind: 'count', unit: 'стаканов', step: 1, schedule: 'daily', weekdays: 127, per_week: null,
  visibility: 'private', target: 8, value: 0, logged: false, status: null, week_done: 0, due: true, subtasks: [], challenge_id: null,
  clean_before: 0, last_slip_on: null, ...patch,
});

const props = () => ({ day: '2026-10-03', onClose: vi.fn(), onSaved: vi.fn(async () => {}) });
const press = () => m.main.press!();
const title = () => page.getByRole('textbox', { name: 'Новая привычка' });

beforeEach(() => {
  m.api.createTask.mockReset().mockResolvedValue({ id: 9 });
  m.api.updateTask.mockReset().mockResolvedValue({ ok: true, goal_effective_from: null });
  m.api.archiveTask.mockReset().mockResolvedValue({ ok: true });
  m.api.deleteTask.mockReset().mockResolvedValue({ ok: true });
  m.popup.available = false;
  m.popup.answer = 'delete';
  m.popup.calls = [];
  m.main.press = null;
});

describe('новая привычка', () => {
  it('«Делать регулярно»: без названия кнопка неактивна, с названием — создаёт и закрывает', async () => {
    const p = props();
    await renderApp(<TaskEditor task={null} kind="check" {...p} />);
    await expect.element(page.getByRole('heading', { name: 'Новая привычка' })).toBeVisible();
    await expect.element(page.getByText('Делать регулярно')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Отложить' })).not.toBeInTheDocument();
    expect(m.main).toMatchObject({ text: 'Добавить', state: 'blocked' });
    await title().fill('  Спортзал  ');
    await expect.poll(() => m.main.state).toBe('idle');
    press();
    await expect.poll(() => p.onClose.mock.calls.length).toBe(1);
    expect(m.api.createTask).toHaveBeenCalledWith({
      title: 'Спортзал', kind: 'check', target: 1, unit: null, schedule: 'daily', weekdays: 31, per_week: null, visibility: 'private', last_slip_on: null,
    });
    expect(p.onSaved).toHaveBeenCalledWith();
  });

  it('пока сохраняется — кнопка с крутилкой', async () => {
    m.api.createTask.mockReturnValue(new Promise(() => {}));
    await renderApp(<TaskEditor task={null} kind="check" {...props()} />);
    await title().fill('Бег');
    await expect.poll(() => m.main.state).toBe('idle');
    press();
    await expect.poll(() => m.main.state).toBe('submitting');
  });

  it('без выбранного вида — «Делать регулярно»; «назад» без onBack закрывает', async () => {
    const p = props();
    await renderApp(<TaskEditor task={null} {...p} />);
    await expect.element(page.getByText('Делать регулярно')).toBeVisible();
    m.back.current?.();
    expect(p.onClose).toHaveBeenCalled();
  });

  it('«Считать»: шаги цели −/+ (по 5 после 20), пустая цель не сохраняется', async () => {
    await renderApp(<TaskEditor task={null} kind="count" {...props()} />);
    const goal = page.getByRole('textbox', { name: 'Цель на день' });
    const plus = page.getByRole('button', { name: '+' });
    const minus = page.getByRole('button', { name: '−' });
    await title().fill('Читать');
    await expect.element(goal).toHaveValue('10');
    await plus.click();
    await expect.element(goal).toHaveValue('11');
    await goal.fill('20');
    await plus.click();
    await expect.element(goal).toHaveValue('25');
    await minus.click();
    await expect.element(goal).toHaveValue('20');
    await minus.click();
    await expect.element(goal).toHaveValue('19');
    await goal.fill('1');
    await minus.click();
    await expect.element(goal).toHaveValue('1');
    await goal.fill('стр');
    await expect.element(goal).toHaveValue('0');
    await expect.poll(() => m.main.state).toBe('blocked');
    await goal.fill('30');
    await expect.poll(() => m.main.state).toBe('idle');
    press();
    await expect.poll(() => m.api.createTask.mock.calls.length).toBe(1);
    expect(m.api.createTask.mock.calls[0]![0]).toMatchObject({ kind: 'count', target: 30, unit: null });
  });

  it('«Бросить»: без расписания, с датой «последний раз»', async () => {
    await renderApp(<TaskEditor task={null} kind="abstain" {...props()} />);
    await expect.element(page.getByRole('button', { name: /Повторять/ })).not.toBeInTheDocument();
    await title().fill('Не курить');
    await page.getByRole('button', { name: /Последний раз/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: '1', exact: true }).click();
    const d = new Date();
    const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    press();
    await expect.poll(() => m.api.createTask.mock.calls.length).toBe(1);
    expect(m.api.createTask.mock.calls[0]![0]).toMatchObject({ kind: 'abstain', target: 1, schedule: 'daily', per_week: null, last_slip_on: first });
  });

  it('«Бросить» без даты — «последний раз» не указан', async () => {
    await renderApp(<TaskEditor task={null} kind="abstain" {...props()} />);
    await title().fill('Не курить');
    await expect.element(page.getByRole('button', { name: /Последний раз/ })).toMatchTextContent(/Не указано/);
    press();
    await expect.poll(() => m.api.createTask.mock.calls.length).toBe(1);
    expect(m.api.createTask.mock.calls[0]![0]).toMatchObject({ last_slip_on: null });
  });

  it('расписание: дни недели (ни одного — нельзя), потом «несколько раз в неделю» от 1 до 6', async () => {
    await renderApp(<TaskEditor task={null} kind="check" {...props()} />);
    await title().fill('Бег');
    await page.getByRole('button', { name: /Повторять/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('radio', { name: 'По дням недели' }).click();
    for (const d of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт']) await sheet.getByRole('button', { name: d }).click();
    await expect.element(sheet.getByRole('button', { name: 'Готово' })).toBeDisabled();
    await expect.poll(() => m.main.state).toBe('blocked');
    await sheet.getByRole('button', { name: 'Ср' }).click();
    await sheet.getByRole('button', { name: 'Готово' }).click();
    await expect.element(page.getByRole('button', { name: /Повторять/ })).toMatchTextContent(/Ср/);

    await page.getByRole('button', { name: /Повторять/ }).click();
    await sheet.getByRole('radio', { name: 'Несколько раз в неделю' }).click();
    const n = sheet.getByRole('textbox', { name: 'Несколько раз в неделю' });
    await expect.element(n).toHaveValue('3');
    for (let i = 0; i < 3; i++) await sheet.getByRole('button', { name: '−' }).click();
    await expect.element(n).toHaveValue('1');
    for (let i = 0; i < 6; i++) await sheet.getByRole('button', { name: '+' }).click();
    await expect.element(n).toHaveValue('6');
    await expect.element(sheet.getByText('раз в неделю, в любые дни')).toBeVisible();
    await sheet.getByRole('button', { name: 'Готово' }).click();
    await expect.element(page.getByRole('button', { name: /Повторять/ })).toMatchTextContent(/6 раз в неделю/);

    // «Кто видит»: только я или друзья (03.10.2026: «Подписчики» и «Все» убраны).
    await page.getByRole('button', { name: /Кто видит/ }).click();
    expect(page.getByRole('option', { name: 'Все' }).elements()).toEqual([]);
    await page.getByRole('option', { name: 'Друзья' }).click();
    press();
    await expect.poll(() => m.api.createTask.mock.calls.length).toBe(1);
    expect(m.api.createTask.mock.calls[0]![0]).toMatchObject({ schedule: 'per_week', per_week: 6, weekdays: 4, visibility: 'friends' });
  });

  it('шторку «Повторять» можно закрыть, выбор остаётся', async () => {
    await renderApp(<TaskEditor task={null} kind="check" {...props()} />);
    await page.getByRole('button', { name: /Повторять/ }).click();
    await page.getByRole('radio', { name: 'Несколько раз в неделю' }).click();
    page.getByRole('dialog').element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Повторять/ })).toMatchTextContent(/3 раза в неделю/);
  });

  it('упёрлись в лимит — про лимит; другая ошибка — общая; кнопку снова можно нажать', async () => {
    m.api.createTask.mockRejectedValueOnce(new ApiError(403, 'task_limit')).mockRejectedValueOnce(new Error('сеть'));
    const p = props();
    await renderApp(<TaskEditor task={null} kind="check" {...p} />);
    await title().fill('Бег');
    await expect.poll(() => m.main.state).toBe('idle');
    press();
    await expect.element(page.getByText('Бесплатно — до 5 привычек. Можно отложить какую-нибудь.')).toBeVisible();
    await expect.poll(() => m.main.state).toBe('idle');
    press();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});

describe('существующая привычка', () => {
  it('«Сохранить» шлёт правку без вида; цель стала легче — предупреждение в Telegram', async () => {
    m.popup.available = true;
    m.api.updateTask.mockResolvedValue({ ok: true, goal_effective_from: '2026-10-04' });
    const p = props();
    await renderApp(<TaskEditor task={task({ unit: null, schedule: 'per_week', per_week: null, last_slip_on: null })} {...p} />);
    await expect.element(page.getByRole('heading', { name: 'Привычка' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Повторять/ })).toMatchTextContent(/3 раза в неделю/);
    expect(m.main.text).toBe('Сохранить');
    press();
    await expect.poll(() => p.onClose.mock.calls.length).toBe(1);
    const [id, patch] = m.api.updateTask.mock.calls[0]!;
    expect(id).toBe(5);
    expect(patch).not.toHaveProperty('kind');
    expect(patch).toMatchObject({ title: 'Вода', target: 8, unit: null, schedule: 'per_week', per_week: 3 });
    expect(m.popup.calls).toEqual([{ message: 'Цель стала легче — применится с завтра.', buttons: [{ type: 'ok' }] }]);
  });

  it('новая цель с сегодня или вне Telegram — без предупреждения', async () => {
    m.api.updateTask.mockResolvedValue({ ok: true, goal_effective_from: '2026-10-04' });
    const p = props();
    await renderApp(<TaskEditor task={task({ kind: 'abstain', last_slip_on: '2026-09-01' })} {...p} />);
    press();
    await expect.poll(() => p.onClose.mock.calls.length).toBe(1);
    expect(m.api.updateTask.mock.calls[0]![1]).toMatchObject({ last_slip_on: '2026-09-01', target: 1 });
    expect(m.popup.calls).toEqual([]);
  });

  it('«Отложить» убирает в отложенные и закрывает', async () => {
    const p = props();
    await renderApp(<TaskEditor task={task()} {...p} />);
    await page.getByRole('button', { name: 'Отложить' }).click();
    await expect.poll(() => p.onClose.mock.calls.length).toBe(1);
    expect(m.api.archiveTask).toHaveBeenCalledWith(5);
    expect(p.onSaved).toHaveBeenCalledWith();
  });

  it('«Удалить» вне Telegram — сразу, вместе с картой', async () => {
    const p = props();
    await renderApp(<TaskEditor task={task()} {...p} />);
    await page.getByRole('button', { name: 'Удалить' }).click();
    await expect.poll(() => p.onClose.mock.calls.length).toBe(1);
    expect(m.api.deleteTask).toHaveBeenCalledWith(5);
    expect(p.onSaved).toHaveBeenCalledWith(true);
  });

  it('«Удалить» в Telegram спрашивает: «Отмена» — ничего; не вышло — ошибка', async () => {
    m.popup.available = true;
    m.popup.answer = null;
    m.api.deleteTask.mockRejectedValue(new Error('сеть'));
    const p = props();
    await renderApp(<TaskEditor task={task()} {...p} />);
    await page.getByRole('button', { name: 'Удалить' }).click();
    await expect.poll(() => m.popup.calls.length).toBe(1);
    expect(m.api.deleteTask).not.toHaveBeenCalled();
    m.popup.answer = 'delete';
    await page.getByRole('button', { name: 'Удалить' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('привычки уже нет (отложили или удалили) — редактор закрывается сам; «назад» — onBack', async () => {
    const p = props();
    const onBack = vi.fn();
    await renderApp(<TaskEditor task={undefined} onBack={onBack} {...p} />);
    await expect.poll(() => p.onClose.mock.calls.length).toBeGreaterThan(0);
    m.back.current?.();
    expect(onBack).toHaveBeenCalled();
  });
});

describe('черновик из голоса', () => {
  it('форма заполнена разбором, «Готово» возвращает исправленный черновик без запросов', async () => {
    const onDraft = vi.fn();
    await renderApp(
      <TaskEditor task={null} {...props()} draft={{ title: 'Вода', kind: 'count', target: 8, unit: 'стаканов', weekdays: 5, per_week: 2 }} onDraft={onDraft} />,
    );
    await expect.element(page.getByRole('heading', { name: 'Привычка' })).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Цель на день' })).toHaveValue('8');
    expect(m.main.text).toBe('Готово');
    press();
    await expect.poll(() => onDraft.mock.calls.length).toBe(1);
    expect(onDraft.mock.calls[0]![0]).toMatchObject({ title: 'Вода', kind: 'count', target: 8, unit: 'стаканов', schedule: 'daily', weekdays: 5 });
    expect(m.api.createTask).not.toHaveBeenCalled();
  });

  it('черновик «делать» — цель по умолчанию, без единицы; без onDraft ничего не падает', async () => {
    await renderApp(<TaskEditor task={null} {...props()} draft={{ title: 'Бег', kind: 'check', target: 3, schedule: 'weekdays' }} />);
    await expect.element(page.getByRole('button', { name: /Повторять/ })).toMatchTextContent(/Пн, вт, ср, чт, пт/);
    press();
    expect(m.api.createTask).not.toHaveBeenCalled();
  });
});
