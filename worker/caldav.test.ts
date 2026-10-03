import { afterEach, describe, expect, it, vi } from 'vitest';
import { DavError, deleteEvent, discover, listCollections, syncCollection, SyncTokenExpired } from './caldav';

// Устройство настоящего ответа iCloud (01.10.2026): атрибуты в одинарных кавычках,
// у календаря напоминаний — только VTODO, рядом служебные «входящие» и уведомления.
const ICLOUD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><multistatus xmlns="DAV:">
<response xmlns="DAV:"><href>/1/calendars/</href><propstat><prop><resourcetype xmlns="DAV:"><collection/></resourcetype><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name='VEVENT' xmlns='urn:ietf:params:xml:ns:caldav'/></supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response xmlns="DAV:"><href>/1/calendars/home/</href><propstat><prop><resourcetype xmlns="DAV:"><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname xmlns="DAV:">Дом</displayname><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name='VEVENT' xmlns='urn:ietf:params:xml:ns:caldav'/></supported-calendar-component-set><calendar-color xmlns="http://apple.com/ns/ical/">#FF2968FF</calendar-color><sync-token xmlns="DAV:">HwoQ</sync-token></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response xmlns="DAV:"><href>/1/calendars/tasks/</href><propstat><prop><resourcetype xmlns="DAV:"><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname xmlns="DAV:">Напоминания</displayname><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name='VTODO' xmlns='urn:ietf:params:xml:ns:caldav'/></supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response xmlns="DAV:"><href>/1/calendars/inbox/</href><propstat><prop><resourcetype xmlns="DAV:"><collection/><schedule-inbox xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name='VEVENT' xmlns='urn:ietf:params:xml:ns:caldav'/></supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`;

afterEach(() => vi.unstubAllGlobals());

describe('listCollections', () => {
  it('понимает ответ iCloud: только календари с событиями', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ICLOUD, { status: 207 })));
    const list = await listCollections('https://p1-caldav.icloud.com/1/calendars/', { login: 'a@b.c', password: 'x' });
    expect(list).toEqual([{ url: 'https://p1-caldav.icloud.com/1/calendars/home/', name: 'Дом', color: '#FF2968', syncToken: 'HwoQ' }]);
  });
});

describe('протокол CalDAV: отказы сервера', () => {
  const auth = { login: 'a@b.c', password: 'x' };
  const reply = (status: number, body = '', headers: Record<string, string> = {}) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body || null, { status, headers })));

  it('жетон отклонён (409, 400 или 403 valid-sync-token) — полная перечитка; другой 403 — ошибка', async () => {
    for (const status of [409, 400]) {
      reply(status, 'conflict');
      await expect(syncCollection('https://cal.test/home/', auth, 'tok-1')).rejects.toBeInstanceOf(SyncTokenExpired);
    }
    reply(403, '<error xmlns="DAV:"><valid-sync-token/></error>');
    await expect(syncCollection('https://cal.test/home/', auth, 'tok-1')).rejects.toBeInstanceOf(SyncTokenExpired);
    reply(403, '<error xmlns="DAV:"><need-privileges/></error>');
    await expect(syncCollection('https://cal.test/home/', auth, 'tok-1')).rejects.toMatchObject({ status: 403 });
    // без жетона отказ — просто ошибка
    reply(409, 'conflict');
    await expect(syncCollection('https://cal.test/home/', auth, null)).rejects.toBeInstanceOf(DavError);
  });

  it('переадресация по кругу — 508, а не бесконечный цикл', async () => {
    reply(301, '', { Location: '/again' });
    await expect(discover('https://cal.test/', auth)).rejects.toMatchObject({ status: 508 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  });

  it('сервер не назвал, кто я или где календари, — ошибка подключения', async () => {
    reply(207, '<multistatus xmlns="DAV:"><response><href>/</href></response></multistatus>');
    await expect(discover('https://cal.test/', auth)).rejects.toMatchObject({ status: 500, message: 'no principal' });
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(++call === 1 ? '<multistatus xmlns="DAV:"><current-user-principal><href>/p/</href></current-user-principal></multistatus>' : '<multistatus xmlns="DAV:"/>', { status: 207 })),
    );
    await expect(discover('https://cal.test/', auth)).rejects.toMatchObject({ status: 500, message: 'no calendar home' });
  });

  it('удаление: уже удалено (404) — хорошо, иначе — ошибка', async () => {
    reply(404);
    await expect(deleteEvent('https://cal.test/home/a.ics', auth, '"e1"')).resolves.toBeUndefined();
    expect(vi.mocked(fetch).mock.calls[0]![1]!.headers).toMatchObject({ 'If-Match': '"e1"' });
    reply(500);
    await expect(deleteEvent('https://cal.test/home/a.ics', auth, null)).rejects.toMatchObject({ status: 500 });
  });
});
