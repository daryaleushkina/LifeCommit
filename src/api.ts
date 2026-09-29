import { retrieveRawInitData } from '@tma.js/sdk-react';
import type {
  DayMode,
  HeatDay,
  TaskInput,
  TaskTemplate,
  TodayResponse,
  UserSettings,
} from '../shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `tma ${retrieveRawInitData() ?? ''}`,
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
  templates: () => call<TaskTemplate[]>('GET', '/templates'),
  fromTemplates: (slugs: string[]) => call<{ ids: number[] }>('POST', '/tasks/from-templates', { slugs }),
  createTask: (input: TaskInput) => call<{ id: number }>('POST', '/tasks', input),
  updateTask: (id: number, patch: Partial<TaskInput>) =>
    call<{ ok: true; goal_effective_from: string | null }>('PATCH', `/tasks/${id}`, patch),
  archiveTask: (id: number) => call<{ ok: true }>('DELETE', `/tasks/${id}`),
  log: (task_id: number, value: number | null, status?: 'clean' | 'slip' | null) =>
    call<{ ok: true }>('PUT', '/logs', { task_id, value, status }),
  setDay: (mode: DayMode, days?: number) => call<{ ok: true }>('PUT', '/day', { mode, days }),
  heatmap: (days = 365) => call<{ today: string; days: HeatDay[] }>('GET', `/heatmap?days=${days}`),
  settings: (patch: Partial<UserSettings>) => call<UserSettings>('PATCH', '/settings', patch),
  writeAccess: () => call<{ ok: true }>('POST', '/write-access'),
  donate: (stars: number) => call<{ link: string }>('POST', '/donate', { stars }),
  deleteAccount: () => call<{ ok: true }>('DELETE', '/account'),
};
