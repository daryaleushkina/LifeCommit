// Проверка протокола CalDAV на настоящем сервере. Запускается, только если задан CALDAV_TEST_URL —
// например, локальный Radicale: CALDAV_TEST_URL=http://127.0.0.1:5232/ CALDAV_TEST_LOGIN=… CALDAV_TEST_PASSWORD=… pnpm test
import { describe, expect, it } from 'vitest';
import { deleteEvent, discover, multiget, putEvent, syncCollection } from './caldav';
import { buildEvent, parseEvents } from './ics';

const base = process.env.CALDAV_TEST_URL;
const auth = { login: process.env.CALDAV_TEST_LOGIN ?? '', password: process.env.CALDAV_TEST_PASSWORD ?? '' };

describe.skipIf(!base)('CalDAV на живом сервере', () => {
  it('находит календари, читает изменения, пишет и удаляет событие', async () => {
    const acc = await discover(base!, auth);
    expect(acc.collections.length).toBeGreaterThan(0);
    expect(acc.defaultUrl).toBeTruthy();

    const home = acc.collections.find((c) => c.url === acc.defaultUrl)!;
    const before = await syncCollection(home.url, auth, null);
    const url = `${home.url}lifecommit-test-${Date.now()}.ics`;
    const etag = await putEvent(url, auth, buildEvent({ uid: url.split('/').pop()!.replace('.ics', ''), title: 'Купить молоко', day: '2026-10-02', time: '15:00', durationMin: 45, tz: 'Europe/Moscow' }), null);

    const added = await syncCollection(home.url, auth, before.token);
    expect(added.changed.map((c) => c.href)).toContain(url);
    const [got] = await multiget(home.url, auth, [url]);
    expect(parseEvents(got!.data, 'Europe/Moscow')[0]).toMatchObject({ title: 'Купить молоко', day: '2026-10-02', time: '15:00', durationMin: 45 });

    await deleteEvent(url, auth, etag);
    const gone = await syncCollection(home.url, auth, added.token);
    expect(gone.removed).toContain(url);
  });

  it('чужой пароль — ошибка авторизации', async () => {
    await expect(discover(base!, { login: auth.login, password: 'wrong' })).rejects.toMatchObject({ status: 401 });
  });
});
