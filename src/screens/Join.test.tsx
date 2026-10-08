// Вступление в группу по ссылке: кто зовёт, «Вступить», устаревшая и чужая ссылка.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ApiError, type GroupDetail, type Invitation } from '../api';
import { caches } from '../caches';
import { renderApp } from '../test/render';
import { Join } from './Join';

const m = vi.hoisted(() => ({
  api: { invitation: vi.fn(), join: vi.fn(), group: vi.fn() },
  back: { current: null as (() => void) | null },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));
vi.mock('../telegram/hooks', () => ({
  useBackButton: (fn: (() => void) | null) => {
    m.back.current = fn;
  },
  useMainButton: () => {},
}));

const inv = (patch: Partial<Invitation> = {}): Invitation => ({
  group: { id: 7, title: 'Семья', kind: 'family', color: null },
  inviter: 'Мама',
  members: [
    { id: 1, name: 'Мама' },
    { id: 2, name: 'Папа' },
  ],
  member: false,
  ...patch,
});

beforeEach(() => {
  caches.invitations.clear();
  caches.groups.clear();
  m.api.invitation.mockReset().mockResolvedValue(inv());
  m.api.join.mockReset().mockResolvedValue({ id: 7 });
  m.api.group.mockReset().mockResolvedValue({ id: 7, title: 'Семья' } as GroupDetail);
});

describe('Вступление по ссылке', () => {
  it('приглашение из кэша — экран сразу; «Вступить» вступает и заранее грузит группу', async () => {
    caches.invitations.set('abc123', inv());
    const onJoined = vi.fn();
    await renderApp(<Join code="abc123" onJoined={onJoined} onClose={() => {}} />);
    await expect.element(page.getByText('Мама зовёт тебя в группу')).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Семья' })).toBeVisible();
    await expect.element(page.getByText(/Мама, Папа/)).toBeVisible();
    await expect.element(page.getByText('Твои личные дела группа не видит')).toBeVisible();
    await page.getByRole('button', { name: 'Вступить' }).click();
    await expect.poll(() => onJoined.mock.calls).toEqual([[7]]);
    expect(m.api.join).toHaveBeenCalledWith('abc123');
    expect(caches.groups.get(7)).toMatchObject({ title: 'Семья' });
  });

  it('без кэша — пусто, пока не пришло; без пригласившего — «Тебя зовут в группу»', async () => {
    let resolve!: (v: Invitation) => void;
    m.api.invitation.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderApp(<Join code="abc123" onJoined={() => {}} onClose={() => {}} />);
    await expect.element(page.getByRole('button', { name: 'Вступить' })).not.toBeInTheDocument();
    resolve(inv({ inviter: null }));
    await expect.element(page.getByText('Тебя зовут в группу')).toBeVisible();
  });

  it('уже в группе — «Открыть группу» без вступления и «Ты уже в этой группе» закрывает', async () => {
    m.api.invitation.mockResolvedValue(inv({ member: true }));
    const onJoined = vi.fn();
    const onClose = vi.fn();
    await renderApp(<Join code="abc123" onJoined={onJoined} onClose={onClose} />);
    await page.getByRole('button', { name: 'Открыть группу' }).click();
    expect(onJoined).toHaveBeenCalledWith(7);
    expect(m.api.join).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Ты уже в этой группе' }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it('устаревшая ссылка — просит новую, «Не сейчас» закрывает', async () => {
    m.api.invitation.mockRejectedValue(new ApiError(410, 'invite_expired'));
    const onClose = vi.fn();
    await renderApp(<Join code="old" onJoined={() => {}} onClose={onClose} />);
    await expect.element(page.getByText('Ссылка устарела — попроси новую.')).toBeVisible();
    await page.getByRole('button', { name: 'Не сейчас' }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it('неизвестная ссылка — «Приглашение не найдено»', async () => {
    m.api.invitation.mockRejectedValue(new ApiError(404, 'not_found'));
    await renderApp(<Join code="nope" onJoined={() => {}} onClose={() => {}} />);
    await expect.element(page.getByText('Приглашение не найдено.')).toBeVisible();
  });

  it('вступить без сети — ошибка, приглашение остаётся и повторное нажатие вступает', async () => {
    m.api.join.mockRejectedValueOnce(new Error('сеть'));
    const onJoined = vi.fn();
    await renderApp(<Join code="abc123" onJoined={onJoined} onClose={() => {}} />);
    await page.getByRole('button', { name: 'Вступить' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('Приглашение не найдено.')).not.toBeInTheDocument();
    expect(onJoined).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Вступить' }).click();
    await expect.poll(() => onJoined.mock.calls).toEqual([[7]]);
  });

  it.each([[404, 'not_found', 'Приглашение не найдено.'], [410, 'invite_expired', 'Ссылка устарела — попроси новую.']])('сервер отказал при вступлении: %s %s', async (status, code, text) => {
    m.api.join.mockRejectedValue(new ApiError(Number(status), String(code)));
    await renderApp(<Join code="abc123" onJoined={() => {}} onClose={() => {}} />);
    await page.getByRole('button', { name: 'Вступить' }).click();
    await expect.element(page.getByText(String(text))).toBeVisible();
  });

  it.each([new TypeError('Failed to fetch'), new ApiError(500, 'internal')])('приглашение не загрузилось — ошибка сети или сервера, без «не найдено»', async (error) => {
    m.api.invitation.mockRejectedValue(error);
    await renderApp(<Join code="abc123" onJoined={() => {}} onClose={() => {}} />);
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('Приглашение не найдено.')).not.toBeInTheDocument();
  });

  it('группа не догрузилась после вступления — экран группы всё равно открывается', async () => {
    m.api.group.mockRejectedValue(new Error('сеть'));
    const onJoined = vi.fn();
    await renderApp(<Join code="abc123" onJoined={onJoined} onClose={() => {}} />);
    await page.getByRole('button', { name: 'Вступить' }).click();
    await expect.poll(() => onJoined.mock.calls).toEqual([[7]]);
  });

  it('кнопка «назад» Telegram закрывает', async () => {
    const onClose = vi.fn();
    await renderApp(<Join code="abc123" onJoined={() => {}} onClose={onClose} />);
    m.back.current?.();
    expect(onClose).toHaveBeenCalled();
  });
});
