// Кэш загруженного: один запрос на ключ, пока первый не вернулся; устаревший ответ календаря переспрашиваем.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '../shared/types';

vi.mock('@tma.js/sdk-react', () => ({ hapticFeedback: { notificationOccurred: { ifAvailable: vi.fn() } } }));
vi.mock('./api', () => ({
  api: {
    calendars: vi.fn(),
    googleUrl: vi.fn(),
    calendar: vi.fn(),
    groups: vi.fn(),
    group: vi.fn(),
    history: vi.fn(),
    invitation: vi.fn(),
    laterTodos: vi.fn(),
  },
}));

import { api } from './api';
import { caches, googleUrlFresh, load, logicalDayOf, trackEdit, warm } from './caches';
import { bumpChange } from './useTaskLog';

const m = vi.mocked(api);

/** Обещание, которое разрешаем сами. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  caches.accounts = null;
  caches.googleUrl = null;
  caches.days.clear();
  caches.groupList = null;
  caches.groups.clear();
  caches.history.clear();
  caches.invitations.clear();
  caches.later = null;
});
afterEach(() => vi.useRealTimers());

describe('один запрос на ключ', () => {
  it('два одновременных вызова — один запрос и один ответ', async () => {
    const d = deferred<never[]>();
    m.calendars.mockReturnValue(d.promise);
    const a = load.accounts();
    const b = load.accounts();
    expect(b).toBe(a);
    expect(m.calendars).toHaveBeenCalledTimes(1);
    d.resolve([]);
    await expect(a).resolves.toEqual([]);
    expect(caches.accounts).toEqual([]);
  });

  it('после ответа следующий вызов идёт заново', async () => {
    m.calendars.mockResolvedValue([]);
    await load.accounts();
    await load.accounts();
    expect(m.calendars).toHaveBeenCalledTimes(2);
  });

  it('после ошибки тоже: ключ освобождается, кэш не трогаем', async () => {
    m.calendars.mockRejectedValueOnce(new Error('сеть')).mockResolvedValueOnce([{ id: 1 }] as never);
    await expect(load.accounts()).rejects.toThrow('сеть');
    expect(caches.accounts).toBeNull();
    await expect(load.accounts()).resolves.toEqual([{ id: 1 }]);
  });

  it('разные ключи не мешают друг другу', async () => {
    m.group.mockImplementation(async (id) => ({ id }) as never);
    const [a, b] = await Promise.all([load.group(1), load.group(2)]);
    expect(a).toEqual({ id: 1 });
    expect(b).toEqual({ id: 2 });
    expect(m.group).toHaveBeenCalledTimes(2);
  });
});

describe('что кладём в кэш', () => {
  it('группы, экран группы, история, приглашение, «Потом»', async () => {
    m.groups.mockResolvedValue([{ id: 1 }] as never);
    m.group.mockResolvedValue({ id: 7 } as never);
    m.history.mockResolvedValue({ days: [] } as never);
    m.invitation.mockResolvedValue({ member: false } as never);
    m.laterTodos.mockResolvedValue([{ id: 3 }] as never);

    await expect(load.groupList()).resolves.toEqual([{ id: 1 }]);
    expect(caches.groupList).toEqual([{ id: 1 }]);
    await load.group(7);
    expect(caches.groups.get(7)).toEqual({ id: 7 });
    await load.history(5);
    expect(m.history).toHaveBeenCalledWith(5);
    expect(caches.history.get(5)).toEqual({ days: [] });
    await load.invitation('abc');
    expect(m.invitation).toHaveBeenCalledWith('abc');
    expect(caches.invitations.get('abc')).toEqual({ member: false });
    await load.later();
    expect(caches.later).toEqual([{ id: 3 }]);
  });
});

describe('ссылка входа Google', () => {
  it('кладётся с отметкой времени и свежа 12 минут', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-03T10:00:00Z') });
    expect(googleUrlFresh()).toBeNull();
    m.googleUrl.mockResolvedValue({ url: 'https://accounts.google.com/x' });
    await expect(load.googleUrl()).resolves.toBe('https://accounts.google.com/x');
    expect(caches.googleUrl).toEqual({ url: 'https://accounts.google.com/x', at: Date.now() });
    vi.advanceTimersByTime(12 * 60_000 - 1);
    expect(googleUrlFresh()).toBe('https://accounts.google.com/x');
    vi.advanceTimersByTime(1);
    expect(googleUrlFresh()).toBeNull();
  });

  it('Google на сервере не настроен (ошибка) — пустая строка, тоже в кэше', async () => {
    m.googleUrl.mockRejectedValue(new Error('503'));
    await expect(load.googleUrl()).resolves.toBe('');
    expect(caches.googleUrl?.url).toBe('');
    expect(googleUrlFresh()).toBe('');
  });
});

describe('дни календаря', () => {
  const res = (title: string, groups?: unknown[]) => ({ today: '2026-10-03', todos: [{ id: 1, title }], groups }) as never;

  it('свежий день обновляет и месяц; свежий месяц обновляет уже открытые дни, в том числе опустевшие', async () => {
    const day = '2026-10-03';
    const todo: Todo = { id: 1, title: 'Хлеб', day, done: false, time: null, duration_min: null, recurring: false, source: null, details: null };
    const other = { ...todo, id: 2, day: '2026-10-04' };
    caches.days.set('2026-10-01:2026-10-31', { todos: [todo, other], groups: [] });
    m.calendar.mockResolvedValueOnce({ today: day, todos: [{ ...todo, done: true }], groups: [] });
    await load.range(day, day);
    expect(caches.days.get('2026-10-01:2026-10-31')?.todos).toEqual([other, { ...todo, done: true }]);
    const outside = { ...todo, id: 3, day: '2026-11-01' };
    caches.days.set('2026-10-03:2026-11-01', { todos: [todo, outside], groups: [] });
    m.calendar.mockResolvedValueOnce({ today: day, todos: [other], groups: [] });
    await load.range('2026-10-01', '2026-10-31');
    expect(caches.days.get(`${day}:${day}`)?.todos).toEqual([]);
    expect(caches.days.get('2026-10-03:2026-11-01')?.todos).toEqual([outside, other]);
  });

  it('кэш по ключу «from:to»; групп нет — пустой список', async () => {
    m.calendar.mockResolvedValue(res('Молоко'));
    await expect(load.range('2026-10-01', '2026-10-07')).resolves.toEqual({ todos: [{ id: 1, title: 'Молоко' }], groups: [] });
    expect(m.calendar).toHaveBeenCalledWith('2026-10-01', '2026-10-07');
    expect(caches.days.get('2026-10-01:2026-10-07')).toEqual({ todos: [{ id: 1, title: 'Молоко' }], groups: [] });
  });

  it('пока шёл запрос, дело поменяли — спрашиваем ещё раз и кладём свежий ответ', async () => {
    m.calendar
      .mockImplementationOnce(async () => {
        bumpChange(); // отметили дело, пока ждали ответа
        return res('старое');
      })
      .mockResolvedValueOnce(res('новое', [{ id: 9 }]));
    const v = await load.range('a', 'b');
    expect(m.calendar).toHaveBeenCalledTimes(2);
    expect(v).toEqual({ todos: [{ id: 1, title: 'новое' }], groups: [{ id: 9 }] });
  });

  // 05.10.2026 (хук перед пушем, под нагрузкой): дело добавили, пока день перечитывался; перечитка спросила ещё раз,
  // пока дело ещё создавалось, получила день без него и легла поверх — дело на сервере, а на экране его нет.
  it('правка ещё у сервера — перечитка дня её дожидается и кладёт ответ уже с ней', async () => {
    const first = deferred<ReturnType<typeof res>>();
    const post = deferred<{ id: number }>();
    let server = res('без нового');
    m.calendar.mockReturnValueOnce(first.promise).mockImplementation(async () => server);
    const reading = load.range('a', 'd');
    void trackEdit(post.promise); // дело ушло на сервер, ответа ещё нет
    first.resolve(res('без нового'));
    await new Promise((r) => setTimeout(r, 0)); // все ответы, что уже пришли, разобраны
    server = res('с новым');
    post.resolve({ id: 9 });
    await reading;
    expect(caches.days.get('a:d')!.todos[0]!.title).toBe('с новым');
  });

  it('меняют без остановки — не больше четырёх попыток, кладём последний ответ', async () => {
    let n = 0;
    m.calendar.mockImplementation(async () => {
      bumpChange();
      return res(`ответ ${++n}`);
    });
    const v = await load.range('a', 'c');
    expect(m.calendar).toHaveBeenCalledTimes(4);
    expect(v.todos[0]!.title).toBe('ответ 4');
  });
});

describe('warm', () => {
  it('ошибку фоновой загрузки глотает', async () => {
    expect(warm(Promise.reject(new Error('нет сети')))).toBeUndefined();
    expect(warm(Promise.resolve(1))).toBeUndefined();
    // Необработанный отказ Vitest поймал бы и уронил прогон; даём ему проявиться в этом тесте.
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('logicalDayOf', () => {
  it('день начинается в day_start_hour по поясу человека', () => {
    vi.useFakeTimers({ now: new Date('2026-10-03T02:00:00Z') }); // в Москве 05:00
    expect(logicalDayOf('Europe/Moscow', 0)).toBe('2026-10-03');
    expect(logicalDayOf('Europe/Moscow', 5)).toBe('2026-10-03');
    expect(logicalDayOf('Europe/Moscow', 6)).toBe('2026-10-02');
    expect(logicalDayOf('America/New_York', 0)).toBe('2026-10-02');
  });

  it('незнакомый пояс — null', () => {
    expect(logicalDayOf('Mars/Olympus', 4)).toBeNull();
  });
});
