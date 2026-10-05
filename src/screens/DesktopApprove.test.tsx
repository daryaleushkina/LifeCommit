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

// Билет из ссылки: код (22), время выдачи (7, base36) и подпись (22); подпись проверяет Worker.
const TICKET = 'AbCdEfGhIjKlMnOpQrSt_-' + '0t4k2xq' + 'Zz-_0123456789abcdefgh';

beforeEach(() => {
  m.api.desktopApprove.mockReset().mockResolvedValue({ ok: true });
  m.back.current = null;
});

describe('ссылка запуска', () => {
  it.each([
    [`mac_${TICKET}`, { device: 'mac', ticket: TICKET }],
    [`web_${TICKET}`, { device: 'web', ticket: TICKET }],
    [`tv_${TICKET}`, null],
    ['mac_short', null],
    [`mac_${TICKET}x`, null],
    // старый вид ссылки (только код) — уже не принимаем
    ['mac_AbCdEfGhIjKlMnOpQrSt_-', null],
    // время — только base36 строчными
    [`mac_${TICKET.slice(0, 22)}0T4K2XQ${TICKET.slice(29)}`, null],
    ['g_abc123', null],
    [null, null],
  ])('%s → %j', (param, expected) => {
    expect(desktopLoginParam(param)).toEqual(expected);
  });
});

describe('«Войти на Mac?»', () => {
  it('«Войти» подтверждает вход этого компьютера; потом — «Готово» и «На главную»', async () => {
    const onClose = vi.fn();
    await renderApp(<DesktopApprove ticket={TICKET} device="mac" onClose={onClose} />);
    await expect.element(page.getByRole('heading', { name: 'Войти на Mac?' })).toBeVisible();
    await expect.element(page.getByText('Не узнаёшь этот вход — просто закрой.')).toBeVisible();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByRole('heading', { name: 'Готово' })).toBeVisible();
    expect(m.api.desktopApprove).toHaveBeenCalledWith(TICKET, 'mac');
    await page.getByRole('button', { name: 'На главную' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('пока подтверждается — «Войти» выключена', async () => {
    m.api.desktopApprove.mockReturnValue(new Promise(() => {}));
    await renderApp(<DesktopApprove ticket={TICKET} device="web" onClose={() => {}} />);
    await expect.element(page.getByRole('heading', { name: 'Войти в браузере?' })).toBeVisible();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Войти', exact: true })).toBeDisabled();
  });

  it('вход уже подтверждён (кем-то или раньше) — так и сказать', async () => {
    m.api.desktopApprove.mockRejectedValue(new ApiError(409, 'login_used'));
    const onClose = vi.fn();
    await renderApp(<DesktopApprove ticket={TICKET} device="mac" onClose={onClose} />);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByText('Этот вход уже подтверждён.')).toBeVisible();
    await page.getByRole('button', { name: 'На главную' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ссылка устарела (больше 10 минут) — начать вход на компьютере заново', async () => {
    m.api.desktopApprove.mockRejectedValue(new ApiError(410, 'login_expired'));
    const onClose = vi.fn();
    await renderApp(<DesktopApprove ticket={TICKET} device="mac" onClose={onClose} />);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByText('Ссылка устарела\u00a0— начни вход на компьютере заново.')).toBeVisible();
    await page.getByRole('button', { name: 'На главную' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('не вышло (связь) — ошибка, можно ещё раз', async () => {
    m.api.desktopApprove.mockRejectedValueOnce(new ApiError(0, 'network'));
    await renderApp(<DesktopApprove ticket={TICKET} device="mac" onClose={() => {}} />);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByText('Не получилось — проверь интернет и попробуй ещё раз.')).toBeVisible();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect.element(page.getByRole('heading', { name: 'Готово' })).toBeVisible();
  });

  it('«Не входить» и «назад» — закрыть, ничего не подтверждая', async () => {
    const onClose = vi.fn();
    await renderApp(<DesktopApprove ticket={TICKET} device="mac" onClose={onClose} />);
    await page.getByRole('button', { name: 'Не входить' }).click();
    m.back.current!();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(m.api.desktopApprove).not.toHaveBeenCalled();
  });
});
