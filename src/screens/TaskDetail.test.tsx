// Экран привычки: числа за месяц, календарь с отметками задним числом и картинки «Поделиться» для трёх видов.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { TaskHistory } from '../../shared/stats';
import type { TodayResponse, TodayTask } from '../../shared/types';
import { caches } from '../caches';
import type { Template } from '../share/draw';
import { renderApp } from '../test/render';
import type { Cache } from '../useTaskLog';
import { TaskDetail } from './TaskDetail';

const m = vi.hoisted(() => ({
  api: { history: vi.fn(), log: vi.fn(), today: vi.fn(), heatmap: vi.fn() },
  share: { templates: null as Template[] | null },
  back: { current: null as (() => void) | null },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));
vi.mock('../telegram/hooks', () => ({
  useBackButton: (fn: (() => void) | null) => {
    m.back.current = fn;
  },
  useMainButton: () => {},
}));
// Картинки рисует ShareSheet (его проверяют отдельно) — здесь важно, какие шаблоны ему отдали.
vi.mock('../share/ShareSheet', async () => {
  const { createElement } = await import('react');
  return {
    ShareSheet: ({ templates, onClose }: { templates: Template[]; onClose: () => void }) => {
      m.share.templates = templates;
      return createElement('button', { onClick: onClose }, 'Закрыть «Поделиться»');
    },
  };
});

const TODAY = '2026-10-03';
const task = (patch: Partial<TodayTask>): TodayTask => ({
  id: 5, title: 'Спортзал', emoji: null, kind: 'check', unit: null, step: 1, schedule: 'daily', weekdays: 127, per_week: null,
  visibility: 'private', target: 1, value: 0, logged: false, status: null, week_done: 0, due: true, subtasks: [], challenge_id: null,
  clean_before: 0, last_slip_on: null, ...patch,
});
const base: Cache = { today: { day: TODAY } as TodayResponse, heat: [], loadedAt: 0 };

/** История — в кэше (как после запуска) и та же с сервера; null — кэша нет. */
async function setup(t: TodayTask, history: TaskHistory | null, lang: 'ru' | 'en' = 'ru') {
  if (history) {
    caches.history.set(t.id, history);
    m.api.history.mockResolvedValue(history);
  }
  const props = { setCache: vi.fn(), onEdit: vi.fn(), onClose: vi.fn() };
  await renderApp(<TaskDetail task={t} today={TODAY} {...props} />, lang);
  await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible();
  return { props };
}
const cell = (label: string) => page.getByRole('button', { name: label, exact: true });
const sheet = () => page.getByRole('dialog');
const stat = (label: string) => page.getByText(label, { exact: true }).element().previousElementSibling?.textContent;

beforeEach(() => {
  caches.history.clear();
  for (const f of Object.values(m.api)) f.mockReset();
  m.api.history.mockResolvedValue({ start: TODAY, goals: [], logs: [] });
  m.api.log.mockResolvedValue({ ok: true });
  m.api.today.mockResolvedValue({ day: TODAY, fresh: true });
  m.api.heatmap.mockResolvedValue({ today: TODAY, days: [{ day: TODAY, score: 1 }] });
  m.share.templates = null;
});

describe('«Делать регулярно»', () => {
  const history: TaskHistory = {
    start: '2026-09-20',
    goals: [{ effective_from: '2026-09-20', target: 1 }],
    logs: [
      { day: '2026-09-25', value: 1, status: null },
      { day: '2026-10-01', value: 1, status: null },
    ],
  };

  it('числа месяца: «1 из 3» по плану и счёт за всё время; сегодняшняя отметка — сразу в календаре', async () => {
    const { props } = await setup(task({ value: 1, logged: true }), history);
    await expect.element(page.getByRole('heading', { name: 'Спортзал' })).toBeVisible();
    await expect.element(page.getByText('Каждый день')).toBeVisible();
    expect(stat('по плану за октябрь')).toBe('2 из 3');
    expect(stat('раз за всё время')).toBe('3');
    await expect.element(cell('3 октября')).toHaveClass(/full/);
    await expect.element(cell('2 октября')).toHaveClass(/plan/);
    await page.getByRole('button', { name: 'Привычка' }).click();
    expect(props.onEdit).toHaveBeenCalled();
    m.back.current?.();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('«несколько раз в неделю» — без плана по дням, просто счёт', async () => {
    await setup(task({ schedule: 'per_week', per_week: 3 }), history);
    await expect.element(page.getByText('3 раза в неделю')).toBeVisible();
    expect(stat('раз за октябрь')).toBe('1');
    await expect.element(cell('2 октября')).toHaveClass(/off/);
  });

  it('прошлый день: «Сделано» — сразу в календаре, на сервер с этим днём, потом свежие «Сегодня» и карта', async () => {
    const { props } = await setup(task({}), history);
    await cell('2 октября').click();
    await expect.element(sheet().getByRole('heading', { name: 'пятница, 2 октября' })).toBeVisible();
    await expect.element(sheet().getByRole('button', { name: 'Убрать отметку' })).not.toBeInTheDocument();
    await sheet().getByRole('button', { name: 'Сделано' }).click();
    await expect.element(cell('2 октября')).toHaveClass(/full/);
    expect(m.api.log).toHaveBeenCalledWith(5, 1, null, '2026-10-02');
    await expect.poll(() => props.setCache.mock.calls.length).toBe(1);
    const next = props.setCache.mock.calls[0]![0](base) as Cache;
    expect(next.today).toMatchObject({ fresh: true });
    expect(next.heat).toEqual([{ day: TODAY, score: 1 }]);
    expect(caches.history.get(5)!.logs.map((l) => l.day)).toEqual(['2026-09-25', '2026-10-01', '2026-10-02']);
  });

  it('отмеченный день: «Убрать отметку» и «Не сделано» снимают; свежие данные не пришли — кэш не трогаем', async () => {
    m.api.today.mockRejectedValue(new Error('сеть'));
    m.api.heatmap.mockRejectedValue(new Error('сеть'));
    const { props } = await setup(task({}), history);
    await cell('1 октября').click();
    await sheet().getByRole('button', { name: 'Убрать отметку' }).click();
    await expect.element(cell('1 октября')).toHaveClass(/plan/);
    expect(m.api.log).toHaveBeenLastCalledWith(5, null, null, '2026-10-01');
    await expect.poll(() => props.setCache.mock.calls.length).toBe(1);
    expect(props.setCache.mock.calls[0]![0](base)).toEqual(base);

    await cell('2 октября').click();
    await sheet().getByRole('button', { name: 'Не сделано' }).click();
    expect(m.api.log).toHaveBeenLastCalledWith(5, null, null, '2026-10-02');
  });

  it('сервер не принял отметку — история перечитывается', async () => {
    m.api.log.mockRejectedValue(new Error('сеть'));
    m.api.history.mockResolvedValue(history);
    await setup(task({}), history);
    await cell('2 октября').click();
    await sheet().getByRole('button', { name: 'Сделано' }).click();
    await expect.element(cell('2 октября')).toHaveClass(/plan/);
    expect(m.api.history).toHaveBeenCalledTimes(2);
  });

  it('и перечитать не вышло — остаётся то, что было до отметки', async () => {
    m.api.log.mockRejectedValue(new Error('сеть'));
    m.api.history.mockResolvedValueOnce(history).mockRejectedValueOnce(new Error('сеть'));
    await setup(task({}), null);
    await expect.element(cell('1 октября')).toHaveClass(/full/);
    await cell('2 октября').click();
    await sheet().getByRole('button', { name: 'Сделано' }).click();
    await expect.poll(() => m.api.history.mock.calls.length).toBe(2);
    await expect.element(cell('2 октября')).toHaveClass(/plan/);
  });

  it('сегодняшний день из календаря — обычная отметка за сегодня; ошибка — сообщение, тап убирает', async () => {
    m.api.log.mockRejectedValueOnce(new Error('сеть'));
    await setup(task({}), history);
    await cell('3 октября').click();
    await sheet().getByRole('button', { name: 'Сделано' }).click();
    expect(m.api.log).toHaveBeenCalledWith(5, 1, undefined);
    const error = page.getByText('Что-то пошло не так. Попробуй ещё раз.');
    await expect.element(error).toBeVisible();
    await error.click();
    await expect.element(error).not.toBeInTheDocument();
    await cell('3 октября').click();
    await sheet().getByRole('button', { name: 'Не сделано' }).click();
    expect(m.api.log).toHaveBeenLastCalledWith(5, null, undefined);
  });

  it('листать месяцы: вперёд дальше текущего нельзя, назад — до года', async () => {
    await setup(task({}), history);
    const prev = page.getByRole('button', { name: 'Предыдущий месяц' });
    const next = page.getByRole('button', { name: 'Следующий месяц' });
    await expect.element(next).toBeDisabled();
    await prev.click();
    await expect.element(page.getByText('сентябрь 2026')).toBeVisible();
    await expect.element(cell('25 сентября')).toHaveClass(/full/);
    for (let i = 0; i < 10; i++) await prev.click();
    await expect.element(page.getByText('ноябрь 2025')).toBeVisible();
    await expect.element(prev).toBeDisabled();
    await next.click();
    await expect.element(page.getByText('декабрь 2025')).toBeVisible();
  });

  it('без истории — числа с нуля, пока она грузится; шторку отметки закрывает Escape', async () => {
    let release!: (v: TaskHistory) => void;
    m.api.history.mockReturnValue(new Promise((r) => (release = r)));
    await setup(task({ schedule: 'weekdays', weekdays: 1 }), null);
    expect(stat('по плану за октябрь')).toBe('0 из 0');
    await cell('3 октября').click();
    sheet().element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.element(sheet()).not.toBeInTheDocument();
    // Пришла — числа настоящие. Висящий запрос мешал бы следующим тестам: повторы ждут первый (caches.ts).
    release(history);
    await expect.element(cell('1 октября')).toHaveClass(/full/);
  });

  it('отметка задним числом, пока история ещё не пришла, — берётся пустая история', async () => {
    let release!: (v: TaskHistory) => void;
    m.api.history.mockReturnValue(new Promise((r) => (release = r)));
    await setup(task({}), null);
    await cell('2 октября').click();
    await sheet().getByRole('button', { name: 'Сделано' }).click();
    await expect.element(cell('2 октября')).toHaveClass(/full/);
    expect(caches.history.get(5)).toEqual({ start: TODAY, goals: [{ effective_from: TODAY, target: 1 }], logs: [{ day: '2026-10-02', value: 1, status: null }] });
    release(history);
    await expect.element(cell('1 октября')).toHaveClass(/full/);
  });

  it('история не загрузилась — экран по тому, что есть', async () => {
    m.api.history.mockRejectedValue(new Error('сеть'));
    await setup(task({ value: 1, logged: true }), null);
    await expect.poll(() => m.api.history.mock.calls.length).toBe(1);
    expect(stat('раз за всё время')).toBe('1');
  });

  it('«Поделиться»: месяц «сделано из плана» и «раз за всё время»', async () => {
    await setup(task({}), history);
    await page.getByRole('button', { name: 'Поделиться' }).click();
    const [month, number] = m.share.templates!;
    expect(month).toMatchObject({ kind: 'month', title: 'Спортзал · октябрь', big: '1 из 3', caption: 'дней в октябре' });
    expect(number).toMatchObject({ kind: 'number', big: '2', caption: 'раз за всё время' });
    await page.getByRole('button', { name: 'Закрыть «Поделиться»' }).click();
    await expect.element(page.getByRole('button', { name: 'Закрыть «Поделиться»' })).not.toBeInTheDocument();
  });

  it('«Поделиться» у «несколько раз в неделю» — план по прошедшим дням месяца', async () => {
    await setup(task({ schedule: 'per_week', per_week: 2 }), history);
    await page.getByRole('button', { name: 'Поделиться' }).click();
    expect(m.share.templates![0]).toMatchObject({ big: '1 из 3' });
  });
});

describe('«Считать»', () => {
  const history: TaskHistory = {
    start: '2026-09-01',
    goals: [{ effective_from: '2026-09-01', target: 8 }],
    logs: [
      { day: '2026-10-01', value: 8, status: null },
      { day: '2026-10-02', value: 4, status: null },
      { day: '2026-09-30', value: 1, status: null },
    ],
  };
  const water = task({ title: 'Вода', kind: 'count', target: 8, unit: 'стаканов', value: 3, logged: true });

  it('цель, среднее, лучший день и сумма; календарь только смотреть, столбики за две недели', async () => {
    await setup(water, history);
    await expect.element(page.getByText('Цель — 8 стаканов в день')).toBeVisible();
    expect(stat('стаканов в день в среднем')).toBe('5');
    expect(stat('лучший день')).toBe('8');
    expect(stat('всего за октябрь')).toBe('15');
    await expect.element(page.getByRole('button', { name: '1 октября', exact: true })).not.toBeInTheDocument();
    const days = [...document.querySelectorAll('.hcal i:not(.blank)')];
    expect(days.slice(0, 3).map((d) => d.className)).toEqual(['full', 'half', 'some today']);
    await expect.element(page.getByText('Последние две недели')).toBeVisible();
    await expect.element(page.getByText('цель 8')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Вода: ввести число' }).first()).toBeVisible();
  });

  it('без единицы — «раз в день в среднем»', async () => {
    await setup({ ...water, unit: null, logged: false, value: 0 }, history);
    expect(stat('раз в день в среднем')).toBe('4');
  });

  it('«Поделиться»: сумма за месяц со столбиками и итоговое число', async () => {
    await setup(water, history);
    await page.getByRole('button', { name: 'Поделиться' }).click();
    const [sum, number] = m.share.templates!;
    expect(sum).toMatchObject({ kind: 'sum', title: 'Вода · октябрь', big: '15', caption: 'стаканов в октябре', goal: 8, left: '1 окт', right: '31 окт', middle: 'в среднем 5 в день' });
    expect((sum as { bars: number[] }).bars.slice(0, 4)).toEqual([8, 4, 3, 0]);
    expect(number).toMatchObject({ kind: 'number', big: '15' });
  });

  it('«Поделиться» без единицы — подпись только «в октябре»', async () => {
    await setup({ ...water, unit: null }, history);
    await page.getByRole('button', { name: 'Поделиться' }).click();
    expect(m.share.templates![0]).toMatchObject({ caption: 'в октябре' });
  });
});

describe('«Бросить»', () => {
  const history: TaskHistory = {
    start: '2026-09-25',
    goals: [{ effective_from: '2026-09-25', target: 1 }],
    logs: [
      { day: '2026-09-20', value: 0, status: 'slip' },
      { day: '2026-09-28', value: 0, status: 'slip' },
      { day: '2026-10-01', value: 1, status: 'clean' },
    ],
  };
  const quit = task({ title: 'Не курить', kind: 'abstain', last_slip_on: '2026-09-10', clean_before: 20 });

  it('«С 11 сентября», дней без этого, периоды и срывы; дни до приложения — чистые, «последний раз» — красный', async () => {
    await setup(quit, history);
    await expect.element(page.getByText('С 11 сентября')).toBeVisible();
    await expect.element(page.getByText('Сегодня получилось?')).toBeVisible();
    expect(page.getByText('дней без этого', { exact: true }).element().previousElementSibling?.textContent).toBe('20');
    // 2 октября без ответа — период прервался.
    expect(stat('подряд сейчас')).toBe('0');
    expect(stat('самый долгий период')).toBe('9');
    expect(stat('раз было за октябрь')).toBe('0');
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    expect(stat('раз было за сентябрь')).toBe('3');
    await expect.element(cell('10 сентября')).toHaveClass(/slip/);
    await expect.element(cell('15 сентября')).toHaveClass(/clean/);
    await expect.element(cell('20 сентября')).toHaveClass(/slip/);
    await expect.element(cell('5 сентября')).toHaveClass(/off/);
    await expect.element(cell('1 октября')).not.toBeInTheDocument();
  });

  it('день до приложения: «Получилось» просто убирает отметку срыва, «Убрать отметку» там нет', async () => {
    await setup(quit, history);
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await cell('20 сентября').click();
    await expect.element(sheet().getByRole('button', { name: 'Убрать отметку' })).not.toBeInTheDocument();
    await sheet().getByRole('button', { name: 'Получилось' }).click();
    await expect.element(cell('20 сентября')).toHaveClass(/clean/);
    expect(m.api.log).toHaveBeenCalledWith(5, null, 'clean', '2026-09-20');
    expect(caches.history.get(5)!.logs.map((l) => l.day)).toEqual(['2026-09-28', '2026-10-01']);
  });

  it('день в приложении: «Не получилось» — красный, «Убрать отметку» — снимает', async () => {
    await setup(quit, history);
    await cell('2 октября').click();
    await sheet().getByRole('button', { name: 'Не получилось' }).click();
    await expect.element(cell('2 октября')).toHaveClass(/slip/);
    expect(m.api.log).toHaveBeenLastCalledWith(5, null, 'slip', '2026-10-02');
    await cell('2 октября').click();
    await sheet().getByRole('button', { name: 'Убрать отметку' }).click();
    await expect.element(cell('2 октября')).toHaveClass(/off/);
    expect(m.api.log).toHaveBeenLastCalledWith(5, null, null, '2026-10-02');
  });

  it('сегодня из календаря — «получилось / не получилось / убрать» как ответ за сегодня', async () => {
    await setup({ ...quit, status: 'clean', logged: true, value: 1 }, history);
    await expect.element(cell('3 октября')).toHaveClass(/clean/);
    await cell('3 октября').click();
    await sheet().getByRole('button', { name: 'Не получилось' }).click();
    expect(m.api.log).toHaveBeenLastCalledWith(5, null, 'slip');
    await cell('3 октября').click();
    await sheet().getByRole('button', { name: 'Получилось' }).click();
    expect(m.api.log).toHaveBeenLastCalledWith(5, null, 'clean');
    await cell('3 октября').click();
    await sheet().getByRole('button', { name: 'Убрать отметку' }).click();
    expect(m.api.log).toHaveBeenLastCalledWith(5, null, null);
  });

  it('сорвался сегодня — в календаре красный', async () => {
    await setup({ ...quit, status: 'slip', logged: true }, history);
    await expect.element(cell('3 октября')).toHaveClass(/slip/);
  });

  it('«последний раз» давно — листать можно до него; без него счёт с первого дня', async () => {
    await setup({ ...quit, last_slip_on: '2025-06-15' }, history);
    const prev = page.getByRole('button', { name: 'Предыдущий месяц' });
    for (let i = 0; i < 16; i++) await prev.click();
    await expect.element(page.getByText('июнь 2025')).toBeVisible();
    expect(stat('раз было за июнь')).toBe('1');
    await expect.element(prev).toBeDisabled();
  });

  it('без «последнего раза» — «С» первого дня привычки', async () => {
    await setup({ ...quit, last_slip_on: null }, history);
    await expect.element(page.getByText('С 25 сентября')).toBeVisible();
  });

  it('«Поделиться»: дни без этого и чистые дни месяца', async () => {
    await setup({ ...quit, status: 'clean', logged: true }, history);
    await page.getByRole('button', { name: 'Поделиться' }).click();
    const [number, month] = m.share.templates!;
    expect(number).toMatchObject({ kind: 'number', title: 'Не курить', big: '21', caption: 'день без этого', footer: 'Считаю дни в LifeCommit' });
    expect(month).toMatchObject({ kind: 'month', big: '2 из 3', footer: 'Считаю дни в LifeCommit' });
    const states = (month as { cells: { state: string }[] }).cells.slice(0, 4).map((c) => c.state);
    expect(states).toEqual(['on', 'none', 'on', 'none']);
  });

  it('«Поделиться» со срывом в месяце — красная клетка', async () => {
    await setup({ ...quit, status: 'slip', logged: true }, history);
    await page.getByRole('button', { name: 'Поделиться' }).click();
    const month = m.share.templates![1] as { big: string; cells: { state: string }[] };
    expect(month.big).toBe('1 из 3');
    expect(month.cells.slice(0, 3).map((c) => c.state)).toEqual(['on', 'none', 'slip']);
  });

  it('по-английски', async () => {
    await setup(quit, history, 'en');
    await expect.element(page.getByText('Since September 11')).toBeVisible();
  });
});
