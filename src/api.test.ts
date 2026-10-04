// Клиент API: адреса, методы, заголовок Authorization из initData, тела запросов и ошибки → ApiError.
// Голос — построчный ответ (NDJSON), который приходит кусками.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ raw: 'query_id=1&user=%7B%7D&hash=abc' as string | undefined }));
vi.mock('@tma.js/sdk-react', () => ({ retrieveRawInitData: () => sdk.raw }));

import { api, ApiError } from './api';

const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sdk.raw = 'query_id=1&user=%7B%7D&hash=abc';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** Что ушло последним запросом. */
function sent() {
  const [url, init] = fetchMock.mock.lastCall!;
  const headers = init!.headers as Record<string, string>;
  return { url, method: init!.method, headers, body: init!.body === undefined ? undefined : JSON.parse(init!.body as string) };
}

describe('JSON-запросы', () => {
  const task = { title: 'Вода', kind: 'count', target: 8 } as never;
  const todo = { title: 'Молоко', day: '2026-10-03' } as never;
  const item = { title: 'Ужин', mode: 'event' } as never;
  // [что вызвать, метод, путь, тело]
  const cases: [string, () => Promise<unknown>, string, string, unknown][] = [
    ['shareChat', () => api.shareChat('F1', 'подпись'), 'POST', '/share/chat', { file_id: 'F1', caption: 'подпись' }],
    ['session', () => api.session('Europe/Moscow'), 'POST', '/session', { timezone: 'Europe/Moscow' }],
    ['today', () => api.today(), 'GET', '/today', undefined],
    ['createTask', () => api.createTask(task), 'POST', '/tasks', task],
    ['createTasks', () => api.createTasks([task]), 'POST', '/tasks/batch', { tasks: [task] }],
    ['createTodo', () => api.createTodo(todo), 'POST', '/todos', todo],
    ['createTodos', () => api.createTodos([todo]), 'POST', '/todos/batch', { todos: [todo] }],
    ['updateTodo', () => api.updateTodo(4, { done: true, on: '2026-10-03' }), 'PATCH', '/todos/4', { done: true, on: '2026-10-03' }],
    ['calendar', () => api.calendar('2026-10-01', '2026-10-31'), 'GET', '/calendar?from=2026-10-01&to=2026-10-31', undefined],
    ['calendars', () => api.calendars(), 'GET', '/calendars', undefined],
    ['connectApple', () => api.connectApple('a@icloud.com', 'pw'), 'POST', '/calendars/apple', { login: 'a@icloud.com', password: 'pw' }],
    ['googleUrl', () => api.googleUrl(), 'GET', '/calendars/google/url', undefined],
    ['confirmGoogle', () => api.confirmGoogle(3), 'POST', '/calendars/3/confirm', undefined],
    ['toggleCollection', () => api.toggleCollection(3, 'u1', false), 'PATCH', '/calendars/3/collections', { url: 'u1', enabled: false }],
    ['setDefaultCalendar', () => api.setDefaultCalendar(3, 'u1'), 'PATCH', '/calendars/3/default', { url: 'u1' }],
    ['disconnectCalendar', () => api.disconnectCalendar('google'), 'DELETE', '/calendars/google', undefined],
    ['syncCalendars', () => api.syncCalendars(), 'POST', '/calendars/sync', undefined],
    ['deleteTodo', () => api.deleteTodo(5), 'DELETE', '/todos/5', undefined],
    ['laterTodos', () => api.laterTodos(), 'GET', '/todos/later', undefined],
    ['updateTask', () => api.updateTask(1, { title: 'Чай' }), 'PATCH', '/tasks/1', { title: 'Чай' }],
    ['archiveTask', () => api.archiveTask(1), 'POST', '/tasks/1/archive', undefined],
    ['restoreTask', () => api.restoreTask(1), 'POST', '/tasks/1/restore', undefined],
    ['deleteTask', () => api.deleteTask(1), 'DELETE', '/tasks/1', undefined],
    ['log', () => api.log(1, 3, 'clean', '2026-10-01'), 'PUT', '/logs', { task_id: 1, value: 3, status: 'clean', day: '2026-10-01' }],
    ['log за сегодня', () => api.log(1, null), 'PUT', '/logs', { task_id: 1, value: null }],
    ['history', () => api.history(1), 'GET', '/tasks/1/history', undefined],
    ['summary', () => api.summary('2026-10-01', '2026-10-31'), 'GET', '/summary?from=2026-10-01&to=2026-10-31', undefined],
    ['friends', () => api.friends(), 'GET', '/friends', undefined],
    ['friend', () => api.friend(7), 'GET', '/friends/7', undefined],
    ['findPerson', () => api.findPerson('@ma sha'), 'GET', '/friends/find?username=%40ma%20sha', undefined],
    ['friendLink', () => api.friendLink('a/b'), 'GET', '/friends/link/a%2Fb', undefined],
    ['requestFriend', () => api.requestFriend({ code: 'abc' }), 'POST', '/friends/requests', { code: 'abc' }],
    ['acceptFriend', () => api.acceptFriend(7), 'POST', '/friends/requests/7/accept', undefined],
    ['dropRequest', () => api.dropRequest(7), 'DELETE', '/friends/requests/7', undefined],
    ['removeFriend', () => api.removeFriend(7), 'DELETE', '/friends/7', undefined],
    ['block', () => api.block(7), 'POST', '/friends/7/block', undefined],
    ['blocks', () => api.blocks(), 'GET', '/blocks', undefined],
    ['unblock', () => api.unblock(7), 'DELETE', '/blocks/7', undefined],
    ['setShown', () => api.setShown([1, 2]), 'PUT', '/friends/shown', { task_ids: [1, 2] }],
    ['promptSeen', () => api.promptSeen(), 'POST', '/friends/prompted', undefined],
    ['heatmap', () => api.heatmap(), 'GET', '/heatmap?days=365', undefined],
    ['heatmap(30)', () => api.heatmap(30), 'GET', '/heatmap?days=30', undefined],
    ['settings', () => api.settings({ lang: 'en' } as never), 'PATCH', '/settings', { lang: 'en' }],
    ['writeAccess', () => api.writeAccess(), 'POST', '/write-access', undefined],
    ['deleteAccount', () => api.deleteAccount(), 'DELETE', '/account', undefined],
    ['groups', () => api.groups(), 'GET', '/groups', undefined],
    ['group', () => api.group(2), 'GET', '/groups/2', undefined],
    ['createGroup', () => api.createGroup('Семья', 'family'), 'POST', '/groups', { title: 'Семья', kind: 'family' }],
    ['updateGroup', () => api.updateGroup(2, { chat_digest: true }), 'PATCH', '/groups/2', { chat_digest: true }],
    ['deleteGroup', () => api.deleteGroup(2), 'DELETE', '/groups/2', undefined],
    ['leaveGroup', () => api.leaveGroup(2), 'POST', '/groups/2/leave', undefined],
    ['invite', () => api.invite(2), 'POST', '/groups/2/invite', undefined],
    ['checkGroupChat', () => api.checkGroupChat(2), 'POST', '/groups/2/chat/check', undefined],
    ['disconnectGroupChat', () => api.disconnectGroupChat(2), 'DELETE', '/groups/2/chat', undefined],
    ['invitation', () => api.invitation('abc'), 'GET', '/invites/abc', undefined],
    ['join', () => api.join('abc'), 'POST', '/invites/abc/join', undefined],
    ['createItem', () => api.createItem(2, item), 'POST', '/groups/2/items', item],
    ['updateItem', () => api.updateItem(2, 7, { title: 'Обед' }), 'PATCH', '/groups/2/items/7', { title: 'Обед' }],
    ['deleteItem', () => api.deleteItem(2, 7), 'DELETE', '/groups/2/items/7', undefined],
    ['skipItem', () => api.skipItem(2, 7, '2026-10-03'), 'POST', '/groups/2/items/7/skip', { day: '2026-10-03' }],
    ['markItem', () => api.markItem(2, 7, true, '2026-10-02'), 'PUT', '/groups/2/items/7/mark', { done: true, day: '2026-10-02' }],
    ['markItem за сегодня', () => api.markItem(2, 7, false), 'PUT', '/groups/2/items/7/mark', { done: false }],
    ['addEntry', () => api.addEntry(2, 7, 500), 'POST', '/groups/2/items/7/entries', { amount: 500 }],
  ];

  it.each(cases)('%s', async (_name, run, method, path, body) => {
    await expect(run()).resolves.toEqual({ ok: true });
    const s = sent();
    expect(s.url).toBe(`/api${path}`);
    expect(s.method).toBe(method);
    expect(s.headers.Authorization).toBe(`tma ${sdk.raw}`);
    expect(s.body).toEqual(body);
    // content-type — только когда есть тело.
    expect(s.headers['content-type']).toBe(body === undefined ? undefined : 'application/json');
  });

  it('вне Telegram initData нет — «tma » без данных', async () => {
    sdk.raw = undefined;
    await api.today();
    expect(sent().headers.Authorization).toBe('tma ');
  });

  it('ответ сервера отдаётся как есть', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 42 }));
    await expect(api.createTodo({ title: 'x', day: '2026-10-03' } as never)).resolves.toEqual({ id: 42 });
  });

  it('успешный ответ без JSON — пустой объект', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.syncCalendars()).resolves.toEqual({});
  });
});

describe('ошибки', () => {
  it('код ошибки сервера → ApiError(status, code)', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'limit_reached' }, 402));
    const e = await api.createTask({} as never).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 402, code: 'limit_reached', message: 'limit_reached' });
  });

  it('ошибка без JSON (502 от прокси) → code network', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.today()).rejects.toMatchObject({ status: 502, code: 'network' });
  });

  it('JSON без поля error → code network', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(api.today()).rejects.toMatchObject({ status: 500, code: 'network' });
  });

  it('200, но тело не JSON или оборвалось — ошибка network, а не пустой ответ', async () => {
    // Так бывает, когда страницу перезагрузили (или связь пропала) посреди ответа: раньше приходил {},
    // и «Сегодня» падал на data.tasks.filter (нашёл сквозной тест на iPhone, 03.10.2026).
    fetchMock.mockResolvedValueOnce(new Response('{"day":"2026-10-03","tas', { status: 200 }));
    await expect(api.today()).rejects.toMatchObject({ status: 200, code: 'network' });
    const broken = new Response(new ReadableStream({ start: (c) => c.error(new TypeError('Load failed')) }), { status: 200 });
    fetchMock.mockResolvedValueOnce(broken);
    await expect(api.today()).rejects.toMatchObject({ status: 200, code: 'network' });
  });

  it('сеть упала — ошибка fetch уходит наверх как есть', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.today()).rejects.toThrow('Failed to fetch');
  });
});

describe('share — картинка через бота', () => {
  it('шлёт сам Blob с его типом и Authorization', async () => {
    fetchMock.mockResolvedValueOnce(json({ url: 'https://x/y.jpg', file_id: 'F' }));
    const blob = new Blob(['jpg'], { type: 'image/png' });
    await expect(api.share(blob)).resolves.toEqual({ url: 'https://x/y.jpg', file_id: 'F' });
    const [url, init] = fetchMock.mock.lastCall!;
    expect(url).toBe('/api/share');
    expect(init!.method).toBe('POST');
    expect(init!.body).toBe(blob);
    expect(init!.headers).toEqual({ Authorization: `tma ${sdk.raw}`, 'content-type': 'image/png' });
  });

  it('у Blob нет типа — image/jpeg', async () => {
    fetchMock.mockResolvedValueOnce(json({ url: 'u', file_id: 'f' }));
    await api.share(new Blob(['x']));
    expect((fetchMock.mock.lastCall![1]!.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
  });

  it('403 → ApiError с кодом; без JSON — network', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'bot_blocked' }, 403));
    await expect(api.share(new Blob(['x']))).rejects.toMatchObject({ status: 403, code: 'bot_blocked' });
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(api.share(new Blob(['x']))).rejects.toMatchObject({ status: 500, code: 'network' });
  });

  it('успех без JSON — ошибка network: без ссылки делиться нечем', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(api.share(new Blob(['x']))).rejects.toMatchObject({ status: 200, code: 'network' });
  });
});

describe('жалоба — форма и голос', () => {
  it('текст, контекст и скриншоты — одной формой multipart с Authorization', async () => {
    const shot = new Blob(['jpg'], { type: 'image/jpeg' });
    await expect(api.feedback('Белый экран', { screen: 'me' }, [shot, shot])).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.lastCall!;
    expect(url).toBe('/api/feedback');
    expect(init!.method).toBe('POST');
    expect(init!.headers).toEqual({ Authorization: `tma ${sdk.raw}` });
    const form = init!.body as FormData;
    expect(form.get('text')).toBe('Белый экран');
    expect(JSON.parse(form.get('context') as string)).toEqual({ screen: 'me' });
    expect(form.getAll('files').map((f) => (f as File).name)).toEqual(['shot-1.jpg', 'shot-2.jpg']);
  });

  it('лимит — ApiError с кодом', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'feedback_limit' }, 429));
    await expect(api.feedback('a', {}, [])).rejects.toMatchObject({ status: 429, code: 'feedback_limit' });
  });

  it('голос — сам Blob с его типом (нет — audio/webm), в ответ текст', async () => {
    fetchMock.mockImplementation(async () => json({ text: 'кнопка не жмётся' }));
    const audio = new Blob(['ogg'], { type: 'audio/mp4' });
    await expect(api.feedbackVoice(audio)).resolves.toBe('кнопка не жмётся');
    const [url, init] = fetchMock.mock.lastCall!;
    expect(url).toBe('/api/feedback/voice');
    expect(init!.body).toBe(audio);
    expect(init!.headers).toEqual({ Authorization: `tma ${sdk.raw}`, 'content-type': 'audio/mp4' });
    await api.feedbackVoice(new Blob(['x']));
    expect((fetchMock.mock.lastCall![1]!.headers as Record<string, string>)['content-type']).toBe('audio/webm');
  });
});

describe('voice — построчный ответ', () => {
  const actions = [{ type: 'create_todo', todo: { title: 'Купить молоко', day: '2026-10-04' } }];

  /** Ответ, который приходит кусками байтов: так режется и посреди строки, и посреди русской буквы. */
  function streamed(text: string, cuts: number[], status = 200) {
    const bytes = new TextEncoder().encode(text);
    const edges = [0, ...cuts, bytes.length];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < edges.length - 1; i++) c.enqueue(bytes.slice(edges[i], edges[i + 1]));
        c.close();
      },
    });
    return new Response(body, { status });
  }

  it('сначала фраза (onText), потом действия; куски режут строки и буквы', async () => {
    const text = `${JSON.stringify({ text: 'завтра купить молоко' })}\n\n${JSON.stringify({ actions })}\n`;
    const bytes = new TextEncoder().encode(text).length;
    // Режем на каждом байте — заведомо и посреди строки, и посреди двухбайтовой буквы.
    fetchMock.mockResolvedValueOnce(streamed(text, Array.from({ length: bytes - 1 }, (_, i) => i + 1)));
    const onText = vi.fn();
    const audio = new Blob(['a'], { type: 'audio/webm' });
    await expect(api.voice(audio, onText)).resolves.toEqual(actions);
    expect(onText).toHaveBeenCalledExactlyOnceWith('завтра купить молоко');
    const [url, init] = fetchMock.mock.lastCall!;
    expect(url).toBe('/api/voice');
    expect(init).toMatchObject({ method: 'POST', body: audio, headers: { Authorization: `tma ${sdk.raw}`, 'content-type': 'audio/webm' } });
  });

  it('последняя строка без перевода строки тоже читается', async () => {
    fetchMock.mockResolvedValueOnce(streamed(`${JSON.stringify({ text: 'a' })}\n${JSON.stringify({ actions })}`, [5]));
    await expect(api.voice(new Blob(['a']), () => {})).resolves.toEqual(actions);
  });

  it('микрофон в группе — ?group=, без типа — octet-stream', async () => {
    fetchMock.mockResolvedValueOnce(streamed(`${JSON.stringify({ actions: [] })}\n`, []));
    await expect(api.voice(new Blob(['a']), () => {}, 9)).resolves.toEqual([]);
    const [url, init] = fetchMock.mock.lastCall!;
    expect(url).toBe('/api/voice?group=9');
    expect((init!.headers as Record<string, string>)['content-type']).toBe('application/octet-stream');
  });

  it('ошибка в потоке → ApiError(500, код)', async () => {
    fetchMock.mockResolvedValueOnce(streamed(`${JSON.stringify({ text: 'a' })}\n${JSON.stringify({ error: 'too_long' })}\n`, [3]));
    const onText = vi.fn();
    await expect(api.voice(new Blob(['a']), onText)).rejects.toMatchObject({ status: 500, code: 'too_long' });
    expect(onText).toHaveBeenCalledWith('a');
  });

  it('поток кончился без действий → failed', async () => {
    fetchMock.mockResolvedValueOnce(streamed(`${JSON.stringify({ text: 'a' })}\n`, []));
    await expect(api.voice(new Blob(['a']), () => {})).rejects.toMatchObject({ status: 500, code: 'failed' });
  });

  it('не 2xx: код из JSON (voice_limit) или network', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'voice_limit' }, 429));
    await expect(api.voice(new Blob(['a']), () => {})).rejects.toMatchObject({ status: 429, code: 'voice_limit' });
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 503 }));
    await expect(api.voice(new Blob(['a']), () => {})).rejects.toMatchObject({ status: 503, code: 'network' });
  });

  it('старый WebView без потока (body = null): всё разом через text()', async () => {
    const lines = `${JSON.stringify({ text: 'привет' })}\n${JSON.stringify({ actions })}\n`;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body: null, text: async () => lines } as unknown as Response);
    const onText = vi.fn();
    await expect(api.voice(new Blob(['a']), onText)).resolves.toEqual(actions);
    expect(onText).toHaveBeenCalledWith('привет');
  });
});
