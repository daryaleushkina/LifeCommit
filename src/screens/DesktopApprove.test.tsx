// «Войти на Mac?» в мини-аппе: подтвердить вход на компьютере, уже подтверждён, ошибка, «назад».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ApiError } from '../api';
import { renderApp } from '../test/render';
import { DesktopApprove, desktopLoginParam } from './DesktopApprove';

const m = vi.hoisted(() => ({
  api: { desktopApprove: vi.fn() },
  back: { current: null as (() => void) | null },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));
vi.mock('../telegram/hooks', () => ({
  useBackButton: (fn: (() => void) | null) => {
    m.back.current = fn;
  },
}));

const CODE = 'AbCdEfGhIjKlMnOpQrSt_-';

beforeEach(() => {
  m.api.desktopApprove.mockReset().mockResolvedValue({ ok: true });
  m.back.current = null;
});

describe('ссылка запуска', () => {
  it.each([
    [`mac_${CODE}`, { device: 'mac', code: CODE }],
    [`web_${CODE}`, { device: 'web', code: CODE }],
    [`tv_${CODE}`, null],
    ['mac_short', null],
    [`mac_${CODE}x`, null],
    ['g_abc123', null],
    [null, null],
  ])('%s → %j', (param, expected) => {
    expect(desktopLoginParam(param)).toEqual(expected);
  });
});

describe('«Войти на Mac?»', () => {
  it('«Войти» подтверждает вход этого компьютера; потом — «Готово» и «На главную»', async () => {
    const onClose = vi.fn();
    await renderApp(<DesktopApprove code={CODE} device="mac" onClose={onClose} />);
    await expect.element(page.getByRole('heading', { name: 'Войти на Mac?' })).toBeVisible();
    await expect.element(page.getByText('Не узнаёшь этот вход — просто закрой.')).toBeVisible();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByRole('heading', { name: 'Готово' })).toBeVisible();
    expect(m.api.desktopApprove).toHaveBeenCalledWith(CODE, 'mac');
    await page.getByRole('button', { name: 'На главную' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('пока подтверждается — «Войти» выключена', async () => {
    m.api.desktopApprove.mockReturnValue(new Promise(() => {}));
    await renderApp(<DesktopApprove code={CODE} device="web" onClose={() => {}} />);
    await expect.element(page.getByRole('heading', { name: 'Войти в браузере?' })).toBeVisible();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Войти', exact: true })).toBeDisabled();
  });

  it('вход уже подтверждён (кем-то или раньше) — так и сказать', async () => {
    m.api.desktopApprove.mockRejectedValue(new ApiError(409, 'login_used'));
    const onClose = vi.fn();
    await renderApp(<DesktopApprove code={CODE} device="mac" onClose={onClose} />);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByText('Этот вход уже подтверждён.')).toBeVisible();
    await page.getByRole('button', { name: 'На главную' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('не вышло (связь) — ошибка, можно ещё раз', async () => {
    m.api.desktopApprove.mockRejectedValueOnce(new ApiError(0, 'network'));
    await renderApp(<DesktopApprove code={CODE} device="mac" onClose={() => {}} />);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByText('Не получилось — проверь интернет и попробуй ещё раз.')).toBeVisible();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByRole('heading', { name: 'Готово' })).toBeVisible();
  });

  it('«Не входить» и «назад» — закрыть, ничего не подтверждая', async () => {
    const onClose = vi.fn();
    await renderApp(<DesktopApprove code={CODE} device="mac" onClose={onClose} />);
    await page.getByRole('button', { name: 'Не входить' }).click();
    m.back.current!();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(m.api.desktopApprove).not.toHaveBeenCalled();
  });
});
