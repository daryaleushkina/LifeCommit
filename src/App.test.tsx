// Приложение целиком: заставка и загрузка, ошибка с «Ещё раз», вкладки, ссылки запуска, переходы между экранами и голос.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type { GroupDayItem, GroupItemDraft } from '../shared/groups';
import type { TaskInput, TodayResponse, TodayTask, TodoInput, UserSettings } from '../shared/types';
import type { GroupDetail, Invitation } from './api';
import { App } from './App';
import { caches } from './caches';
import type { GroupVoiceItem, VoicePreview } from './components/VoiceSheet';
import { dictionaries } from './i18n';
import { bumpChange } from './useTaskLog';

const m = vi.hoisted(() => ({
  api: {
    session: vi.fn(), today: vi.fn(), heatmap: vi.fn(), calendars: vi.fn(), calendar: vi.fn(), syncCalendars: vi.fn(), googleUrl: vi.fn(),
    invitation: vi.fn(), join: vi.fn(), group: vi.fn(), groups: vi.fn(), history: vi.fn(), laterTodos: vi.fn(), createTodos: vi.fn(),
    createTasks: vi.fn(), createItem: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(), archiveTask: vi.fn(), restoreTask: vi.fn(),
    deleteTask: vi.fn(), settings: vi.fn(), summary: vi.fn(), log: vi.fn(), checkGroupChat: vi.fn(), markItem: vi.fn(),
    friends: vi.fn(), friend: vi.fn(), friendLink: vi.fn(), blocks: vi.fn(), requestFriend: vi.fn(), setShown: vi.fn(),
  },
  main: { text: '', press: null as null | (() => void) },
  back: { current: null as (() => void) | null },
  voice: { preview: null as VoicePreview | null, todos: [] as TodoInput[], habits: [] as TaskInput[], groupItems: [] as GroupVoiceItem[] },
}));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: m.api }));
vi.mock('./telegram/hooks', () => ({
  useBackButton: (fn: (() => void) | null) => {
    m.back.current = fn;
  },
  useMainButton: (text: string, _state: string, onPress: () => void) => {
    m.main.text = text;
    m.main.press = onPress;
  },
}));
// Запись голоса проверяют отдельно; здесь — что приложение делает с разобранным: добавить, поправить, вручную.
vi.mock('./components/VoiceSheet', async (orig) => {
  const { createElement: h } = await import('react');
  type P = Parameters<typeof import('./components/VoiceSheet').VoiceSheet>[0];
  return {
    ...(await orig<typeof import('./components/VoiceSheet')>()),
    VoiceSheet: (p: P) =>
      h(
        'div',
        { role: 'dialog', 'aria-label': 'Голос' },
        h('p', null, `место: ${p.room ?? 'без лимита'}; группа: ${p.groupId ?? 'нет'}; привычки: ${p.preview?.habits.map((x) => x.title).join(', ') ?? '—'}`),
        h('button', { onClick: () => p.setPreview(m.voice.preview) }, 'Разобрать'),
        h('button', { onClick: () => p.onEdit(0) }, 'Править первую'),
        h('button', { onClick: () => void p.onAdd(m.voice.todos, m.voice.habits, m.voice.groupItems) }, 'Добавить всё'),
        h('button', { onClick: p.onManual }, 'Вручную'),
        h('button', { onClick: p.onClose }, 'Закрыть голос'),
      ),
  };
});

const TODAY = '2026-10-03';
const user = (patch: Partial<UserSettings> = {}): UserSettings => ({
  id: 1, first_name: 'Даша', username: null, photo_url: null, language_code: 'ru', timezone: 'Europe/Moscow', day_start_hour: 4,
  remind_morning: null, remind_evening: null, bot_chat_ok: true, premium: false, ...patch,
});
const task = (patch: Partial<TodayTask> = {}): TodayTask => ({
  id: 1, title: 'Бег', emoji: null, kind: 'check', unit: null, step: 1, schedule: 'daily', weekdays: 127, per_week: null,
  visibility: 'private', target: 1, value: 0, logged: false, status: null, week_done: 0, due: true, subtasks: [], challenge_id: null,
  clean_before: 0, last_slip_on: null, ...patch,
});
const today = (patch: Partial<TodayResponse> = {}): TodayResponse => ({
  day: TODAY, tasks: [task()], archived: [], limits: { max_tasks: null, active: 1 }, todos: [], todos_later: 0, groups: [], ...patch,
});
const EMPTY = today({ tasks: [], limits: { max_tasks: null, active: 0 } });
const groupItem = (patch: Partial<GroupDayItem> = {}): GroupDayItem => ({
  id: 1, title: 'Вынести мусор', mode: 'one', time: null, duration_min: null, due_day: null, carried: false, recurring: false,
  people: [1, 2], all_members: false, rotate: false, turn: null, for_me: true, can_mark: true, done: false, done_by: [],
  target: null, total: null, unit: null, goal_until: null, start: TODAY, rrule: null, assignees: [], ...patch,
});
const members = [{ id: 1, name: 'Даша', photo: null }, { id: 2, name: 'Миша', photo: null }];
const family = (patch: Partial<GroupDetail> = {}): GroupDetail => ({
  id: 10, title: 'Семья', kind: 'family', color: null, role: 'owner', members, items: [groupItem()], planned: 1, done: 0,
  settings: { admins_only_edit: false, rating_enabled: false, chat_digest: false, chat_reminders: false, tg_chat_title: null }, upcoming: [], ...patch,
});
const invitation: Invitation = { group: { id: 10, title: 'Семья', kind: 'family', color: null }, inviter: 'Мама', members: [{ id: 2, name: 'Миша' }], member: false };
const draft: GroupItemDraft = { title: 'Купить хлеб', mode: 'one', day: TODAY, time: null, rrule: null, assignees: [], all_members: false, rotate: false, target: null, unit: null, duration_min: null };

/** Запуск: что ответит сервер на вход и на «Сегодня». */
async function boot({ start_param = null as string | null, me = user(), first = today() } = {}) {
  m.api.session.mockResolvedValue({ user: me, start_param, is_new: false });
  m.api.today.mockResolvedValue(first);
  await render(<App />);
}
const tab = (name: string) => page.getByRole('navigation').getByRole('button', { name });
const heading = (name: string) => page.getByRole('heading', { name, level: 1 });

let url: string;
beforeEach(() => {
  url = window.location.href;
  Object.assign(caches, { accounts: null, googleUrl: null, groupList: null, later: null });
  for (const map of [caches.days, caches.groups, caches.history, caches.invitations]) map.clear();
  localStorage.clear();
  for (const f of Object.values(m.api)) f.mockReset();
  m.api.session.mockResolvedValue({ user: user(), start_param: null, is_new: false });
  m.api.today.mockResolvedValue(today());
  m.api.heatmap.mockResolvedValue({ today: TODAY, days: [] });
  m.api.calendars.mockResolvedValue([]);
  m.api.calendar.mockImplementation(async () => ({ today: TODAY, todos: [], groups: [] }));
  m.api.syncCalendars.mockResolvedValue({ ok: true });
  m.api.googleUrl.mockResolvedValue({ url: '' });
  m.api.invitation.mockResolvedValue(invitation);
  m.api.join.mockResolvedValue({ id: 10 });
  m.api.group.mockResolvedValue(family());
  m.api.groups.mockResolvedValue([]);
  m.api.friends.mockResolvedValue({ friends: [{ id: 2, first_name: 'Маша', username: 'masha', photo_url: null, since: null, done: 1, due: 2, days: Array(14).fill(0) }], incoming: [{ id: 5, first_name: 'Тимур', username: 'timur', photo_url: null, via: 'username' }], outgoing: [], link: 'https://t.me/LifeCommit_bot?startapp=f_abc', prompt: false });
  m.api.friend.mockResolvedValue({ person: { id: 2, first_name: 'Маша', username: 'masha', photo_url: null }, since: null, today: TODAY, heat: [], habits: [] });
  m.api.friendLink.mockResolvedValue({ person: { id: 3, first_name: 'Даша Л', username: null, photo_url: null }, status: 'none' });
  m.api.blocks.mockResolvedValue([]);
  m.api.history.mockResolvedValue({ start: TODAY, goals: [], logs: [] });
  m.api.laterTodos.mockResolvedValue([]);
  m.api.createTodos.mockResolvedValue({ ids: [] });
  m.api.createTasks.mockResolvedValue({ ids: [] });
  m.api.createItem.mockResolvedValue({ id: 1 });
  m.api.createTask.mockResolvedValue({ id: 2 });
  m.api.updateTask.mockResolvedValue({ ok: true, goal_effective_from: null });
  m.api.archiveTask.mockResolvedValue({ ok: true });
  m.api.restoreTask.mockResolvedValue({ ok: true });
  m.api.deleteTask.mockResolvedValue({ ok: true });
  m.api.settings.mockImplementation(async (patch: Partial<UserSettings>) => user(patch));
  m.api.summary.mockResolvedValue([]);
  m.api.log.mockResolvedValue({ ok: true });
  m.api.checkGroupChat.mockResolvedValue({ tg_chat_title: null });
  m.api.markItem.mockResolvedValue({ ok: true, taken: false });
  Object.assign(m.voice, { preview: null, todos: [], habits: [], groupItems: [] });
  m.main.press = null;
  m.back.current = null;
});
afterEach(() => {
  window.history.replaceState(null, '', url);
  vi.restoreAllMocks();
});

describe('запуск', () => {
  it('пока грузится — заставка, потом «Сегодня»; первый экран и календари подтянуты заранее', async () => {
    let enter!: () => void;
    m.api.session.mockReturnValue(new Promise((r) => (enter = () => r({ user: user(), start_param: null, is_new: false }))));
    await render(<App />);
    await expect.element(page.getByText('Life', { exact: false })).toBeVisible();
    expect(document.querySelector('main[aria-busy="true"]')).not.toBeNull();
    enter();
    await expect.element(heading('Сегодня')).toBeVisible();
    expect(m.api.session).toHaveBeenCalledWith(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(m.api.heatmap).toHaveBeenCalledWith(371);
    expect(m.api.calendars).toHaveBeenCalled();
    expect(m.api.calendar).toHaveBeenCalled();
    await expect.poll(() => m.api.syncCalendars.mock.calls.length).toBe(1);
  });

  it('ссылки и группы из «Сегодня» подтягиваются в фоне: экраны групп, история привычек, «Потом»', async () => {
    await boot({ first: today({ groups: [family()], todos_later: 2 }) });
    await expect.element(heading('Сегодня')).toBeVisible();
    await expect.poll(() => m.api.laterTodos.mock.calls.length).toBe(1);
    expect(m.api.group).toHaveBeenCalledWith(10);
    expect(m.api.history).toHaveBeenCalledWith(1);
    expect(caches.groupList).toEqual([family()]);
  });

  it('«Потом» пуст — список «Потом» сразу пустой, без запроса', async () => {
    await boot();
    await expect.element(heading('Сегодня')).toBeVisible();
    expect(caches.later).toEqual([]);
    expect(m.api.laterTodos).not.toHaveBeenCalled();
  });

  it('после входа календари телефона синхронизируются в фоне, и «Сегодня» тихо перечитывается', async () => {
    m.api.today.mockResolvedValueOnce(today()).mockResolvedValue(today({ tasks: [task({ title: 'Из календаря' })] }));
    m.api.session.mockResolvedValue({ user: user(), start_param: null, is_new: false });
    await render(<App />);
    await expect.element(page.getByRole('heading', { name: 'Из календаря' })).toBeVisible();
    expect(m.api.calendars.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('синхронизация вернулась после отметки — ответ устарел и не затирает её', async () => {
    let fresh!: (v: TodayResponse) => void;
    let synced!: () => void;
    m.api.syncCalendars.mockReturnValue(new Promise((r) => (synced = () => r({ ok: true }))));
    // Первый ответ — для запуска, второй (после синхронизации) придёт, когда скажем.
    m.api.today.mockResolvedValueOnce(today()).mockReturnValueOnce(new Promise((r) => (fresh = r)));
    await boot();
    await expect.element(heading('Сегодня')).toBeVisible();
    await page.getByRole('button', { name: 'Бег — сделано' }).click();
    synced();
    await expect.poll(() => m.api.today.mock.calls.length).toBe(2);
    fresh(today({ tasks: [task({ title: 'Старый ответ' })] }));
    await expect.element(page.getByRole('button', { name: 'Бег — сделано' })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByText('Старый ответ')).not.toBeInTheDocument();
  });

  it('синхронизация не прошла — «Сегодня» не перечитывается', async () => {
    m.api.syncCalendars.mockRejectedValue(new Error('сеть'));
    await boot();
    await expect.element(heading('Сегодня')).toBeVisible();
    await expect.poll(() => m.api.syncCalendars.mock.calls.length).toBe(1);
    expect(m.api.today).toHaveBeenCalledTimes(1);
  });

  it('после синхронизации «Сегодня» не пришло — остаётся прежнее', async () => {
    m.api.today.mockResolvedValueOnce(today()).mockRejectedValueOnce(new Error('сеть'));
    await boot();
    await expect.element(page.getByRole('heading', { name: 'Бег' })).toBeVisible();
    await expect.poll(() => m.api.today.mock.calls.length).toBe(2);
    await expect.element(page.getByRole('heading', { name: 'Бег' })).toBeVisible();
  });

  it('пока шла загрузка, привычки уже поменялись — её ответ не затирает экран', async () => {
    let answer!: (v: TodayResponse) => void;
    m.api.today.mockReturnValueOnce(new Promise((r) => (answer = r)));
    await render(<App />);
    await expect.poll(() => m.api.today.mock.calls.length).toBe(1);
    bumpChange();
    answer(today({ tasks: [task({ title: 'Устаревшее' })] }));
    await expect.element(heading('Сегодня')).toBeVisible();
    await expect.element(page.getByText('Устаревшее')).not.toBeInTheDocument();
  });

  it('часовой пояс не распознан — день заранее не грузится', async () => {
    await boot({ me: user({ timezone: 'Нигде/Никогда' }) });
    await expect.element(heading('Сегодня')).toBeVisible();
    await expect.poll(() => m.api.syncCalendars.mock.calls.length).toBe(1);
    expect(m.api.calendar).not.toHaveBeenCalled();
  });

  it('не загрузилось — сообщение на языке телефона и «Ещё раз»', async () => {
    m.api.session.mockRejectedValueOnce(new Error('сеть'));
    await render(<App />);
    const t = navigator.language.startsWith('ru') ? dictionaries.ru : dictionaries.en;
    await expect.element(page.getByText(t.loadError)).toBeVisible();
    await page.getByRole('button', { name: t.retry }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
    expect(m.api.session).toHaveBeenCalledTimes(2);
  });

  it('ошибка загрузки на русском телефоне — по-русски, на другом — по-английски', async () => {
    const lang = vi.spyOn(Navigator.prototype, 'language', 'get').mockReturnValue('ru-RU');
    m.api.session.mockRejectedValue(new Error('сеть'));
    const view = await render(<App />);
    await expect.element(page.getByText(dictionaries.ru.loadError)).toBeVisible();
    await view.unmount();
    lang.mockReturnValue('de-DE');
    await render(<App />);
    await expect.element(page.getByText(dictionaries.en.loadError)).toBeVisible();
    await expect.element(page.getByRole('button', { name: dictionaries.en.retry })).toBeVisible();
  });

  it('заранее подтянуть не вышло (календари, день, приглашение) — запуск всё равно проходит', async () => {
    m.api.calendars.mockRejectedValue(new Error('сеть'));
    m.api.calendar.mockRejectedValue(new Error('сеть'));
    m.api.invitation.mockRejectedValue(new Error('сеть'));
    await boot({ start_param: 'g_abc123' });
    await expect.element(page.getByText('Приглашение не найдено.')).toBeVisible();
    await page.getByRole('button', { name: 'Не сейчас' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
  });

  it('startapp=f_<код> (чужая ссылка «Позвать друга») — экран «зовёт в друзья»; «Не сейчас» — на «Сегодня»', async () => {
    await boot({ start_param: 'f_abc' });
    await expect.element(heading('Даша Л зовёт в друзья')).toBeVisible();
    expect(m.api.friendLink).toHaveBeenCalledWith('abc');
    await page.getByRole('button', { name: 'Не сейчас' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
  });

  it('ссылка друга: «Хочу дружить» → «Открыть» ведёт во «Вместе» сразу к друзьям', async () => {
    localStorage.removeItem('lc-together');
    m.api.requestFriend.mockResolvedValue({ status: 'sent' });
    await boot({ start_param: 'f_abc' });
    await page.getByRole('button', { name: 'Хочу дружить' }).click();
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect.element(page.getByRole('radio', { name: 'Друзья' })).toHaveAttribute('aria-checked', 'true');
    await expect.element(tab('Вместе')).toHaveAttribute('aria-current', 'page');
  });

  it('«Что показать друзьям?»: выбрали — «Сегодня» перечитывается (видимость привычек поменялась)', async () => {
    localStorage.setItem('lc-together', 'friends');
    m.api.friends.mockResolvedValue({ friends: [{ id: 2, first_name: 'Маша', username: 'masha', photo_url: null, since: null, done: 0, due: 0, days: Array(14).fill(0) }], incoming: [], outgoing: [], link: 'https://t.me/x?startapp=f_a', prompt: true });
    m.api.setShown.mockResolvedValue({ ok: true });
    await boot();
    await tab('Вместе').click();
    const calls = m.api.today.mock.calls.length;
    await page.getByRole('button', { name: 'Готово' }).click();
    await expect.poll(() => m.api.today.mock.calls.length).toBeGreaterThan(calls);
    localStorage.removeItem('lc-together');
  });

  it('«Вместе» → «Друзья»: друг открывается и «назад» возвращает к списку; заявки — отдельным экраном', async () => {
    localStorage.removeItem('lc-together');
    await boot();
    await tab('Вместе').click();
    await page.getByRole('radio', { name: 'Друзья' }).click();
    expect(localStorage.getItem('lc-together')).toBe('friends');
    await page.getByRole('button', { name: /Маша/ }).click();
    await expect.element(heading('Маша')).toBeVisible();
    await expect.element(tab('Вместе')).toHaveAttribute('aria-current', 'page');
    m.back.current!();
    await page.getByRole('button', { name: /Заявки · 1/ }).click();
    await expect.element(heading('Заявки')).toBeVisible();
    m.back.current!();
    await expect.element(page.getByRole('radio', { name: 'Друзья' })).toHaveAttribute('aria-checked', 'true');
    localStorage.removeItem('lc-together');
  });

  it('язык из настроек: английский', async () => {
    await boot({ me: user({ language_code: 'en' }) });
    await expect.element(heading('Today')).toBeVisible();
    await expect.element(tab('Together')).toBeVisible();
  });
});

describe('онбординг', () => {
  it('пусто — «Чего я хочу?»; «Пропустить» запоминается на устройстве', async () => {
    await boot({ first: EMPTY });
    await expect.element(heading('Чего я хочу?')).toBeVisible();
    await expect.element(page.getByRole('navigation')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Пропустить' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
    expect(localStorage.getItem('lc-onboarding-skipped')).toBe('1');
  });

  it('уже пропускали — сразу «Сегодня»', async () => {
    localStorage.setItem('lc-onboarding-skipped', '1');
    await boot({ first: EMPTY });
    await expect.element(page.getByText('На сегодня всё')).toBeVisible();
  });

  it('хранилище недоступно — онбординг показывается, «Пропустить» всё равно работает', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('нет хранилища');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('нет хранилища');
    });
    await boot({ first: EMPTY });
    await page.getByRole('button', { name: 'Пропустить' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
  });

  it('первая привычка: «назад» без сохранения — снова онбординг; сохранили — «Сегодня»', async () => {
    await boot({ first: EMPTY });
    await page.getByRole('button', { name: /Делать регулярно/ }).click();
    await expect.element(heading('Новая привычка')).toBeVisible();
    m.back.current!();
    await expect.element(heading('Чего я хочу?')).toBeVisible();
    await page.getByRole('button', { name: /Делать регулярно/ }).click();
    await page.getByRole('textbox', { name: 'Новая привычка' }).fill('Бег');
    m.api.today.mockResolvedValue(today());
    m.main.press!();
    await expect.element(heading('Сегодня')).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Бег' })).toBeVisible();
    expect(m.api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Бег', kind: 'check' }));
  });
});

describe('вкладки', () => {
  it('нижняя панель переключает экраны и отмечает текущий', async () => {
    await boot();
    await expect.element(tab('Сегодня')).toHaveAttribute('aria-current', 'page');
    await tab('Календарь').click();
    await expect.element(heading('Календарь')).toBeVisible();
    await expect.element(tab('Календарь')).toHaveAttribute('aria-current', 'page');
    await expect.element(tab('Сегодня')).not.toHaveAttribute('aria-current');
    await tab('Вместе').click();
    await expect.element(heading('Вместе')).toBeVisible();
    await tab('Я').click();
    await expect.element(heading('Даша')).toBeVisible();
    await tab('Сегодня').click();
    await expect.element(heading('Сегодня')).toBeVisible();
  });

  it('«Я»: карта с сегодняшним днём, посчитанным на экране; смена языка — сразу по-английски', async () => {
    m.api.heatmap.mockResolvedValue({ today: TODAY, days: [{ day: '2026-10-01', score: 1 }, { day: TODAY, score: 0 }] });
    await boot({
      first: today({
        tasks: [task({ value: 1, logged: true })],
        todos: [
          { id: 5, title: 'Купить молоко', day: TODAY, done: true, time: null, duration_min: null, recurring: false, source: null, details: null },
          { id: 6, title: 'Созвон', day: TODAY, done: true, time: null, duration_min: null, recurring: false, source: 'google', details: null },
        ],
      }),
    });
    await tab('Я').click();
    await expect.element(page.getByText('2 активных дня')).toBeVisible();
    await page.getByRole('button', { name: /Язык/ }).click();
    await page.getByRole('option', { name: 'English' }).click();
    await expect.element(tab('Me')).toBeVisible();
    expect(m.api.settings).toHaveBeenCalledWith({ language_code: 'en' });
  });

  it('тема: по умолчанию как в Telegram (светлая), выбранная запоминается на устройстве', async () => {
    await boot();
    await expect.poll(() => document.documentElement.dataset.colorScheme).toBe('light');
    await tab('Я').click();
    await page.getByRole('radio', { name: 'Тёмная' }).click();
    await expect.poll(() => document.documentElement.dataset.colorScheme).toBe('dark');
    expect(localStorage.getItem('lc-theme')).toBe('dark');
  });

  it('сохранённая тёмная тема — с первого кадра; хранилище сломалось — тема всё равно меняется', async () => {
    localStorage.setItem('lc-theme', 'dark');
    await boot();
    await expect.poll(() => document.documentElement.dataset.colorScheme).toBe('dark');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('нет хранилища');
    });
    await tab('Я').click();
    await page.getByRole('radio', { name: 'Светлая' }).click();
    await expect.poll(() => document.documentElement.dataset.colorScheme).toBe('light');
  });

  it('хранилище не читается — тема как в Telegram', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('нет хранилища');
    });
    await boot();
    await expect.poll(() => document.documentElement.dataset.colorScheme).toBe('light');
  });
});

describe('ссылки запуска', () => {
  it('startapp=calendars (вернулись из входа Google) — «Календарь» с открытой шторкой календарей', async () => {
    await boot({ start_param: 'calendars' });
    await expect.element(heading('Календарь')).toBeVisible();
    await expect.element(page.getByRole('dialog', { name: 'Календари' })).toBeVisible();
  });

  it('startapp=g_<код> — приглашение подтянуто заранее; вступили — экран группы во вкладке «Вместе»', async () => {
    await boot({ start_param: 'g_abc123' });
    await expect.element(page.getByText('Мама зовёт тебя в группу')).toBeVisible();
    expect(m.api.invitation).toHaveBeenCalledWith('abc123');
    const todayCalls = m.api.today.mock.calls.length;
    await page.getByRole('button', { name: 'Вступить' }).click();
    await expect.element(page.getByRole('button', { name: 'Настройки группы' })).toBeVisible();
    expect(m.api.join).toHaveBeenCalledWith('abc123');
    await expect.poll(() => m.api.today.mock.calls.length).toBeGreaterThan(todayCalls);
    await expect.element(tab('Вместе')).toHaveAttribute('aria-current', 'page');
    m.back.current!();
    await expect.element(heading('Вместе')).toBeVisible();
  });

  it('приглашение на первом запуске: вступили — онбординг больше не показывается', async () => {
    await boot({ start_param: 'g_abc123', first: EMPTY });
    await page.getByRole('button', { name: 'Вступить' }).click();
    await expect.element(page.getByRole('button', { name: 'Настройки группы' })).toBeVisible();
    m.back.current!();
    await expect.element(heading('Вместе')).toBeVisible();
  });

  it('«Не сейчас» — на «Сегодня»', async () => {
    await boot({ start_param: 'g_abc123' });
    await page.getByRole('button', { name: 'Не сейчас' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
  });

  it('из бота кнопкой — приглашение в адресе (?join=<код>), кривой код не считается', async () => {
    window.history.replaceState(null, '', `${window.location.pathname}?join=abc123`);
    await boot();
    await expect.element(page.getByRole('button', { name: 'Вступить' })).toBeVisible();
    expect(m.api.invitation).toHaveBeenCalledWith('abc123');
  });

  it('?join= с чужим кодом — обычный запуск', async () => {
    window.history.replaceState(null, '', `${window.location.pathname}?join=AB!`);
    await boot();
    await expect.element(heading('Сегодня')).toBeVisible();
    expect(m.api.invitation).not.toHaveBeenCalled();
  });

  it('startapp=grp_<id> — экран группы подтянут заранее и открыт во вкладке «Вместе»', async () => {
    await boot({ start_param: 'grp_10' });
    await expect.element(page.getByRole('button', { name: 'Настройки группы' })).toBeVisible();
    expect(m.api.group).toHaveBeenCalledWith(10);
    await expect.element(tab('Вместе')).toHaveAttribute('aria-current', 'page');
  });
});

describe('переходы', () => {
  it('«Добавить привычку» → выбор вида; «назад» — на «Сегодня»; из редактора «назад» — к выбору', async () => {
    await boot();
    await page.getByRole('button', { name: 'Добавить привычку' }).click();
    await expect.element(heading('Чего я хочу?')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Пропустить' })).not.toBeInTheDocument();
    m.back.current!();
    await expect.element(heading('Сегодня')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить привычку' }).click();
    await page.getByRole('button', { name: /Считать что-то/ }).click();
    await expect.element(heading('Новая привычка')).toBeVisible();
    m.back.current!();
    await expect.element(heading('Чего я хочу?')).toBeVisible();
  });

  it('привычка: экран → правка → «назад» к экрану; сохранили — снова экран; «назад» — «Сегодня»', async () => {
    await boot();
    await page.getByRole('button', { name: 'Бег', exact: true }).click();
    await expect.element(heading('Бег')).toBeVisible();
    await page.getByRole('button', { name: 'Привычка' }).click();
    await expect.element(heading('Привычка')).toBeVisible();
    m.back.current!();
    await expect.element(heading('Бег')).toBeVisible();
    await page.getByRole('button', { name: 'Привычка' }).click();
    expect(m.main.text).toBe('Сохранить');
    m.main.press!();
    await expect.element(heading('Бег')).toBeVisible();
    expect(m.api.updateTask).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Бег' }));
    m.back.current!();
    await expect.element(heading('Сегодня')).toBeVisible();
  });

  it('«Отложить» из правки — привычки на «Сегодня» больше нет, есть ссылка на отложенные', async () => {
    await boot();
    await page.getByRole('button', { name: 'Бег', exact: true }).click();
    await page.getByRole('button', { name: 'Привычка' }).click();
    m.api.today.mockResolvedValue(today({ tasks: [], archived: [{ id: 1, title: 'Бег', emoji: null }] }));
    await page.getByRole('button', { name: 'Отложить' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Отложенные · 1' })).toBeVisible();
  });

  it('удалить привычку — «Сегодня» и карта перечитываются', async () => {
    await boot();
    await page.getByRole('button', { name: 'Бег', exact: true }).click();
    await page.getByRole('button', { name: 'Привычка' }).click();
    m.api.today.mockResolvedValue(today({ tasks: [] }));
    await page.getByRole('button', { name: 'Удалить' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
    await expect.poll(() => m.api.heatmap.mock.calls.length).toBe(2);
    expect(m.api.deleteTask).toHaveBeenCalledWith(1);
  });

  it('свайп по привычке на «Сегодня» — удаление уходит, карта перечитывается', async () => {
    await boot();
    const body = page.getByRole('heading', { name: 'Бег' }).element().closest('.swipe')!.querySelector('.swipe-body')!;
    const r = body.getBoundingClientRect();
    const at = (x: number) => ({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: r.top + r.height / 2, bubbles: true });
    body.dispatchEvent(new PointerEvent('pointerdown', at(r.right - 10)));
    body.dispatchEvent(new PointerEvent('pointermove', at(r.right - 40)));
    body.dispatchEvent(new PointerEvent('pointermove', at(r.left - 20)));
    body.dispatchEvent(new PointerEvent('pointerup', at(r.left - 20)));
    await expect.element(page.getByText('«Бег» удалено')).toBeVisible();
    m.api.heatmap.mockRejectedValue(new Error('сеть'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as { visibilityState?: unknown }).visibilityState;
    await expect.poll(() => m.api.heatmap.mock.calls.length).toBe(2);
    expect(m.api.deleteTask).toHaveBeenCalledWith(1);
  });

  it('отложенные: вернуть последнюю — экран закрывается на «Сегодня»; «Сегодня» не перечиталось — остаётся', async () => {
    await boot({ first: today({ archived: [{ id: 7, title: 'Йога', emoji: null }] }) });
    await page.getByRole('button', { name: 'Отложенные · 1' }).click();
    await expect.element(heading('Отложенные')).toBeVisible();
    m.api.today.mockRejectedValue(new Error('сеть'));
    await page.getByRole('button', { name: 'Вернуть' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
    expect(m.api.restoreTask).toHaveBeenCalledWith(7);
  });

  it('группа с «Сегодня»: открыть, отметить (перечитать «Сегодня»), «назад» — на «Сегодня»', async () => {
    m.api.group.mockResolvedValue(family());
    await boot({ first: today({ groups: [family()] }) });
    await page.getByRole('button', { name: /^Семья/ }).click();
    await expect.element(page.getByRole('button', { name: 'Настройки группы' })).toBeVisible();
    await expect.element(tab('Сегодня')).toHaveAttribute('aria-current', 'page');
    const calls = m.api.today.mock.calls.length;
    await page.getByRole('button', { name: 'Сделано: Вынести мусор' }).click();
    await expect.poll(() => m.api.today.mock.calls.length).toBeGreaterThan(calls);
    m.back.current!();
    await expect.element(heading('Сегодня')).toBeVisible();
  });

  it('группа из «Календаря»: отметка перечитывает «Сегодня», «назад» — в «Календарь»', async () => {
    m.api.calendar.mockImplementation(async () => ({ today: TODAY, todos: [], groups: [{ day: TODAY, group: { id: 10, title: 'Семья', kind: 'family', members }, items: [groupItem()] }] }));
    await boot();
    await tab('Календарь').click();
    const calls = m.api.today.mock.calls.length;
    await page.getByRole('button', { name: 'Сделано: Вынести мусор' }).click();
    await expect.poll(() => m.api.today.mock.calls.length).toBeGreaterThan(calls);
    await page.getByRole('button', { name: /^Семья/ }).click();
    await expect.element(page.getByRole('button', { name: 'Настройки группы' })).toBeVisible();
    await expect.element(tab('Календарь')).toHaveAttribute('aria-current', 'page');
    m.back.current!();
    await expect.element(heading('Календарь')).toBeVisible();
  });

  it('группа из «Вместе» — «назад» во «Вместе»', async () => {
    m.api.groups.mockResolvedValue([family()]);
    await boot();
    await tab('Вместе').click();
    await page.getByRole('button', { name: /Семья/ }).click();
    await expect.element(page.getByRole('button', { name: 'Настройки группы' })).toBeVisible();
    await expect.element(tab('Вместе')).toHaveAttribute('aria-current', 'page');
  });
});

describe('голос', () => {
  const habit: TaskInput = { title: 'Читать', kind: 'count', target: 20, unit: 'страниц' };
  const preview: VoicePreview = { text: 'читать двадцать страниц', habits: [habit], todos: [], groupItems: [] };

  it('микрофон открывает шторку; места без лимита — «без лимита»; закрыть', async () => {
    await boot();
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    const sheet = page.getByRole('dialog', { name: 'Голос' });
    await expect.element(sheet.getByText('место: без лимита; группа: нет; привычки: —')).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть голос' }).click();
    await expect.element(sheet).not.toBeInTheDocument();
  });

  it('с лимитом — сколько привычек ещё помещается (не меньше нуля)', async () => {
    await boot({ first: today({ limits: { max_tasks: 5, active: 3 } }) });
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await expect.element(page.getByText(/место: 2;/)).toBeVisible();
  });

  it('лимит превышен — места ноль', async () => {
    await boot({ first: today({ limits: { max_tasks: 5, active: 7 } }) });
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await expect.element(page.getByText(/место: 0;/)).toBeVisible();
  });

  it('«Добавить»: дела и привычки — одним разом, шторка закрывается, на «Сегодня»', async () => {
    m.voice.todos = [{ title: 'Купить молоко' }];
    m.voice.habits = [habit];
    await boot();
    await tab('Календарь').click();
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await page.getByRole('button', { name: 'Добавить всё' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
    await expect.element(page.getByRole('dialog', { name: 'Голос' })).not.toBeInTheDocument();
    expect(m.api.createTodos).toHaveBeenCalledWith([{ title: 'Купить молоко' }]);
    expect(m.api.createTasks).toHaveBeenCalledWith([habit]);
  });

  it('всё ушло в одну группу — туда и ведём', async () => {
    m.voice.groupItems = [{ type: 'create_group_item', group: { id: 10, title: 'Семья' }, item: draft, names: [] }];
    await boot();
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await page.getByRole('button', { name: 'Добавить всё' }).click();
    await expect.element(page.getByRole('button', { name: 'Настройки группы' })).toBeVisible();
    expect(m.api.createItem).toHaveBeenCalledWith(10, draft);
    expect(m.api.createTodos).not.toHaveBeenCalled();
    expect(m.api.createTasks).not.toHaveBeenCalled();
  });

  it('в группу не догрузилось — всё равно ведём в группу', async () => {
    m.voice.groupItems = [{ type: 'create_group_item', group: { id: 10, title: 'Семья' }, item: draft, names: [] }];
    caches.groups.set(10, family());
    await boot();
    m.api.group.mockRejectedValue(new Error('сеть'));
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await page.getByRole('button', { name: 'Добавить всё' }).click();
    await expect.element(page.getByRole('button', { name: 'Настройки группы' })).toBeVisible();
  });

  it('в разные группы — на «Сегодня»', async () => {
    m.voice.groupItems = [
      { type: 'create_group_item', group: { id: 10, title: 'Семья' }, item: draft, names: [] },
      { type: 'create_group_item', group: { id: 11, title: 'Бег' }, item: draft, names: [] },
    ];
    await boot();
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await page.getByRole('button', { name: 'Добавить всё' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Голос' })).not.toBeInTheDocument();
    await expect.element(heading('Сегодня')).toBeVisible();
    expect(m.api.createItem).toHaveBeenCalledTimes(2);
  });

  it('с экрана группы микрофон знает группу', async () => {
    await boot({ start_param: 'grp_10' });
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await expect.element(page.getByText(/группа: 10;/)).toBeVisible();
  });

  it('привычку из разбора правят в редакторе: «Готово» возвращает в шторку с исправленным', async () => {
    m.voice.preview = preview;
    await boot();
    await tab('Вместе').click();
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await page.getByRole('button', { name: 'Разобрать' }).click();
    await expect.element(page.getByText(/привычки: Читать$/)).toBeVisible();
    await page.getByRole('button', { name: 'Править первую' }).click();
    await expect.element(heading('Привычка')).toBeVisible();
    await expect.element(page.getByRole('dialog', { name: 'Голос' })).not.toBeInTheDocument();
    expect(m.main.text).toBe('Готово');
    await page.getByRole('textbox', { name: 'Новая привычка' }).fill('Читать книгу');
    m.main.press!();
    await expect.element(heading('Вместе')).toBeVisible();
    await expect.element(page.getByText(/привычки: Читать книгу$/)).toBeVisible();
    expect(m.api.createTask).not.toHaveBeenCalled();
  });

  it('из редактора черновика «назад» — обратно на вкладку со шторкой', async () => {
    m.voice.preview = preview;
    await boot();
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await page.getByRole('button', { name: 'Разобрать' }).click();
    await page.getByRole('button', { name: 'Править первую' }).click();
    await expect.element(heading('Привычка')).toBeVisible();
    m.back.current!();
    await expect.element(page.getByText(/привычки: Читать$/)).toBeVisible();
  });

  it('черновика уже нет — правка не открывается, остаётся вкладка', async () => {
    await boot();
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await page.getByRole('button', { name: 'Править первую' }).click();
    await expect.element(heading('Сегодня')).toBeVisible();
    await expect.element(page.getByRole('dialog', { name: 'Голос' })).toBeVisible();
  });

  it('«Выбрать вручную» — шторка закрывается, открывается выбор вида', async () => {
    await boot();
    await page.getByRole('button', { name: 'Сказать голосом' }).click();
    await page.getByRole('button', { name: 'Вручную' }).click();
    await expect.element(heading('Чего я хочу?')).toBeVisible();
    await expect.element(page.getByRole('dialog', { name: 'Голос' })).not.toBeInTheDocument();
  });
});
