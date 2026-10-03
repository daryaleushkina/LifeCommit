// Друзья (допрос 03.10.2026): дружба только через заявку — по @username или по личной постоянной ссылке; бот
// присылает заявку с кнопками; отказ ничего не оставляет; блок прячет человека; друг видит общую карту без названий
// и открытые ему привычки. Реакций нет — только смотреть.
import { describe, expect, it, vi } from 'vitest';
import { logicalDay } from './day';
import { botUpdate, dbReady, sb, tg, user, type TestUser } from './test/harness';

const ready = await dbReady();
if (!ready) console.warn('тесты друзей пропущены: нет локальной Supabase (pnpm db:start)');

const TZ = 'Europe/Moscow';

/** Человек с @username; бот может ему писать (нажимал /start). */
async function person(name: string, username: string, opts: { botChat?: boolean; lang?: string } = {}) {
  const u = await user({ name, lang: opts.lang, timezone: TZ });
  await sb.from('users').update({ username, bot_chat_ok: opts.botChat ?? true }).eq('id', u.id);
  return u;
}

/** Уникальное имя: тесты идут параллельно в одной базе. */
const nick = (base: string) => `${base}${Math.floor(Math.random() * 1e9)}`;

const list = async (u: TestUser) => (await u.call('GET', '/friends')).body;
const ids = (people: { id: number }[]) => people.map((p) => p.id);
const requestMessages = (to: number) => tg.sent('sendMessage').filter((m) => m.body.chat_id === to);

/** Нажатие кнопки под сообщением бота. */
const press = (who: TestUser, data: string) =>
  botUpdate({ update_id: 1, callback_query: { id: `q${Math.random()}`, from: { id: who.id, first_name: 'Кнопка' }, data, message: { message_id: 77, chat: { id: who.id, type: 'private' } } } });

async function friendsOf(a: TestUser, b: TestUser) {
  const nb = (await sb.from('users').select('username').eq('id', b.id).single()).data!.username as string;
  expect((await a.call('POST', '/friends/requests', { username: nb })).body).toEqual({ status: 'sent' });
  expect((await b.call('POST', `/friends/requests/${a.id}/accept`)).status).toBe(200);
}

describe.skipIf(!ready)('заявка по @username', () => {
  it('бот присылает заявку с кнопками; приняли в приложении — друзья у обоих', async () => {
    const dasha = await person('Даша', nick('dasha'));
    const mashaName = nick('Masha');
    const masha = await person('Маша', mashaName);

    // Поиск — без учёта регистра и с «@» или ссылкой t.me.
    const found = await dasha.call('GET', `/friends/find?username=${encodeURIComponent(`@${mashaName.toLowerCase()}`)}`);
    expect(found.body).toEqual({ person: { id: masha.id, first_name: 'Маша', username: mashaName, photo_url: null }, status: 'none' });
    expect((await dasha.call('GET', `/friends/find?username=${encodeURIComponent(`https://t.me/${mashaName}`)}`)).body.status).toBe('none');

    expect(await dasha.call('POST', '/friends/requests', { username: `@${mashaName}` })).toMatchObject({ status: 201, body: { status: 'sent' } });
    const [msg] = requestMessages(masha.id);
    expect(msg!.body.text).toBe(`Даша (@${(await sb.from('users').select('username').eq('id', dasha.id).single()).data!.username}) хочет дружить в LifeCommit`);
    expect(msg!.body.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: 'Принять', callback_data: `fr:a:${dasha.id}` },
          { text: 'Отклонить', callback_data: `fr:d:${dasha.id}` },
        ],
        [{ text: 'Заблокировать', callback_data: `fr:b:${dasha.id}` }],
      ],
    });

    // Повторная заявка — та же, бот второй раз не пишет.
    expect((await dasha.call('POST', '/friends/requests', { username: mashaName })).body).toEqual({ status: 'sent' });
    expect(requestMessages(masha.id)).toHaveLength(1);
    expect((await dasha.call('GET', `/friends/find?username=${mashaName}`)).body.status).toBe('sent');
    expect((await masha.call('GET', `/friends/find?username=${(await sb.from('users').select('username').eq('id', dasha.id).single()).data!.username}`)).body.status).toBe('incoming');

    expect(ids((await list(dasha)).outgoing)).toEqual([masha.id]);
    expect((await list(masha)).incoming).toEqual([{ id: dasha.id, first_name: 'Даша', username: expect.any(String), photo_url: null, via: 'username' }]);

    expect((await masha.call('POST', `/friends/requests/${dasha.id}/accept`)).body).toEqual({ ok: true });
    const dashas = await list(dasha);
    expect(dashas.friends).toEqual([{ id: masha.id, first_name: 'Маша', username: mashaName, photo_url: null, since: expect.any(String), done: 0, due: 0, days: Array(14).fill(0) }]);
    expect(dashas.outgoing).toEqual([]);
    expect(ids((await list(masha)).friends)).toEqual([dasha.id]);
    // Принять второй раз нечего.
    expect(await masha.call('POST', `/friends/requests/${dasha.id}/accept`)).toMatchObject({ status: 404 });
  });

  it('встречная заявка — сразу друзья; бот пишет по-английски тому, кто говорит по-английски', async () => {
    const a = await person('Ann', nick('ann'), { lang: 'en' });
    const b = await person('Bob', nick('bob'));
    const an = (await sb.from('users').select('username').eq('id', a.id).single()).data!.username;
    const bn = (await sb.from('users').select('username').eq('id', b.id).single()).data!.username;
    await b.call('POST', '/friends/requests', { username: an });
    expect(requestMessages(a.id)[0]!.body.text).toMatch(/^Bob \(@bob\d+\) wants to be friends on LifeCommit$/);
    expect((await a.call('POST', '/friends/requests', { username: bn })).body).toEqual({ status: 'friends' });
    expect(ids((await list(b)).friends)).toEqual([a.id]);
    // Уже друзья — заявка ничего не меняет.
    expect((await a.call('POST', '/friends/requests', { username: bn })).body).toEqual({ status: 'friends' });
  });

  it('бот не открывали — заявка видна только в приложении', async () => {
    const a = await person('Аня', nick('anya'));
    const silentName = nick('silent');
    const silent = await person('Тихий', silentName, { botChat: false });
    await a.call('POST', '/friends/requests', { username: silentName });
    expect(requestMessages(silent.id)).toEqual([]);
    expect(ids((await list(silent)).incoming)).toEqual([a.id]);
  });

  it('отклонить и отменить — заявка исчезает без следа, можно позвать снова', async () => {
    const a = await person('Аня', nick('anya'));
    const bName = nick('boris');
    const b = await person('Борис', bName);
    await a.call('POST', '/friends/requests', { username: bName });
    expect((await b.call('DELETE', `/friends/requests/${a.id}`)).body).toEqual({ ok: true });
    expect((await list(a)).outgoing).toEqual([]);
    expect((await list(b)).incoming).toEqual([]);
    expect((await sb.from('friendships').select('status').or(`requester_id.eq.${a.id},addressee_id.eq.${a.id}`)).data).toEqual([]);

    // Ничего не помним — снова можно, и бот снова пишет.
    expect((await a.call('POST', '/friends/requests', { username: bName })).body).toEqual({ status: 'sent' });
    expect(requestMessages(b.id)).toHaveLength(2);
    // Свою заявку можно отменить.
    expect((await a.call('DELETE', `/friends/requests/${b.id}`)).body).toEqual({ ok: true });
    expect((await list(b)).incoming).toEqual([]);
  });

  it('@username с «_» ищется буквально, а не как шаблон; ошибки ввода, сам себя, нет такого', async () => {
    const me = await person('Я', nick('self'));
    const exact = `ab_${nick('cd')}`;
    const lookalike = exact.replace('_', 'x');
    const target = await person('Точный', exact);
    await person('Похожий', lookalike);
    expect((await me.call('GET', `/friends/find?username=${exact}`)).body.person.id).toBe(target.id);
    expect((await me.call('GET', `/friends/find?username=${nick('nobody')}`))).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect((await me.call('POST', '/friends/requests', { username: nick('nobody') }))).toMatchObject({ status: 404 });

    for (const bad of ['', '@', 'a b', 'абв', '123abc', 'x'.repeat(40)]) {
      expect(await me.call('GET', `/friends/find?username=${encodeURIComponent(bad)}`)).toMatchObject({ status: 400, body: { error: 'bad_username' } });
    }
    expect(await me.call('GET', '/friends/find')).toMatchObject({ status: 400 });
    expect(await me.call('POST', '/friends/requests', { username: 42 })).toMatchObject({ status: 400, body: { error: 'bad_username' } });
    expect(await me.call('POST', '/friends/requests', {})).toMatchObject({ status: 400, body: { error: 'bad_username' } });

    const mine = (await sb.from('users').select('username').eq('id', me.id).single()).data!.username;
    expect((await me.call('GET', `/friends/find?username=${mine}`)).body.status).toBe('self');
    expect(await me.call('POST', '/friends/requests', { username: mine })).toMatchObject({ status: 400, body: { error: 'self' } });
    expect(await me.call('POST', `/friends/requests/${target.id}/accept`)).toMatchObject({ status: 404 });
    expect(await me.call('POST', '/friends/requests/abc/accept')).toMatchObject({ status: 404 });
  });
});

describe.skipIf(!ready)('сбои Telegram и английский', () => {
  it('бот не смог написать заявку — заявка всё равно есть; кнопки по-английски; Telegram не ответил на кнопку — не страшно', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await person('Ann', nick('ann'));
    const bName = nick('bob');
    const b = await person('Bob', bName, { lang: 'en' });
    tg.reply('sendMessage', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    expect((await a.call('POST', '/friends/requests', { username: bName })).body).toEqual({ status: 'sent' });
    expect(errors.mock.calls.some(([m]) => m === 'friend request message failed')).toBe(true);
    expect(ids((await list(b)).incoming)).toEqual([a.id]);

    tg.reply('answerCallbackQuery', { ok: false, error_code: 400, description: 'query is too old' });
    tg.reply('editMessageText', { ok: false, error_code: 400, description: 'message to edit not found' });
    await press(b, `fr:a:${a.id}`);
    expect(ids((await list(b)).friends)).toEqual([a.id]);
    expect(tg.sent('editMessageText').at(-1)!.body.text).toBe('You and Ann are friends now. Their map and the habits they share are in the «Together» tab.');
    await press(b, `fr:b:${a.id}`);
    expect(tg.sent('editMessageText').at(-1)!.body.text).toContain('Ann is blocked');
    errors.mockRestore();
  });
});

describe.skipIf(!ready)('список друзей', () => {
  it('по алфавиту; «N из M» — по цели на сегодня, даже если цель меняли', async () => {
    const me = await person('Я', nick('me'));
    const vera = await person('Вера', nick('vera'));
    const anya = await person('Аня', nick('anya'));
    await friendsOf(vera, me);
    await friendsOf(anya, me);
    expect((await list(me)).friends.map((f: { first_name: string }) => f.first_name)).toEqual(['Аня', 'Вера']);

    const id = (await vera.call('POST', '/tasks', { title: 'Шаги', kind: 'count', target: 10, visibility: 'friends' })).body.id;
    // Раньше цель была другой: история целей — несколько строк.
    await sb.from('task_goals').insert({ task_id: id, target: 5, effective_from: '2000-01-01' });
    await vera.call('PUT', '/logs', { task_id: id, value: 7 });
    expect((await list(me)).friends.find((f: { id: number }) => f.id === vera.id)).toMatchObject({ done: 0, due: 1 });
    await vera.call('PUT', '/logs', { task_id: id, value: 10 });
    expect((await list(me)).friends.find((f: { id: number }) => f.id === vera.id)).toMatchObject({ done: 1, due: 1 });
  });
});

describe.skipIf(!ready)('постоянная ссылка', () => {
  it('открыл ссылку — видно, кто зовёт; заявка уходит владельцу ссылки, он принимает кнопкой в боте', async () => {
    const owner = await person('Даша', nick('dasha'));
    const guest = await person('Гость', nick('guest'));
    const { link } = await list(owner);
    const code = /startapp=f_([a-z0-9]+)$/.exec(link)![1]!;
    expect(link).toBe(`https://t.me/LifeCommit_bot?startapp=f_${code}`);
    // Ссылка постоянная.
    expect((await list(owner)).link).toBe(link);

    expect((await guest.call('GET', `/friends/link/${code}`)).body).toEqual({ person: { id: owner.id, first_name: 'Даша', username: expect.any(String), photo_url: null }, status: 'none' });
    expect((await owner.call('GET', `/friends/link/${code}`)).body.status).toBe('self');
    expect(await guest.call('GET', '/friends/link/nosuchcode')).toMatchObject({ status: 404 });

    expect((await guest.call('POST', '/friends/requests', { code })).body).toEqual({ status: 'sent' });
    expect(requestMessages(owner.id)).toHaveLength(1);
    // В карточке заявки — «по вашей ссылке».
    expect((await list(owner)).incoming).toEqual([expect.objectContaining({ id: guest.id, via: 'link' })]);

    await press(owner, `fr:a:${guest.id}`);
    expect(tg.sent('editMessageText').at(-1)!.body).toMatchObject({ chat_id: owner.id, message_id: 77, text: expect.stringContaining('Вы теперь друзья с Гость') });
    expect(tg.sent('answerCallbackQuery')).toHaveLength(1);
    expect(ids((await list(guest)).friends)).toEqual([owner.id]);
    // Нажали ещё раз — заявки уже нет.
    await press(owner, `fr:a:${guest.id}`);
    expect(tg.sent('editMessageText').at(-1)!.body.text).toBe('Этой заявки уже нет.');
  });

  it('кнопки «Отклонить» и «Заблокировать» в боте; чужой или битый id — «заявки уже нет»', async () => {
    const owner = await person('Даша', nick('dasha'));
    const a = await person('Аня', nick('anya'));
    const code = /f_([a-z0-9]+)$/.exec((await list(owner)).link)![1]!;
    await a.call('POST', '/friends/requests', { code });
    await press(owner, `fr:d:${a.id}`);
    expect(tg.sent('editMessageText').at(-1)!.body.text).toBe('Заявка отклонена.');
    expect((await list(owner)).incoming).toEqual([]);

    await a.call('POST', '/friends/requests', { code });
    await press(owner, `fr:b:${a.id}`);
    expect(tg.sent('editMessageText').at(-1)!.body.text).toContain('Аня заблокирован');
    expect((await list(owner)).incoming).toEqual([]);
    expect(ids((await owner.call('GET', '/blocks')).body)).toEqual([a.id]);

    for (const data of ['fr:a:abc', 'fr:x:1', `fr:d:${a.id}`]) {
      await press(owner, data);
      expect(tg.sent('editMessageText').at(-1)!.body.text).toBe('Этой заявки уже нет.');
    }
  });
});

describe.skipIf(!ready)('убрать и заблокировать', () => {
  it('убрать из друзей — тихо, у обоих пропадает; второй раз — ничего', async () => {
    const a = await person('Аня', nick('anya'));
    const b = await person('Борис', nick('boris'));
    await friendsOf(a, b);
    const before = tg.calls.length;
    expect((await a.call('DELETE', `/friends/${b.id}`)).body).toEqual({ ok: true });
    expect((await list(a)).friends).toEqual([]);
    expect((await list(b)).friends).toEqual([]);
    expect(tg.calls.length).toBe(before);
    expect((await a.call('DELETE', `/friends/${b.id}`)).status).toBe(200);
    expect(await b.call('GET', `/friends/${a.id}`)).toMatchObject({ status: 404 });
  });

  it('заблокированный не находит меня ни по @username, ни по ссылке и не шлёт заявок; разблокировала — снова может', async () => {
    const meName = nick('dasha');
    const me = await person('Даша', meName);
    const pest = await person('Навязчивый', nick('pest'));
    await friendsOf(pest, me);
    const code = /f_([a-z0-9]+)$/.exec((await list(me)).link)![1]!;

    expect((await me.call('POST', `/friends/${pest.id}/block`)).body).toEqual({ ok: true });
    expect((await list(me)).friends).toEqual([]);
    expect((await list(pest)).friends).toEqual([]);
    expect(await pest.call('GET', `/friends/find?username=${meName}`)).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await pest.call('GET', `/friends/link/${code}`)).toMatchObject({ status: 404 });
    expect(await pest.call('POST', '/friends/requests', { username: meName })).toMatchObject({ status: 404 });
    expect(await pest.call('POST', '/friends/requests', { code })).toMatchObject({ status: 404 });
    expect(requestMessages(me.id)).toHaveLength(1);

    // Я его вижу как «заблокирован» и сама позвать не могу, пока не сниму блок.
    const pestName = (await sb.from('users').select('username').eq('id', pest.id).single()).data!.username;
    expect((await me.call('GET', `/friends/find?username=${pestName}`)).body.status).toBe('blocked');
    expect(await me.call('POST', '/friends/requests', { username: pestName })).toMatchObject({ status: 409, body: { error: 'blocked' } });
    expect((await me.call('GET', '/blocks')).body).toEqual([{ id: pest.id, first_name: 'Навязчивый', username: pestName, photo_url: null }]);

    expect((await me.call('DELETE', `/blocks/${pest.id}`)).body).toEqual({ ok: true });
    expect((await me.call('GET', '/blocks')).body).toEqual([]);
    expect((await pest.call('POST', '/friends/requests', { username: meName })).body).toEqual({ status: 'sent' });
    // Блок повторно и себя самого.
    await me.call('POST', `/friends/${pest.id}/block`);
    expect((await me.call('POST', `/friends/${pest.id}/block`)).status).toBe(200);
    expect(await me.call('POST', `/friends/${me.id}/block`)).toMatchObject({ status: 400, body: { error: 'self' } });
    expect(await me.call('POST', '/friends/0/block')).toMatchObject({ status: 404 });
  });
});

describe.skipIf(!ready)('что видит друг', () => {
  it('общая карта по всем привычкам и делам, но названия — только открытых; «N из M» в списке', async () => {
    const me = await person('Даша', nick('dasha'));
    const friend = await person('Маша', nick('masha'));
    await friendsOf(me, friend);
    const day = logicalDay(TZ, 4);

    const shown = (await me.call('POST', '/tasks', { title: 'Испанский', kind: 'count', target: 20, unit: 'слов', visibility: 'friends' })).body.id;
    const quit = (await me.call('POST', '/tasks', { title: 'Без сладкого', kind: 'abstain', target: 1, visibility: 'friends' })).body.id;
    const hidden = (await me.call('POST', '/tasks', { title: 'Психотерапевт', kind: 'check', target: 1 })).body.id;
    await me.call('PUT', '/logs', { task_id: shown, value: 12 });
    await me.call('PUT', '/logs', { task_id: quit, status: 'clean' });
    await me.call('PUT', '/logs', { task_id: hidden, value: 1 });
    const todo = (await me.call('POST', '/todos', { title: 'Купить подарок' })).body.id;
    await me.call('PATCH', `/todos/${todo}`, { done: true });

    const res = await friend.call('GET', `/friends/${me.id}`);
    expect(res.status).toBe(200);
    expect(res.body.person).toEqual({ id: me.id, first_name: 'Даша', username: expect.any(String), photo_url: null });
    expect(res.body.today).toBe(day);
    expect(res.body.since).toEqual(expect.any(String));
    // Скрытая привычка не видна по названию...
    expect(res.body.habits.map((h: { title: string }) => h.title)).toEqual(['Испанский', 'Без сладкого']);
    expect(JSON.stringify(res.body)).not.toContain('Психотерапевт');
    expect(JSON.stringify(res.body)).not.toContain('Купить подарок');
    // ...но её день и сделанное дело — на общей карте: 12/20 + 1 (чисто) + 1 + 1 дело.
    expect(res.body.heat.find((h: { day: string }) => h.day === day).score).toBeCloseTo(3.6);
    expect(res.body.habits[0]).toMatchObject({ id: shown, kind: 'count', unit: 'слов', target: 20, value: 12, due: true, logs: [{ day, value: 12, status: null }] });
    expect(res.body.habits[1]).toMatchObject({ id: quit, kind: 'abstain', status: 'clean', clean_days: 1 });
    expect(res.body.habits[0]).not.toHaveProperty('supported');

    // В списке — «N из M» за сегодня: «Без сладкого» отмечено, «Испанский» — 12 из 20, не целиком;
    // полоска общей карты кончается сегодняшним днём (вместе со скрытой привычкой и делом).
    const card = (await list(friend)).friends[0];
    expect(card).toMatchObject({ id: me.id, done: 1, due: 2 });
    expect(card.days).toHaveLength(14);
    expect(card.days.at(-1)).toBeCloseTo(3.6);
    expect(card.days.slice(0, -1).every((x: number) => x === 0)).toBe(true);
    await me.call('PUT', '/logs', { task_id: shown, value: 20 });
    expect((await list(friend)).friends[0]).toMatchObject({ done: 2, due: 2 });
  });

  it('не друг (заявка, незнакомый, сам себе) — экрана нет', async () => {
    const a = await person('Аня', nick('anya'));
    const bName = nick('boris');
    const b = await person('Борис', bName);
    expect(await a.call('GET', `/friends/${b.id}`)).toMatchObject({ status: 404 });
    await a.call('POST', '/friends/requests', { username: bName });
    expect(await a.call('GET', `/friends/${b.id}`)).toMatchObject({ status: 404 });
    expect(await b.call('GET', `/friends/${a.id}`)).toMatchObject({ status: 404 });
    expect(await a.call('GET', `/friends/${a.id}`)).toMatchObject({ status: 404 });
    expect(await a.call('GET', '/friends/-1')).toMatchObject({ status: 404 });
  });
});

describe.skipIf(!ready)('«Что показать друзьям?»', () => {
  it('появляется с первым другом; выбор открывает отмеченные и закрывает остальные — только мои', async () => {
    const me = await person('Даша', nick('dasha'));
    const other = await person('Маша', nick('masha'));
    const a = (await me.call('POST', '/tasks', { title: 'Чтение', kind: 'check', target: 1, visibility: 'friends' })).body.id;
    const b = (await me.call('POST', '/tasks', { title: 'Спортзал', kind: 'check', target: 1 })).body.id;
    const foreign = (await other.call('POST', '/tasks', { title: 'Чужое', kind: 'check', target: 1 })).body.id;
    expect((await list(me)).prompt).toBe(false);
    await friendsOf(me, other);
    expect((await list(me)).prompt).toBe(true);
    expect((await list(other)).prompt).toBe(true);

    expect((await me.call('PUT', '/friends/shown', { task_ids: [b, foreign] })).body).toEqual({ ok: true });
    const vis = async (id: number) => (await sb.from('tasks').select('visibility').eq('id', id).single()).data!.visibility;
    expect([await vis(a), await vis(b), await vis(foreign)]).toEqual(['private', 'friends', 'private']);
    expect((await list(me)).prompt).toBe(false);

    // «Пока ничего» — всё закрыто; просто закрыли шторку — ничего не меняем.
    await me.call('PUT', '/friends/shown', { task_ids: [] });
    expect([await vis(a), await vis(b)]).toEqual(['private', 'private']);
    expect((await other.call('POST', '/friends/prompted')).body).toEqual({ ok: true });
    expect((await list(other)).prompt).toBe(false);

    for (const task_ids of [undefined, 'all', [0], [1.5], ['3']]) {
      expect(await me.call('PUT', '/friends/shown', { task_ids })).toMatchObject({ status: 400, body: { error: 'bad_tasks' } });
    }
  });
});

describe.skipIf(!ready)('удаление аккаунта', () => {
  it('дружба, заявки и блоки уходят вместе с человеком', async () => {
    const a = await person('Аня', nick('anya'));
    const b = await person('Борис', nick('boris'));
    const c = await person('Вера', nick('vera'));
    await friendsOf(a, b);
    await c.call('POST', '/friends/requests', { username: (await sb.from('users').select('username').eq('id', a.id).single()).data!.username });
    await a.call('POST', `/friends/${c.id}/block`);
    expect((await a.call('DELETE', '/account')).status).toBe(200);
    expect((await list(b)).friends).toEqual([]);
    expect((await sb.from('friendships').select('status').or(`requester_id.eq.${a.id},addressee_id.eq.${a.id}`)).data).toEqual([]);
    expect((await sb.from('blocks').select('blocked_id').eq('blocker_id', a.id)).data).toEqual([]);
  });
});
