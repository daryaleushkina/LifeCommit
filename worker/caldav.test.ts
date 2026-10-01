import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCollections } from './caldav';

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
