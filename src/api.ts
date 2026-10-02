import { retrieveRawInitData } from '@tma.js/sdk-react';
import type { GroupDayBlock, GroupKind, GroupMode, GroupToday } from '../shared/groups';
import type { TaskHistory } from '../shared/stats';
import type { HeatDay, TaskInput, Todo, TodoInput, TodayResponse, UserSettings, VoiceAction, VoiceEvent } from '../shared/types';

/** Подключённый календарь. */
export interface CalendarAccount {
  id: number;
  provider: 'apple' | 'google';
  login: string;
  /** setup — Google подключён, но календари ещё не выбраны. */
  status: 'ok' | 'auth_failed' | 'error' | 'setup';
  last_sync_at: string | null;
  /** Куда пишем наши дела. */
  default_url: string | null;
  /** writable — можно ли писать туда наши дела (чужие календари Google — только читать). */
  collections: { url: string; name: string; color: string | null; enabled: boolean; writable: boolean }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const auth = () => `tma ${retrieveRawInitData() ?? ''}`;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: auth(),
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'network');
  return data;
}

export const api = {
  session: (timezone: string) =>
    call<{ user: UserSettings; start_param: string | null; is_new: boolean }>('POST', '/session', { timezone }),
  today: () => call<TodayResponse>('GET', '/today'),
  createTask: (input: TaskInput) => call<{ id: number }>('POST', '/tasks', input),
  createTasks: (tasks: TaskInput[]) => call<{ ids: number[] }>('POST', '/tasks/batch', { tasks }),
  voice,
  createTodo: (input: TodoInput) => call<{ id: number }>('POST', '/todos', input),
  createTodos: (todos: TodoInput[]) => call<{ ids: number[] }>('POST', '/todos/batch', { todos }),
  updateTodo: (id: number, patch: { title?: string; day?: string; time?: string | null; done?: boolean; on?: string; location?: string; hidden?: boolean }) =>
    call<{ ok: true }>('PATCH', `/todos/${id}`, patch),
  calendar: (from: string, to: string) => call<{ today: string; todos: Todo[]; groups: GroupDayBlock[] }>('GET', `/calendar?from=${from}&to=${to}`),
  calendars: () => call<CalendarAccount[]>('GET', '/calendars'),
  connectApple: (login: string, password: string) => call<{ ok: true }>('POST', '/calendars/apple', { login, password }),
  googleUrl: () => call<{ url: string }>('GET', '/calendars/google/url'),
  confirmGoogle: (accountId: number) => call<{ ok: true }>('POST', `/calendars/${accountId}/confirm`),
  toggleCollection: (accountId: number, url: string, enabled: boolean) => call<{ ok: true }>('PATCH', `/calendars/${accountId}/collections`, { url, enabled }),
  setDefaultCalendar: (accountId: number, url: string) => call<{ ok: true }>('PATCH', `/calendars/${accountId}/default`, { url }),
  disconnectCalendar: (provider: 'apple' | 'google') => call<{ ok: true }>('DELETE', `/calendars/${provider}`),
  syncCalendars: () => call<{ ok: boolean }>('POST', '/calendars/sync'),
  deleteTodo: (id: number) => call<{ ok: true }>('DELETE', `/todos/${id}`),
  laterTodos: () => call<Todo[]>('GET', '/todos/later'),
  updateTask: (id: number, patch: Partial<TaskInput>) =>
    call<{ ok: true; goal_effective_from: string | null }>('PATCH', `/tasks/${id}`, patch),
  archiveTask: (id: number) => call<{ ok: true }>('POST', `/tasks/${id}/archive`),
  restoreTask: (id: number) => call<{ ok: true }>('POST', `/tasks/${id}/restore`),
  deleteTask: (id: number) => call<{ ok: true }>('DELETE', `/tasks/${id}`),
  /** day — отметка задним числом (с экрана привычки); нет — за сегодня. */
  log: (task_id: number, value: number | null, status?: 'clean' | 'slip' | null, day?: string) =>
    call<{ ok: true }>('PUT', '/logs', { task_id, value, status, day }),
  history: (id: number) => call<TaskHistory>('GET', `/tasks/${id}/history`),
  heatmap: (days = 365) => call<{ today: string; days: HeatDay[] }>('GET', `/heatmap?days=${days}`),
  settings: (patch: Partial<UserSettings>) => call<UserSettings>('PATCH', '/settings', patch),
  writeAccess: () => call<{ ok: true }>('POST', '/write-access'),
  deleteAccount: () => call<{ ok: true }>('DELETE', '/account'),
  // Группы
  groups: () => call<GroupToday[]>('GET', '/groups'),
  group: (id: number) => call<GroupDetail>('GET', `/groups/${id}`),
  createGroup: (title: string, kind: GroupKind) => call<{ id: number }>('POST', '/groups', { title, kind }),
  updateGroup: (id: number, patch: Partial<GroupSettings & { title: string; kind: GroupKind }>) => call<{ ok: true }>('PATCH', `/groups/${id}`, patch),
  deleteGroup: (id: number) => call<{ ok: true }>('DELETE', `/groups/${id}`),
  leaveGroup: (id: number) => call<{ ok: true }>('POST', `/groups/${id}/leave`),
  invite: (id: number) => call<{ code: string; link: string; expires_at: string }>('POST', `/groups/${id}/invite`),
  invitation: (code: string) => call<Invitation>('GET', `/invites/${code}`),
  join: (code: string) => call<{ id: number }>('POST', `/invites/${code}/join`),
  createItem: (groupId: number, input: GroupItemInput) => call<{ id: number }>('POST', `/groups/${groupId}/items`, input),
  updateItem: (groupId: number, itemId: number, patch: Partial<GroupItemInput>) => call<{ ok: true }>('PATCH', `/groups/${groupId}/items/${itemId}`, patch),
  deleteItem: (groupId: number, itemId: number) => call<{ ok: true }>('DELETE', `/groups/${groupId}/items/${itemId}`),
  /** Повторяющееся дело — убрать только в этот день. */
  skipItem: (groupId: number, itemId: number, day: string) => call<{ ok: true }>('POST', `/groups/${groupId}/items/${itemId}/skip`, { day }),
  markItem: (groupId: number, itemId: number, done: boolean, day?: string) => call<{ ok: true; taken: boolean }>('PUT', `/groups/${groupId}/items/${itemId}/mark`, { done, day }),
  addEntry: (groupId: number, itemId: number, amount: number) => call<{ ok: true }>('POST', `/groups/${groupId}/items/${itemId}/entries`, { amount }),
};

export interface GroupSettings {
  admins_only_edit: boolean;
  rating_enabled: boolean;
  chat_digest: boolean;
  chat_reminders: boolean;
  tg_chat_title: string | null;
}

export type GroupDetail = GroupToday & { settings: GroupSettings; upcoming: GroupDayBlock[] };

export interface Invitation {
  group: { id: number; title: string; kind: GroupKind; color: string | null };
  inviter: string | null;
  members: { id: number; name: string }[];
  member: boolean;
}

export interface GroupItemInput {
  title: string;
  mode: GroupMode;
  day?: string | null;
  time?: string | null;
  rrule?: string | null;
  due_day?: string | null;
  assignees?: number[];
  all_members?: boolean;
  rotate?: boolean;
  target?: number | null;
  goal_until?: string | null;
}

/**
 * Голос → действия. Ответ сервера построчный: сначала расслышанная фраза (onText — показать её,
 * пока модель ещё думает), потом список действий. Ошибки — ApiError с кодом (`voice_limit`, `failed`…).
 */
async function voice(audio: Blob, onText: (text: string) => void, group: number | null = null): Promise<VoiceAction[]> {
  // group — микрофон нажали на экране этой группы.
  const res = await fetch(group ? `/api/voice?group=${group}` : '/api/voice', {
    method: 'POST',
    headers: { Authorization: auth(), 'content-type': audio.type || 'application/octet-stream' },
    body: audio,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error ?? 'network');
  }
  let actions: VoiceAction[] | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as VoiceEvent;
    if ('text' in event) onText(event.text);
    else if ('actions' in event) actions = event.actions;
    else throw new ApiError(500, event.error);
  };
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(take);
      if (done) break;
    }
    take(buffer);
  } else {
    // Старый WebView без потокового чтения ответа: фраза и список придут вместе.
    (await res.text()).split('\n').forEach(take);
  }
  if (actions === null) throw new ApiError(500, 'failed');
  return actions;
}
