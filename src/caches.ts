// Что уже загрузили — пока открыто приложение. Экраны берут отсюда первый кадр сразу, без «догрузки»:
// ничего не прыгает и не показывается сначала неправдой (решение владелицы 02.10.2026 — «выглядит дёшево»).
// Нужное заранее подтягивается при запуске (пока видна заставка) и в фоне сразу после неё.
import type { GroupDayBlock, GroupToday } from '../shared/groups';
import type { TaskHistory } from '../shared/stats';
import type { FriendProfile, FriendsResponse, Todo } from '../shared/types';
import { api, type CalendarAccount, type GroupDetail, type Invitation } from './api';
import { bumpChange, currentChange } from './useTaskLog';

/** Ссылка входа Google живёт 15 минут; берём запас. */
const GOOGLE_URL_TTL = 12 * 60_000;

export const caches = {
  /** Подключённые календари. */
  accounts: null as CalendarAccount[] | null,
  /** Адрес входа Google: '' — Google на сервере не настроен. */
  googleUrl: null as { url: string; at: number } | null,
  /** Дела и групповые дела по промежуткам дней «from:to» (вкладка «Календарь»). */
  days: new Map<string, { todos: Todo[]; groups: GroupDayBlock[] }>(),
  /** Список групп (вкладка «Вместе»). */
  groupList: null as GroupToday[] | null,
  /** Экраны групп. */
  groups: new Map<number, GroupDetail>(),
  /** История привычек (экран привычки). */
  history: new Map<number, TaskHistory>(),
  /** Приглашения по коду. */
  invitations: new Map<string, Invitation>(),
  /** «Потом» — дела на следующие дни. */
  later: null as Todo[] | null,
  /** Друзья, заявки и моя ссылка (вкладка «Вместе» → «Друзья»). */
  friends: null as FriendsResponse | null,
  /** Экраны друзей. */
  friendProfiles: new Map<number, FriendProfile>(),
};

/** Один и тот же запрос не шлём дважды, пока первый не вернулся. */
const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key) as Promise<T> | undefined;
  if (cur) return cur;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const googleUrlFresh = () => (caches.googleUrl && Date.now() - caches.googleUrl.at < GOOGLE_URL_TTL ? caches.googleUrl.url : null);

// Правки, которые ещё идут на сервер: на экране группы (отметка, имя, «только админы») и с делами (useTodos.ts).
const edits = new Set<Promise<unknown>>();
/** Правка, которая ушла на сервер: перечитки группы и дней, начатые раньше или во время неё, её не затрут — дождутся и спросят заново. */
export function trackEdit<T>(edit: Promise<T>): Promise<T> {
  // Обещание у API всегда; Promise.resolve — чтобы и не-обещание (подмена в тестах) не застряло в edits навсегда.
  const p = Promise.resolve(edit);
  bumpChange();
  edits.add(p);
  const done = () => {
    edits.delete(p);
    bumpChange();
  };
  p.then(done, done);
  return p;
}

export const load = {
  accounts: () =>
    once('accounts', async () => {
      caches.accounts = await api.calendars();
      return caches.accounts;
    }),
  googleUrl: () =>
    once('google', async () => {
      const url = await api.googleUrl().then((r) => r.url, () => '');
      caches.googleUrl = { url, at: Date.now() };
      return url;
    }),
  range: (from: string, to: string) =>
    once(`range:${from}:${to}`, async () => {
      // Пока шёл запрос, дело добавили, отметили или удалили — ответ уже устарел и затёр бы правку на экране
      // (02.10.2026: открыла следующий день, сразу добавила дело — оно пропадало). Тогда спрашиваем ещё раз:
      // в кэш попадает только ответ, за время которого ничего не менялось.
      // Правка ещё у сервера — сначала дождаться её (05.10.2026: повторный вопрос ушёл, пока дело создавалось,
      // вернулся без него и лёг поверх — строка пропала насовсем).
      let seq: number;
      let res: Awaited<ReturnType<typeof api.calendar>>;
      let tries = 0;
      do {
        seq = currentChange();
        res = await api.calendar(from, to);
        if (edits.size) await Promise.allSettled([...edits]);
      } while (seq !== currentChange() && ++tries < 4);
      const v = { todos: res.todos, groups: res.groups ?? [] };
      caches.days.set(`${from}:${to}`, v);
      return v;
    }),
  groupList: () =>
    once('groupList', async () => {
      caches.groupList = await api.groups();
      return caches.groupList;
    }),
  group: (id: number) =>
    once(`group:${id}`, async () => {
      // Как у дней: пока шёл запрос, на экране группы что-то поменяли (04.10.2026: перечитка после удаления свайпом
      // выключала только что включённое «только админы») — ответ устарел, спрашиваем ещё раз.
      // Правка ещё у сервера — дождаться её и спросить заново: иначе ответ без неё ляжет поверх неё.
      let seq: number;
      let g: GroupDetail;
      let tries = 0;
      do {
        seq = currentChange();
        g = await api.group(id);
        if (edits.size) await Promise.allSettled([...edits]);
      } while (seq !== currentChange() && ++tries < 4);
      caches.groups.set(id, g);
      return g;
    }),
  history: (id: number) =>
    once(`history:${id}`, async () => {
      const h = await api.history(id);
      caches.history.set(id, h);
      return h;
    }),
  invitation: (code: string) =>
    once(`inv:${code}`, async () => {
      const inv = await api.invitation(code);
      caches.invitations.set(code, inv);
      return inv;
    }),
  later: () =>
    once('later', async () => {
      caches.later = await api.laterTodos();
      return caches.later;
    }),
  friends: () =>
    once('friends', async () => {
      caches.friends = await api.friends();
      return caches.friends;
    }),
  friend: (id: number) =>
    once(`friend:${id}`, async () => {
      const f = await api.friend(id);
      caches.friendProfiles.set(id, f);
      return f;
    }),
};

/** Подтянуть в фоне, не дожидаясь и не шумя ошибками: не вышло — экран загрузит сам. */
export const warm = (p: Promise<unknown>) => void p.catch(() => {});

/** Логический день человека (день начинается в day_start_hour по его поясу) — как его считает сервер. */
export function logicalDayOf(timezone: string, dayStartHour: number): string | null {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - dayStartHour * 3_600_000));
  } catch {
    return null;
  }
}
