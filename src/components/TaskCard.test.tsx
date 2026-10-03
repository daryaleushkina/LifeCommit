// Карточка привычки на «Сегодня»: что видно и что уходит наверх при нажатиях.
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { TodayTask } from '../../shared/types';
import { renderApp } from '../test/render';
import { cleanDaysOf, isDone, TaskCard, taskScore } from './TaskCard';

const base: TodayTask = {
  id: 1, title: 'Вода', kind: 'count', target: 8, unit: 'стаканов', value: 3, status: null, due: true,
  schedule: 'daily', weekdays: 127, per_week: null, visibility: 'private', clean_before: 0, emoji: null,
} as unknown as TodayTask;

describe('карточка «Считать»', () => {
  it('показывает «3 из 8 стаканов», галочка засчитывает целиком', async () => {
    const onLog = vi.fn();
    await renderApp(<TaskCard task={base} onLog={onLog} onOpen={() => {}} />);
    await expect.element(page.getByText('3')).toBeVisible();
    await expect.element(page.getByText(/из 8 стаканов/)).toBeVisible();
    await page.getByRole('button', { name: 'Вода — сделано' }).click();
    expect(onLog).toHaveBeenCalledWith({ value: 8 });
  });

  it('карандаш открывает ввод числа, Enter отправляет', async () => {
    const onLog = vi.fn();
    await renderApp(<TaskCard task={base} onLog={onLog} onOpen={() => {}} />);
    await page.getByRole('button', { name: 'Вода: ввести число' }).first().click();
    const input = page.getByRole('textbox', { name: 'Вода: ввести число' });
    await input.fill('5');
    await input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onLog).toHaveBeenCalledWith({ value: 5 });
  });
});

describe('карточка «Бросить»', () => {
  it('без ответа — «Получилось?», ответ «да» уходит как clean, повторный тап снимает', async () => {
    const onLog = vi.fn();
    const task = { ...base, kind: 'abstain', status: null } as TodayTask;
    const { rerender } = await renderApp(<TaskCard task={task} onLog={onLog} onOpen={() => {}} />);
    await expect.element(page.getByText('Получилось?')).toBeVisible();
    await page.getByRole('button', { name: 'Да, получилось' }).click();
    expect(onLog).toHaveBeenLastCalledWith({ value: null, status: 'clean' });
    rerender(<TaskCard task={{ ...task, status: 'clean' } as TodayTask} onLog={onLog} onOpen={() => {}} />);
    await page.getByRole('button', { name: 'Да, получилось' }).click();
    expect(onLog).toHaveBeenLastCalledWith({ value: null, status: null });
  });
});

describe('правила отметки', () => {
  it('isDone, taskScore и счёт дней без срыва для всех видов', () => {
    const count = { ...base, value: 4 } as TodayTask;
    expect(isDone(count)).toBe(false);
    expect(taskScore(count)).toBe(0.5);
    expect(isDone({ ...count, value: 8 })).toBe(true);
    expect(taskScore({ ...count, value: 20 })).toBe(1);
    const check = { ...base, kind: 'check', target: 1, value: 0 } as TodayTask;
    expect(isDone(check)).toBe(false);
    expect(taskScore(check)).toBe(0);
    expect(isDone({ ...check, value: 1 })).toBe(true);
    expect(taskScore({ ...check, value: 1 })).toBe(1);
    const quit = { ...base, kind: 'abstain', clean_before: 4, status: null } as TodayTask;
    expect(isDone(quit)).toBe(false);
    expect(taskScore(quit)).toBe(0);
    expect(cleanDaysOf(quit)).toBe(4);
    // Срыв — день отмечен, но не «зелёный» и не прибавляется к счёту.
    expect(isDone({ ...quit, status: 'slip' })).toBe(true);
    expect(taskScore({ ...quit, status: 'slip' })).toBe(0);
    expect(cleanDaysOf({ ...quit, status: 'slip' })).toBe(4);
    expect(taskScore({ ...quit, status: 'clean' })).toBe(1);
    expect(cleanDaysOf({ ...quit, status: 'clean' })).toBe(5);
  });
});

describe('карточка «Считать»: ввод числа', () => {
  const input = () => page.getByRole('textbox', { name: 'Вода: ввести число' });
  const key = (k: string) => input().element().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  it('тап по строке «3 из 8» открывает поле с текущим числом, Escape отменяет', async () => {
    const onLog = vi.fn();
    await renderApp(<TaskCard task={base} onLog={onLog} onOpen={() => {}} />);
    await page.getByRole('button', { name: 'Вода: ввести число' }).nth(0).click();
    await expect.element(input()).toHaveValue('3');
    await expect.element(input()).toHaveFocus();
    // Всё выделено: новое число печатается поверх.
    const el = input().element() as HTMLInputElement;
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 1]);
    key('Escape');
    await expect.element(input()).not.toBeInTheDocument();
    expect(onLog).not.toHaveBeenCalled();
  });

  it('буквы отбрасываются, пустое и то же число не отправляются, ноль снимает отметку', async () => {
    const onLog = vi.fn();
    await renderApp(<TaskCard task={base} onLog={onLog} onOpen={() => {}} />);
    const pencil = page.getByRole('button', { name: 'Вода: ввести число' }).last();
    await pencil.click();
    await input().fill('1а2');
    await expect.element(input()).toHaveValue('12');
    await input().fill('');
    key('Enter');
    await expect.element(input()).not.toBeInTheDocument();
    await pencil.click();
    await input().fill('3');
    key('Enter');
    expect(onLog).not.toHaveBeenCalled();
    await pencil.click();
    await input().fill('0');
    key('Enter');
    expect(onLog).toHaveBeenCalledWith({ value: null });
  });

  it('без отметок поле пустое; потеря фокуса сохраняет; без единицы — просто «из 8»', async () => {
    const onLog = vi.fn();
    const task = { ...base, value: 0, unit: null } as TodayTask;
    const { container } = await renderApp(<TaskCard task={task} onLog={onLog} onOpen={() => {}} />);
    await expect.element(page.getByRole('button', { name: 'Вода: ввести число' }).first()).toHaveTextContent('0 из 8');
    expect(container.querySelector<HTMLElement>('.progress i')!.style.width).toBe('0%');
    await page.getByRole('button', { name: 'Вода: ввести число' }).last().click();
    await expect.element(input()).toHaveValue('');
    await expect.element(input()).toHaveAttribute('placeholder', '0');
    await input().fill('6');
    (input().element() as HTMLInputElement).blur();
    expect(onLog).toHaveBeenCalledWith({ value: 6 });
  });

  it('выполненная: отмечена, полоса не шире 100%, галочка снимает', async () => {
    const onLog = vi.fn();
    const onOpen = vi.fn();
    const task = { ...base, value: 12 } as TodayTask;
    const { container } = await renderApp(<TaskCard task={task} onLog={onLog} onOpen={onOpen} />);
    expect(container.querySelector('article')!.className).toBe('task count done');
    expect(container.querySelector<HTMLElement>('.progress i')!.style.width).toBe('100%');
    const done = page.getByRole('button', { name: 'Вода — сделано' });
    await expect.element(done).toHaveAttribute('aria-pressed', 'true');
    await done.click();
    expect(onLog).toHaveBeenCalledWith({ value: null });
    await page.getByRole('button', { name: 'Вода', exact: true }).click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('карточка «Делать»', () => {
  it('галочка ставит 1 и снимает; название открывает привычку', async () => {
    const onLog = vi.fn();
    const onOpen = vi.fn();
    const task = { ...base, title: 'Спортзал', kind: 'check', target: 1, value: 0, unit: null } as TodayTask;
    const { container, rerender } = await renderApp(<TaskCard task={task} onLog={onLog} onOpen={onOpen} />);
    expect(container.querySelector('article')!.className).toBe('task');
    expect(container.querySelector('.progress')).toBeNull();
    const done = page.getByRole('button', { name: 'Спортзал — сделано' });
    await expect.element(done).toHaveAttribute('aria-pressed', 'false');
    await done.click();
    expect(onLog).toHaveBeenLastCalledWith({ value: 1 });
    await rerender(<TaskCard task={{ ...task, value: 1 }} onLog={onLog} onOpen={onOpen} />);
    expect(container.querySelector('article')!.className).toBe('task done');
    await done.click();
    expect(onLog).toHaveBeenLastCalledWith({ value: null });
    await page.getByRole('button', { name: 'Спортзал', exact: true }).click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('карточка «Бросить»: ответы', () => {
  it('«было» — срыв; после ответа видно дни без этого, второй ответ приглушён', async () => {
    const onLog = vi.fn();
    const onOpen = vi.fn();
    const task = { ...base, title: 'Сладкое', kind: 'abstain', status: null, clean_before: 2 } as TodayTask;
    const { container, rerender } = await renderApp(<TaskCard task={task} onLog={onLog} onOpen={onOpen} />);
    await expect.element(page.getByRole('group', { name: 'Сегодня получилось?' })).toBeVisible();
    await page.getByRole('button', { name: 'Нет, сегодня было' }).click();
    expect(onLog).toHaveBeenLastCalledWith({ value: null, status: 'slip' });
    await rerender(<TaskCard task={{ ...task, status: 'slip' }} onLog={onLog} onOpen={onOpen} />);
    await expect.element(page.getByText('2 дня без этого')).toBeVisible();
    expect(container.querySelector('.rb.no')!.className).toBe('rb no on');
    expect(container.querySelector('.rb.ok')!.className).toBe('rb ok dim');
    expect(container.querySelector('article')!.className).toBe('task done');
    await page.getByRole('button', { name: 'Нет, сегодня было' }).click();
    expect(onLog).toHaveBeenLastCalledWith({ value: null, status: null });
    await rerender(<TaskCard task={{ ...task, status: 'clean' }} onLog={onLog} onOpen={onOpen} />);
    await expect.element(page.getByText('3 дня без этого')).toBeVisible();
    await page.getByRole('button', { name: /^Сладкое/ }).click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
