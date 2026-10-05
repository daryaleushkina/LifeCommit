// Экран входа на компьютере: «Войти через Telegram» → ссылка в Telegram → ждём подтверждения → ключ сохранён.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../test/render';
import { DesktopLogin } from './Login';

const m = vi.hoisted(() => ({
  api: { desktopLogin: vi.fn(), desktopPoll: vi.fn() },
  links: [] as string[],
  saved: [] as string[],
  saveFails: false,
}));
vi.mock('../api', () => ({ api: m.api }));
vi.mock('@tma.js/sdk-react', () => ({ openTelegramLink: (url: string) => void m.links.push(url) }));
vi.mock('./session', () => ({
  desktopDevice: () => 'mac',
  saveDesktopToken: (token: string) => {
    if (m.saveFails) throw new Error('QuotaExceededError');
    m.saved.push(token);
  },
}));

const SECRET = 's'.repeat(43);
const LINK = 'https://t.me/LifeCommit_bot?startapp=mac_cccccccccccccccccccccc';
const signIn = page.getByRole('button', { name: 'Войти через Telegram' });

beforeEach(() => {
  m.api.desktopLogin.mockReset().mockResolvedValue({ secret: SECRET, code: 'c'.repeat(22), link: LINK });
  m.api.desktopPoll.mockReset().mockResolvedValue({ status: 'pending' });
  Object.assign(m, { links: [], saved: [], saveFails: false });
});
afterEach(() => vi.restoreAllMocks());

describe('вход на компьютере', () => {
  it('«Войти через Telegram» открывает мини-апп; подтвердили — ключ сохранён, приложение открывается', async () => {
    const onDone = vi.fn();
    await renderApp(<DesktopLogin onDone={onDone} pollMs={10} />);
    await expect.element(page.getByText('Привычки, дела и группы — те же, что в Telegram.')).toBeVisible();
    await signIn.click();
    await expect.element(page.getByRole('heading', { name: 'Подтверди вход в Telegram' })).toBeVisible();
    expect(m.api.desktopLogin).toHaveBeenCalledWith('mac');
    expect(m.links).toEqual([LINK]);

    // пока ждём — спрашиваем снова; связь моргнула — тоже спрашиваем снова
    await expect.poll(() => m.api.desktopPoll.mock.calls.length).toBeGreaterThan(1);
    expect(m.api.desktopPoll).toHaveBeenCalledWith(SECRET);
    m.api.desktopPoll.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const calls = m.api.desktopPoll.mock.calls.length;
    await expect.poll(() => m.api.desktopPoll.mock.calls.length).toBeGreaterThan(calls + 1);
    expect(onDone).not.toHaveBeenCalled();

    m.api.desktopPoll.mockResolvedValue({ status: 'ok', token: 'k'.repeat(43) });
    await expect.poll(() => onDone.mock.calls.length).toBe(1);
    expect(m.saved).toEqual(['k'.repeat(43)]);
  });

  it('«Открыть Telegram ещё раз» — та же ссылка; «Отмена» — обратно, опрос прекращается', async () => {
    await renderApp(<DesktopLogin onDone={() => {}} pollMs={10} />);
    await signIn.click();
    await page.getByRole('button', { name: 'Открыть Telegram ещё раз' }).click();
    expect(m.links).toEqual([LINK, LINK]);
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect.element(signIn).toBeVisible();
    const calls = m.api.desktopPoll.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(m.api.desktopPoll.mock.calls.length).toBe(calls);
  });

  it('нажали «Отмена», пока сервер отвечал, — вход не продолжается, даже если ответ «подтвердили»', async () => {
    let answer!: (v: unknown) => void;
    m.api.desktopPoll.mockReturnValue(new Promise((r) => (answer = r)));
    const onDone = vi.fn();
    await renderApp(<DesktopLogin onDone={onDone} pollMs={10} />);
    await signIn.click();
    await expect.poll(() => m.api.desktopPoll.mock.calls.length).toBe(1);
    await page.getByRole('button', { name: 'Отмена' }).click();
    answer({ status: 'ok', token: 'k'.repeat(43) });
    await new Promise((r) => setTimeout(r, 30));
    expect(onDone).not.toHaveBeenCalled();
    expect(m.saved).toEqual([]);
  });

  it('не начался вход (нет связи) — ошибка и можно снова', async () => {
    m.api.desktopLogin.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await renderApp(<DesktopLogin onDone={() => {}} />);
    await signIn.click();
    await expect.element(page.getByText('Не получилось — проверь интернет и попробуй ещё раз.')).toBeVisible();
    await expect.element(signIn).toBeEnabled();
    expect(m.links).toEqual([]);
  });

  it('10 минут не подтверждали — «Время вышло»', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await renderApp(<DesktopLogin onDone={() => {}} pollMs={10} />);
    await signIn.click();
    await expect.element(page.getByRole('heading', { name: 'Подтверди вход в Telegram' })).toBeVisible();
    clock.mockReturnValue(now + 10 * 60_000 + 1);
    await expect.element(page.getByText('Время вышло — попробуй ещё раз.')).toBeVisible();
    await expect.element(signIn).toBeVisible();
  });

  it('ключ не сохранить (хранилище недоступно) — ошибка, приложение не открывается', async () => {
    m.saveFails = true;
    m.api.desktopPoll.mockResolvedValue({ status: 'ok', token: 'k'.repeat(43) });
    const onDone = vi.fn();
    await renderApp(<DesktopLogin onDone={onDone} pollMs={10} />);
    await signIn.click();
    await expect.element(page.getByText('Не получилось — проверь интернет и попробуй ещё раз.')).toBeVisible();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('по-английски', async () => {
    await renderApp(<DesktopLogin onDone={() => {}} />, 'en');
    await expect.element(page.getByRole('button', { name: 'Sign in with Telegram' })).toBeVisible();
  });
});
