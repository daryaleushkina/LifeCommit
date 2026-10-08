// Друзья: список во «Вместе», «Позвать друга», заявки, экран друга, чужая ссылка и «Что показать друзьям?».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { FriendCard, FriendProfile, FriendsResponse, TodayTask } from '../../shared/types';
import { ApiError } from '../api';
import { caches } from '../caches';
import { renderApp } from '../test/render';
import { AddFriendSheet, FriendLink, FriendScreen, FriendsPanel, Requests, ShowSheet } from './Friends';

const m = vi.hoisted(() => ({
  api: {
    friends: vi.fn(), friend: vi.fn(), findPerson: vi.fn(), friendLink: vi.fn(), requestFriend: vi.fn(), acceptFriend: vi.fn(), dropRequest: vi.fn(),
    removeFriend: vi.fn(), block: vi.fn(), setShown: vi.fn(), promptSeen: vi.fn(),
  },
  tg: { popup: false, answer: 'ok' as string | null, popups: [] as unknown[], link: false, links: [] as string[] },
  back: { current: null as (() => void) | null },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));
vi.mock('../telegram/hooks', () => ({
  useBackButton: (fn: (() => void) | null) => {
    m.back.current = fn;
  },
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

const friend = (patch: Partial<FriendCard>): FriendCard => ({ id: 2, first_name: 'Маша', username: 'masha', photo_url: null, since: '2026-10-01', done: 0, due: 0, days: Array(14).fill(0), ...patch });
const list = (patch: Partial<FriendsResponse> = {}): FriendsResponse => ({ friends: [], incoming: [], outgoing: [], link: 'https://t.me/LifeCommit_bot?startapp=f_abc', prompt: false, ...patch });
const habit = (patch: Partial<TodayTask>): TodayTask =>
  ({ id: 1, title: 'Чтение', emoji: null, kind: 'check', unit: null, step: 1, schedule: 'daily', weekdays: 127, per_week: null, visibility: 'private', target: 1, value: 0, logged: false, status: null, week_done: 0, due: true, subtasks: [], challenge_id: null, clean_before: 0, last_slip_on: null, ...patch }) as TodayTask;
const profile = (patch: Partial<FriendProfile> = {}): FriendProfile => ({
  person: { id: 2, first_name: 'Маша', username: 'masha', photo_url: null },
  since: '2026-10-01',
  today: '2026-10-03',
  heat: [{ day: '2026-10-03', score: 2 }],
  habits: [],
  ...patch,
});

beforeEach(() => {
  caches.friends = null;
  caches.friendProfiles.clear();
  for (const fn of Object.values(m.api)) fn.mockReset().mockResolvedValue({ ok: true });
  m.api.friends.mockResolvedValue(list());
  Object.assign(m.tg, { popup: false, answer: 'ok', popups: [], link: false, links: [] });
  m.back.current = null;
});

const panel = (props: Partial<Parameters<typeof FriendsPanel>[0]> = {}) =>
  renderApp(<FriendsPanel habits={[]} onOpen={() => {}} onRequests={() => {}} onShown={() => {}} {...props} />);

describe('список друзей', () => {
  it('никого — подсказка позвать', async () => {
    await panel();
    await expect.element(page.getByText('Позови друга — будете видеть карты друг друга.')).toBeVisible();
  });

  it('карточки: полоска двух недель и «N из M»; тап открывает друга; заявки — строкой сверху', async () => {
    m.api.friends.mockResolvedValue(
      list({
        friends: [friend({ id: 2, first_name: 'Маша', done: 2, due: 3, days: [...Array(13).fill(0), 10] }), friend({ id: 3, first_name: 'Петя' })],
        incoming: [{ id: 5, first_name: 'Тимур', username: 'timur', photo_url: null, via: 'username' }],
      }),
    );
    const onOpen = vi.fn();
    const onRequests = vi.fn();
    await panel({ onOpen, onRequests });
    await expect.element(page.getByText('2 из 3')).toBeVisible();
    // у Пети сегодня ничего не нужно — без «0 из 0»
    expect(page.getByText('0 из 0').elements()).toEqual([]);
    expect(document.querySelectorAll('.friend-card')[0]!.querySelectorAll('.strip i')).toHaveLength(14);
    expect(document.querySelector('.friend-card .strip i:last-child')!.className).toBe('l4');
    await page.getByRole('button', { name: /Маша/ }).click();
    expect(onOpen).toHaveBeenCalledWith(2);
    await page.getByRole('button', { name: /Заявки · 1/ }).click();
    expect(onRequests).toHaveBeenCalled();
  });

  it('свою заявку видно «ждём ответа», её можно отменить', async () => {
    m.api.friends.mockResolvedValueOnce(list({ outgoing: [{ id: 7, first_name: 'Аня', username: null, photo_url: null }] })).mockResolvedValue(list());
    await panel();
    await expect.element(page.getByText('ждём ответа')).toBeVisible();
    await page.getByRole('button', { name: 'Отменить' }).click();
    expect(m.api.dropRequest).toHaveBeenCalledWith(7);
    await expect.element(page.getByText('Позови друга — будете видеть карты друг друга.')).toBeVisible();
  });

  it('друзей много — поиск по имени и @username', async () => {
    const names = ['Маша', 'Петя', 'Алёна', 'Тимур', 'Лиза', 'Даша'];
    m.api.friends.mockResolvedValue(list({ friends: names.map((n, i) => friend({ id: i + 2, first_name: n, username: `u${i}` })) }));
    await panel();
    const search = page.getByRole('searchbox', { name: 'Найти среди друзей' });
    await search.fill('лё');
    await expect.element(page.getByRole('button', { name: /Алёна/ })).toBeVisible();
    expect(document.querySelectorAll('.friend-card')).toHaveLength(1);
    await search.fill('@u4');
    await expect.element(page.getByRole('button', { name: /Лиза/ })).toBeVisible();
    await search.fill('Зина');
    await expect.element(page.getByText('Никого не нашли')).toBeVisible();
  });

  it('первый друг — один раз «Что показать друзьям?»; выбор уходит на сервер', async () => {
    m.api.friends.mockResolvedValue(list({ friends: [friend({})], prompt: true }));
    const onShown = vi.fn();
    await panel({ habits: [habit({ id: 1, title: 'Чтение' }), habit({ id: 2, title: 'Спортзал' })], onShown });
    await expect.element(page.getByRole('dialog', { name: 'Что показать друзьям?' })).toBeVisible();
    await page.getByRole('button', { name: /Спортзал/ }).click();
    await page.getByRole('button', { name: 'Готово' }).click();
    expect(m.api.setShown).toHaveBeenCalledWith([2]);
    expect(onShown).toHaveBeenCalled();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('список не загрузился — пусто, без падения', async () => {
    m.api.friends.mockRejectedValue(new Error('сеть'));
    await panel();
    await expect.element(page.getByText('Позови друга — будете видеть карты друг друга.')).toBeVisible();
  });
});

describe('«Что показать друзьям?»', () => {
  it('«Выбрать все» и снять все; уже открытые отмечены; «Назад» ничего не меняет', async () => {
    const onClose = vi.fn();
    await renderApp(<ShowSheet habits={[habit({ id: 1, title: 'Чтение', visibility: 'friends' }), habit({ id: 2, title: 'Спортзал' }), habit({ id: 3, title: 'Вода', kind: 'count' })]} onClose={onClose} />);
    await expect.element(page.getByRole('button', { name: /Чтение/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Выбрать все' }).click();
    for (const n of ['Чтение', 'Спортзал', 'Вода']) await expect.element(page.getByRole('button', { name: new RegExp(n) })).toHaveAttribute('aria-pressed', 'true');
    // второй раз — снять все
    await page.getByRole('button', { name: 'Выбрать все' }).click();
    await expect.element(page.getByRole('button', { name: /Чтение/ })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: /Вода/ }).click();
    await page.getByRole('button', { name: /Вода/ }).click();
    await page.getByRole('button', { name: /Чтение/ }).click();
    await page.getByRole('button', { name: 'Готово' }).click();
    expect(onClose).toHaveBeenLastCalledWith([1]);
    m.back.current?.();
    expect(onClose).toHaveBeenLastCalledWith(null);
  });

  it('привычек нет — без «Выбрать все»', async () => {
    await renderApp(<ShowSheet habits={[]} onClose={() => {}} />);
    await expect.element(page.getByRole('button', { name: 'Готово' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Выбрать все' }).elements()).toEqual([]);
  });

  it('закрыли шторку назад из списка — «больше не спрашивать»', async () => {
    m.api.friends.mockResolvedValue(list({ friends: [friend({})], prompt: true }));
    await panel({ habits: [habit({})] });
    await expect.element(page.getByRole('dialog')).toBeVisible();
    m.back.current?.();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(m.api.promptSeen).toHaveBeenCalled();
    expect(m.api.setShown).not.toHaveBeenCalled();
  });
});

describe('правка в одном месте — список догоняет', () => {
  it('приняли заявку, пока список открыт рядом, — в нём появляется друг и «Что показать друзьям?»', async () => {
    let accepted = false;
    const stale = list({ incoming: [{ id: 5, first_name: 'Тимур', username: null, photo_url: null, via: 'username' }] });
    const fresh = list({ friends: [friend({ id: 5, first_name: 'Тимур' })], prompt: true });
    m.api.friends.mockImplementation(async () => (accepted ? fresh : stale));
    m.api.acceptFriend.mockImplementation(async () => {
      accepted = true;
      return { ok: true };
    });
    await renderApp(
      <>
        <FriendsPanel habits={[habit({})]} onOpen={() => {}} onRequests={() => {}} onShown={() => {}} />
        <Requests onBack={() => {}} />
      </>,
    );
    await expect.element(page.getByRole('button', { name: /Заявки · 1/ })).toBeVisible();
    await page.getByRole('button', { name: 'Принять' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Что показать друзьям?' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Заявки/ })).not.toBeInTheDocument();
  });

  it('ответ, ушедший до правки, не перетирает свежий', async () => {
    let release: (v: FriendsResponse) => void = () => {};
    const old = new Promise<FriendsResponse>((r) => (release = r));
    m.api.friends.mockReturnValueOnce(old).mockResolvedValue(list({ friends: [friend({ first_name: 'Свежая' })] }));
    m.api.dropRequest.mockResolvedValue({ ok: true });
    caches.friends = list({ outgoing: [{ id: 7, first_name: 'Аня', username: null, photo_url: null }] });
    await panel();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect.element(page.getByRole('button', { name: /Свежая/ })).toBeVisible();
    release(list({ outgoing: [{ id: 7, first_name: 'Аня', username: null, photo_url: null }] }));
    await new Promise((r) => setTimeout(r, 50));
    await expect.element(page.getByRole('button', { name: /Свежая/ })).toBeVisible();
    expect(page.getByText('ждём ответа').elements()).toEqual([]);
  });
});

describe('заявки: ответ, ушедший до нажатия', () => {
  it('не возвращает принятую заявку на экран', async () => {
    let release: (v: FriendsResponse) => void = () => {};
    const stale = list({ incoming: [{ id: 5, first_name: 'Тимур', username: null, photo_url: null, via: 'username' }] });
    caches.friends = stale;
    m.api.friends.mockReturnValueOnce(new Promise<FriendsResponse>((r) => (release = r))).mockResolvedValue(list());
    await renderApp(<Requests onBack={() => {}} />);
    await page.getByRole('button', { name: 'Принять' }).click();
    await expect.element(page.getByText('Тимур')).not.toBeInTheDocument();
    release(stale);
    await new Promise((r) => setTimeout(r, 50));
    await expect.element(page.getByText('Тимур')).not.toBeInTheDocument();
  });
});

describe('сеть подвела', () => {
  it('отменить, выбрать, закрыть, принять, убрать — ошибки сервера не роняют экраны', async () => {
    for (const fn of [m.api.dropRequest, m.api.setShown, m.api.promptSeen, m.api.acceptFriend, m.api.removeFriend, m.api.block]) fn.mockRejectedValue(new Error('сеть'));
    // Отменить свою заявку не вышло (04.10.2026: раньше молча): заявка на месте и строка ошибки; тап её убирает.
    m.api.friends.mockResolvedValueOnce(list({ outgoing: [{ id: 7, first_name: 'Аня', username: null, photo_url: null }] })).mockRejectedValue(new Error('сеть'));
    const one = await panel();
    await page.getByRole('button', { name: 'Отменить' }).click();
    expect(m.api.dropRequest).toHaveBeenCalledWith(7);
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('ждём ответа')).toBeVisible();
    await page.getByText('Что-то пошло не так. Попробуй ещё раз.').click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
    await one.unmount();

    // «Что показать»: «Готово» — сервер не сохранил выбор (04.10.2026: раньше шторка молча закрывалась). Шторка снова
    // открыта с тем же выбором и строкой ошибки, «Сегодня» не перечитывается; повтор удался — закрывается.
    m.api.friends.mockResolvedValue(list({ friends: [friend({})], prompt: true }));
    const onShown = vi.fn();
    const two = await panel({ habits: [habit({})], onShown });
    await page.getByRole('button', { name: /Чтение/ }).click();
    await page.getByRole('button', { name: 'Готово' }).click();
    await expect.element(page.getByRole('dialog').getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Чтение/ })).toHaveAttribute('aria-pressed', 'true');
    expect(onShown).not.toHaveBeenCalled();
    m.api.setShown.mockResolvedValue({ ok: true });
    await page.getByRole('button', { name: 'Готово' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(m.api.setShown).toHaveBeenLastCalledWith([1]);
    expect(onShown).toHaveBeenCalled();
    await two.unmount();
    // «Назад» — только служебная отметка «спросили»: не дошла — не беда, шторка закрывается.
    await panel({ habits: [habit({})] });
    await expect.element(page.getByRole('dialog')).toBeVisible();
    m.back.current?.();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('заявки: принять или отклонить не вышло — заявка на месте, строка ошибки', async () => {
    caches.friends = list({ incoming: [{ id: 5, first_name: 'Тимур', username: null, photo_url: null, via: 'username' }] });
    m.api.friends.mockRejectedValue(new Error('сеть'));
    m.api.acceptFriend.mockRejectedValue(new Error('сеть'));
    m.api.dropRequest.mockRejectedValue(new Error('сеть'));
    await renderApp(<Requests onBack={() => {}} />);
    await page.getByRole('button', { name: 'Принять' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('Тимур')).toBeVisible();
    // Тап по ошибке её убирает; «Отклонить» тоже не вышло — заявка снова на месте.
    await page.getByText('Что-то пошло не так. Попробуй ещё раз.').click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Отклонить' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('Тимур')).toBeVisible();
  });

  it('«Позвать друга» без ссылки и без сети — кнопка ссылки неактивна', async () => {
    m.api.friends.mockRejectedValue(new Error('сеть'));
    await renderApp(<AddFriendSheet onClose={() => {}} />);
    await expect.element(page.getByRole('button', { name: 'Отправить ссылку в Telegram' })).toBeDisabled();
  });

  // 04.10.2026: раньше экран закрывался, будто друга убрали, а на сервере он оставался — и снова появлялся в списке.
  it('убрать из друзей или заблокировать не вышло — остаёмся на экране друга, строка ошибки', async () => {
    m.api.friend.mockResolvedValue(profile());
    m.api.removeFriend.mockRejectedValue(new Error('сеть'));
    m.api.block.mockRejectedValue(new Error('сеть'));
    const onBack = vi.fn();
    await renderApp(<FriendScreen id={2} onBack={onBack} />);
    await page.getByRole('button', { name: 'Убрать из друзей' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Маша' })).toBeVisible();
    expect(caches.friendProfiles.has(2)).toBe(true);
    await page.getByText('Что-то пошло не так. Попробуй ещё раз.').click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Заблокировать' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    expect(m.api.block).toHaveBeenCalledWith(2);
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe('«Позвать друга»', () => {
  it('ссылка — в Telegram, человек по @username — «Позвать», потом «Заявка отправлена»', async () => {
    caches.friends = list();
    m.tg.link = true;
    m.api.findPerson.mockResolvedValue({ person: { id: 9, first_name: 'Маша Петрова', username: 'masha', photo_url: null }, status: 'none' });
    m.api.requestFriend.mockResolvedValue({ status: 'sent' });
    await renderApp(<AddFriendSheet onClose={() => {}} />);
    await page.getByRole('button', { name: 'Отправить ссылку в Telegram' }).click();
    expect(m.tg.links[0]).toBe(`https://t.me/share/url?url=${encodeURIComponent('https://t.me/LifeCommit_bot?startapp=f_abc')}&text=${encodeURIComponent('Давай дружить в LifeCommit')}`);

    await page.getByRole('textbox', { name: 'Найти по @username' }).fill('@masha');
    await expect.element(page.getByText('Маша Петрова')).toBeVisible();
    expect(m.api.findPerson).toHaveBeenCalledWith('@masha');
    await page.getByRole('button', { name: 'Позвать' }).click();
    expect(m.api.requestFriend).toHaveBeenCalledWith({ username: 'masha' });
    await expect.element(page.getByText('Заявка отправлена')).toBeVisible();
  });

  it('уже друзья, это вы, нет такого, не похоже на имя; ссылки ещё нет — подгружаем', async () => {
    m.api.friends.mockResolvedValue(list());
    m.api.findPerson
      .mockResolvedValueOnce({ person: { id: 9, first_name: 'Маша', username: 'masha', photo_url: null }, status: 'friends' })
      .mockRejectedValueOnce(new ApiError(404, 'not_found'))
      .mockRejectedValueOnce(new ApiError(400, 'bad_username'));
    await renderApp(<AddFriendSheet onClose={() => {}} />);
    await expect.element(page.getByRole('button', { name: 'Отправить ссылку в Telegram' })).toBeEnabled();
    const input = page.getByRole('textbox', { name: 'Найти по @username' });
    await input.fill('masha');
    await expect.element(page.getByText('Уже друзья')).toBeVisible();
    await input.fill('nobody1');
    await expect.element(page.getByText('Такого человека нет в LifeCommit')).toBeVisible();
    await input.fill('a b c');
    await expect.element(page.getByText('Это не похоже на @username')).toBeVisible();
    // Коротко — не ищем.
    await input.fill('ab');
    expect(m.api.findPerson).toHaveBeenCalledTimes(3);
    // Сеть или сервер подвели — «что-то пошло не так», а не «такого нет» (code-review 07.10.2026).
    m.api.findPerson.mockRejectedValueOnce(new Error('сеть'));
    await input.fill('masha2');
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    expect(page.getByText('Такого человека нет в LifeCommit').elements()).toEqual([]);
  });

  // code-review 07.10.2026: ответ на «masha», пришедший, когда уже напечатали «masha2», не должен остаться строкой с
  // «Позвать» рядом с «такого нет».
  it('ответ поиска на старое имя не показывается: ввели дальше — виден только итог для нового', async () => {
    m.api.friends.mockResolvedValue(list());
    let release!: (v: { person: { id: number; first_name: string; username: string; photo_url: null }; status: 'none' }) => void;
    m.api.findPerson
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
      .mockRejectedValueOnce(new ApiError(404, 'not_found'));
    await renderApp(<AddFriendSheet onClose={() => {}} />);
    const input = page.getByRole('textbox', { name: 'Найти по @username' });
    await input.fill('masha');
    await expect.poll(() => m.api.findPerson.mock.calls.length).toBe(1);
    await input.fill('masha2');
    // Ответ на «masha» приходит, пока ждём, когда допечатают «masha2», — потом итог для нового имени.
    release({ person: { id: 9, first_name: 'Маша', username: 'masha', photo_url: null }, status: 'none' });
    await expect.element(page.getByText('Такого человека нет в LifeCommit')).toBeVisible();
    expect(page.getByRole('button', { name: 'Позвать' }).elements()).toEqual([]);
    expect(page.getByText('Маша', { exact: true }).elements()).toEqual([]);
  });

  it('вне Telegram ссылка открывается в браузере; позвать не вышло — «что-то пошло не так»', async () => {
    caches.friends = list();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    m.api.findPerson.mockResolvedValue({ person: { id: 9, first_name: 'Маша', username: null, photo_url: null }, status: 'incoming' });
    m.api.requestFriend.mockRejectedValue(new Error('сеть'));
    await renderApp(<AddFriendSheet onClose={() => {}} />);
    await page.getByRole('button', { name: 'Отправить ссылку в Telegram' }).click();
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://t.me/share/url?url='), '_blank');
    await page.getByRole('textbox', { name: 'Найти по @username' }).fill('masha');
    await page.getByRole('button', { name: 'Позвать' }).click();
    expect(m.api.requestFriend).toHaveBeenCalledWith({ username: 'masha' });
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    open.mockRestore();
  });
});

describe('заявки', () => {
  it('«@username» или «по вашей ссылке»; принять и отклонить', async () => {
    caches.friends = list({
      incoming: [
        { id: 5, first_name: 'Тимур', username: 'timur', photo_url: null, via: 'username' },
        { id: 6, first_name: 'Аня', username: null, photo_url: null, via: 'link' },
      ],
    });
    m.api.friends.mockResolvedValue(caches.friends);
    const onBack = vi.fn();
    await renderApp(<Requests onBack={onBack} />);
    await expect.element(page.getByText('@timur')).toBeVisible();
    await expect.element(page.getByText('по вашей ссылке')).toBeVisible();
    await page.getByRole('button', { name: 'Принять' }).first().click();
    expect(m.api.acceptFriend).toHaveBeenCalledWith(5);
    await expect.element(page.getByText('Тимур')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Отклонить' }).click();
    expect(m.api.dropRequest).toHaveBeenCalledWith(6);
    await expect.element(page.getByText('Новых заявок нет')).toBeVisible();
    await expect.element(page.getByText('Никого не нашли')).not.toBeInTheDocument();
    m.back.current?.();
    expect(onBack).toHaveBeenCalled();
  });
});

describe('экран друга', () => {
  it('карта «Месяц · Год», привычки списком с иконкой и сегодняшним состоянием', async () => {
    m.api.friend.mockResolvedValue(
      profile({
        habits: [
          { id: 1, title: 'Испанский', emoji: null, kind: 'count', unit: 'слов', target: 20, value: 12, status: null, due: true, clean_days: 0, logs: [] },
          { id: 2, title: 'Зарядка', emoji: null, kind: 'check', unit: null, target: 1, value: 1, status: null, due: true, clean_days: 0, logs: [] },
          { id: 3, title: 'Без сладкого', emoji: null, kind: 'abstain', unit: null, target: 1, value: 0, status: 'clean', due: true, clean_days: 23, logs: [] },
          { id: 4, title: 'Бег', emoji: null, kind: 'check', unit: null, target: 1, value: 0, status: null, due: true, clean_days: 0, logs: [] },
        ],
      }),
    );
    await renderApp(<FriendScreen id={2} onBack={() => {}} />);
    await expect.element(page.getByRole('heading', { name: 'Маша' })).toBeVisible();
    await expect.element(page.getByText('@masha')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Месяц' })).toBeVisible();
    await expect.element(page.getByText('12 из 20 слов')).toBeVisible();
    await expect.element(page.getByText('сделано')).toBeVisible();
    await expect.element(page.getByText('23 дня без этого')).toBeVisible();
    expect(document.querySelectorAll('.friend-habit .kind-tile')).toHaveLength(4);
    await page.getByRole('button', { name: 'Год' }).click();
    await expect.element(page.getByText('1 активный день')).toBeVisible();
  });

  it('ничего не открыто — «Пока ничего не открыто»', async () => {
    m.api.friend.mockResolvedValue(profile());
    await renderApp(<FriendScreen id={2} onBack={() => {}} />);
    await expect.element(page.getByText('Пока ничего не открыто')).toBeVisible();
  });

  it('убрать из друзей и заблокировать — с подтверждением, потом назад', async () => {
    m.api.friend.mockResolvedValue(profile());
    m.tg.popup = true;
    const onBack = vi.fn();
    await renderApp(<FriendScreen id={2} onBack={onBack} />);
    m.tg.answer = null;
    await page.getByRole('button', { name: 'Убрать из друзей' }).click();
    await expect.poll(() => m.tg.popups.length).toBe(1);
    expect(m.api.removeFriend).not.toHaveBeenCalled();
    m.tg.answer = 'ok';
    await page.getByRole('button', { name: 'Заблокировать' }).click();
    await expect.poll(() => onBack.mock.calls.length).toBe(1);
    expect(m.api.block).toHaveBeenCalledWith(2);
    expect(m.tg.popups[1]).toMatchObject({ message: 'Заблокировать: Маша? Не найдёт вас и не пришлёт заявку.' });
  });

  it('вне Telegram — без подтверждения; убрали — назад', async () => {
    m.api.friend.mockResolvedValue(profile());
    const onBack = vi.fn();
    await renderApp(<FriendScreen id={2} onBack={onBack} />);
    await page.getByRole('button', { name: 'Убрать из друзей' }).click();
    await expect.poll(() => onBack.mock.calls.length).toBe(1);
    expect(m.api.removeFriend).toHaveBeenCalledWith(2);
  });

  it('уже не друг (404) — «Ссылка не работает»; сеть моргнула — экран остаётся', async () => {
    m.api.friend.mockRejectedValue(new ApiError(404, 'not_found'));
    await renderApp(<FriendScreen id={2} onBack={() => {}} />);
    await expect.element(page.getByText('Ссылка не работает')).toBeVisible();
  });

  it('сеть моргнула, а экран уже был — он остаётся', async () => {
    caches.friendProfiles.set(2, profile());
    m.api.friend.mockRejectedValue(new Error('сеть'));
    await renderApp(<FriendScreen id={2} onBack={() => {}} />);
    await expect.element(page.getByRole('heading', { name: 'Маша' })).toBeVisible();
  });
});

describe('чужая ссылка', () => {
  it.each([new TypeError('Failed to fetch'), new ApiError(500, 'internal')])('ссылку не загрузили — ошибка сети или сервера, без «Ссылка не работает»', async (error) => {
    m.api.friendLink.mockRejectedValue(error);
    await renderApp(<FriendLink code="abc" onClose={() => {}} onFriends={() => {}} />);
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('Ссылка не работает')).not.toBeInTheDocument();
  });

  it.each([new TypeError('Failed to fetch'), new ApiError(500, 'internal')])('заявка не ушла — ссылка остаётся, можно повторить', async (error) => {
    m.api.friendLink.mockResolvedValue({ person: { id: 3, first_name: 'Даша', username: 'dasha', photo_url: null }, status: 'none' });
    m.api.requestFriend.mockRejectedValueOnce(error).mockResolvedValueOnce({ status: 'sent' });
    await renderApp(<FriendLink code="abc" onClose={() => {}} onFriends={() => {}} />);
    await page.getByRole('button', { name: 'Хочу дружить' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('Ссылка не работает')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Хочу дружить' }).click();
    await expect.element(page.getByText('Заявка отправлена — Даша подтвердит')).toBeVisible();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
  });

  it('«Хочу дружить» → заявка отправлена → «Открыть» ведёт к друзьям', async () => {
    m.api.friendLink.mockResolvedValue({ person: { id: 3, first_name: 'Даша', username: 'dasha', photo_url: null }, status: 'none' });
    m.api.requestFriend.mockResolvedValue({ status: 'sent' });
    const onFriends = vi.fn();
    await renderApp(<FriendLink code="abc" onClose={() => {}} onFriends={onFriends} />);
    await expect.element(page.getByRole('heading', { name: 'Даша зовёт в друзья' })).toBeVisible();
    await expect.element(page.getByText('Будете видеть карты друг друга')).toBeVisible();
    await page.getByRole('button', { name: 'Хочу дружить' }).click();
    expect(m.api.requestFriend).toHaveBeenCalledWith({ code: 'abc' });
    await expect.element(page.getByText('Заявка отправлена — Даша подтвердит')).toBeVisible();
    await page.getByRole('button', { name: 'Открыть' }).click();
    expect(onFriends).toHaveBeenCalled();
  });

  it('своя ссылка, уже друзья, заблокирован; «Не сейчас» и «назад» закрывают', async () => {
    const onClose = vi.fn();
    for (const [status, text] of [
      ['self', 'Это ваша ссылка — отправьте её другу'],
      ['friends', 'Вы уже друзья'],
      ['blocked', 'Вы заблокировали этого человека'],
    ] as const) {
      m.api.friendLink.mockResolvedValue({ person: { id: 3, first_name: 'Даша', username: null, photo_url: null }, status });
      const screen = await renderApp(<FriendLink code="abc" onClose={onClose} onFriends={() => {}} />);
      await expect.element(page.getByText(text)).toBeVisible();
      await screen.unmount();
    }
    await renderApp(<FriendLink code="abc" onClose={onClose} onFriends={() => {}} />);
    await page.getByRole('button', { name: 'Открыть' }).click();
    await page.getByRole('button', { name: 'Не сейчас' }).click();
    m.back.current?.();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('ссылка не работает — так и пишем; заявка не ушла — тоже', async () => {
    m.api.friendLink.mockRejectedValueOnce(new ApiError(404, 'not_found'));
    const first = await renderApp(<FriendLink code="nope" onClose={() => {}} onFriends={() => {}} />);
    await expect.element(page.getByText('Ссылка не работает')).toBeVisible();
    await first.unmount();
    m.api.friendLink.mockResolvedValue({ person: { id: 3, first_name: 'Даша', username: null, photo_url: null }, status: 'incoming' });
    m.api.requestFriend.mockRejectedValue(new ApiError(404, 'not_found'));
    await renderApp(<FriendLink code="abc" onClose={() => {}} onFriends={() => {}} />);
    await page.getByRole('button', { name: 'Хочу дружить' }).click();
    await expect.element(page.getByText('Ссылка не работает')).toBeVisible();
  });
});
