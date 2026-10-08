// Отложенные привычки: вернуть одним тапом или удалить насовсем (с подтверждением в Telegram).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { ArchivedTask } from '../../shared/types';
import { ApiError } from '../api';
import { renderApp } from '../test/render';
import { Archive } from './Archive';

const m = vi.hoisted(() => ({
  api: { restoreTask: vi.fn(), deleteTask: vi.fn() },
  popup: { available: false, answer: 'delete' as string | null, calls: [] as unknown[] },
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
      m.popup.calls.push(p);
      return m.popup.answer;
    },
    { isAvailable: () => m.popup.available },
  );
  return { ...real, popup: { ...real.popup, show } };
});

const list: ArchivedTask[] = [
  { id: 1, title: 'Бег', emoji: null },
  { id: 2, title: 'Читать', emoji: null },
];

beforeEach(() => {
  m.api.restoreTask.mockReset().mockResolvedValue({ ok: true });
  m.api.deleteTask.mockReset().mockResolvedValue({ ok: true });
  m.popup.available = false;
  m.popup.answer = 'delete';
  m.popup.calls = [];
});

describe('Отложенные', () => {
  it('«Вернуть» восстанавливает привычку, перечитывает «Сегодня» и убирает строку', async () => {
    const onChanged = vi.fn(async () => {});
    const onClose = vi.fn();
    await renderApp(<Archive archived={list} onChanged={onChanged} onClose={onClose} />);
    await expect.element(page.getByRole('heading', { name: 'Отложенные' })).toBeVisible();
    await page.getByRole('button', { name: 'Вернуть' }).first().click();
    await expect.element(page.getByText('Бег')).not.toBeInTheDocument();
    expect(m.api.restoreTask).toHaveBeenCalledWith(1);
    expect(onChanged).toHaveBeenCalledWith();
    expect(onClose).not.toHaveBeenCalled();
    await expect.element(page.getByText('Читать')).toBeVisible();
  });

  it('последняя вернулась — экран закрывается', async () => {
    const onClose = vi.fn();
    await renderApp(<Archive archived={[list[0]!]} onChanged={async () => {}} onClose={onClose} />);
    await page.getByRole('button', { name: 'Вернуть' }).click();
    await expect.poll(() => onClose.mock.calls.length).toBeGreaterThan(0);
  });

  it('упёрлись в лимит — сообщение про лимит, другая ошибка — общее', async () => {
    m.api.restoreTask.mockRejectedValueOnce(new ApiError(403, 'task_limit')).mockRejectedValueOnce(new Error('сеть'));
    await renderApp(<Archive archived={list} onChanged={async () => {}} onClose={() => {}} />);
    await page.getByRole('button', { name: 'Вернуть' }).first().click();
    await expect.element(page.getByText('Бесплатно — до 5 привычек. Можно отложить какую-нибудь.')).toBeVisible();
    await page.getByRole('button', { name: 'Вернуть' }).first().click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('Бег')).toBeVisible();
  });

  it('вне Telegram «Удалить» удаляет сразу и просит перечитать с картой', async () => {
    const onChanged = vi.fn(async () => {});
    await renderApp(<Archive archived={list} onChanged={onChanged} onClose={() => {}} />);
    await page.getByRole('button', { name: 'Удалить' }).nth(1).click();
    await expect.element(page.getByText('Читать')).not.toBeInTheDocument();
    expect(m.api.deleteTask).toHaveBeenCalledWith(2);
    expect(onChanged).toHaveBeenCalledWith(true);
  });

  // lc-explore 04.10.2026: «Удалить» при сбое молча ничего не делало.
  it('«Удалить» не прошло — сказано, привычка на месте', async () => {
    m.api.deleteTask.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const onChanged = vi.fn(async () => {});
    await renderApp(<Archive archived={list} onChanged={onChanged} onClose={() => {}} />);
    await page.getByRole('button', { name: 'Удалить' }).nth(1).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('Читать')).toBeVisible();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('в Telegram спрашивает; «Отмена» ничего не удаляет, «Удалить» — удаляет', async () => {
    m.popup.available = true;
    m.popup.answer = null;
    await renderApp(<Archive archived={list} onChanged={async () => {}} onClose={() => {}} />);
    await page.getByRole('button', { name: 'Удалить' }).first().click();
    await expect.poll(() => m.popup.calls.length).toBe(1);
    expect(m.popup.calls[0]).toMatchObject({ message: 'Удалить привычку вместе с историей?' });
    expect(m.api.deleteTask).not.toHaveBeenCalled();

    m.popup.answer = 'delete';
    await page.getByRole('button', { name: 'Удалить' }).first().click();
    await expect.element(page.getByText('Бег')).not.toBeInTheDocument();
    expect(m.api.deleteTask).toHaveBeenCalledWith(1);
  });

  it('кнопка «назад» Telegram закрывает экран', async () => {
    const onClose = vi.fn();
    await renderApp(<Archive archived={[]} onChanged={async () => {}} onClose={onClose} />);
    await expect.element(page.getByRole('heading', { name: 'Отложенные' })).toBeVisible();
    m.back.current?.();
    expect(onClose).toHaveBeenCalled();
  });
});
