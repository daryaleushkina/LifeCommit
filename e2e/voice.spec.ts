// Голос: «Добавить всё» — решение владелицы 04.10.2026: нажали «Добавить» — добавиться должно всё.
// Не дошедшее повторяется само; сервер узнаёт повтор по ключу и не создаёт дубль. Связи нет совсем — в списке
// остаётся только недобавленное, следующий «Добавить» добавляет его, ничего не задваивая.
import { expect, test } from './fixtures';
import type { Page, Route } from '@playwright/test';

test.use({ permissions: ['microphone'] });

/** Разбор подменён (модель — забота pnpm eval:voice); multiple — по две строки в личных пачках. */
const reply = (groupId: number, day: string, titles: { todo?: string; habit?: string; item?: string } = {}, multiple = false) => (r: Route) =>
  r.fulfill({
    contentType: 'application/x-ndjson',
    body: [
      { text: 'в группу Семья уборка, а себе купить молоко и читать каждый день' },
      {
        actions: [
          {
            type: 'create_group_item',
            group: { id: groupId, title: 'Семья' },
            item: { title: titles.item ?? 'Уборка', mode: 'one', day, time: null, rrule: null, assignees: [], all_members: false, rotate: false, target: null, unit: null, duration_min: null },
            names: [],
          },
          { type: 'create_todo', todo: { title: titles.todo ?? 'Купить молоко', day: null, time: null } },
          ...(multiple ? [{ type: 'create_todo', todo: { title: 'Позвонить маме', day: null, time: null } }] : []),
          { type: 'create_habit', habit: { title: titles.habit ?? 'Читать', kind: 'check', target: 1, unit: null, schedule: 'daily', weekdays: 127, per_week: null } },
          ...(multiple ? [{ type: 'create_habit', habit: { title: 'Гулять', kind: 'check', target: 1, unit: null, schedule: 'daily', weekdays: 127, per_week: null } }] : []),
        ],
      },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'),
  });

async function speak(page: Page) {
  await page.locator('.tab-mic').click();
  await expect(page.locator('.voice-timer')).toHaveText('0:01');
  await page.getByRole('button', { name: 'Готово, разобрать' }).click();
  await expect(page.locator('.sheet').getByRole('heading', { name: 'Вот что получилось' })).toBeVisible();
}

async function counts(me: { api: <T>(m: string, p: string, b?: unknown) => Promise<T> }, groupId: number) {
  const today = await me.api<{ todos: { title: string }[]; tasks: { title: string }[] }>('GET', '/today');
  const group = await me.api<{ items: { title: string }[] }>('GET', `/groups/${groupId}`);
  return {
    todos: today.todos.filter((t) => ['Купить молоко', 'Позвонить маме'].includes(t.title)).length,
    habits: today.tasks.filter((t) => ['Читать', 'Гулять'].includes(t.title)).length,
    items: group.items.filter((t) => t.title === 'Уборка').length,
  };
}

async function recordBatch(page: Page, kind: 'todos' | 'tasks') {
  const requests: unknown[] = [];
  await page.route(`**/api/${kind}/batch`, (r) => {
    requests.push(r.request().postDataJSON());
    return r.fallback();
  });
  return requests;
}

test('голос «Добавить всё»: ответ потерялся после записи — повторяется само, всё по одному', async ({ app: page, me }) => {
  const g = await me.api<{ id: number }>('POST', '/groups', { title: 'Семья' });
  const { day } = await me.api<{ day: string }>('GET', '/today');
  await page.reload();
  await page.route('**/api/voice*', reply(g.id, day, {}, true));
  await speak(page);
  const todos = await recordBatch(page, 'todos');
  const habits = await recordBatch(page, 'tasks');
  let fail = true;
  const keys: string[] = [];
  await page.route('**/api/groups/*/items', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    keys.push(r.request().postDataJSON().key);
    if (!fail) return r.fallback();
    fail = false;
    const response = await r.fetch(); // Сервер уже записал строку, а ответ до клиента не дошёл.
    expect(response.status()).toBe(201);
    return r.abort('failed');
  });
  await page.locator('.sheet').getByRole('button', { name: 'Добавить всё · 5' }).click();
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  expect(await counts(me, g.id)).toEqual({ todos: 2, habits: 2, items: 1 });
  expect(todos).toHaveLength(1);
  expect(habits).toHaveLength(1);
  expect(todos[0]).toMatchObject({ todos: [{ title: 'Купить молоко' }, { title: 'Позвонить маме' }], keys: [expect.stringMatching(/^[0-9a-f]{32}$/), expect.stringMatching(/^[0-9a-f]{32}$/)] });
  expect(habits[0]).toMatchObject({ tasks: [{ title: 'Читать' }, { title: 'Гулять' }], keys: [expect.stringMatching(/^[0-9a-f]{32}$/), expect.stringMatching(/^[0-9a-f]{32}$/)] });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
  expect(keys[1]).toBe(keys[0]);
});

test('голос «Добавить всё»: связи с группой нет — остаётся только недобавленное, повтор без дублей', async ({ app: page, me }) => {
  const g = await me.api<{ id: number }>('POST', '/groups', { title: 'Семья' });
  const { day } = await me.api<{ day: string }>('GET', '/today');
  await page.reload();
  await page.route('**/api/voice*', reply(g.id, day, {}, true));
  await speak(page);
  await page.route('**/api/groups/*/items', (r) => (r.request().method() === 'POST' ? r.abort('failed') : r.fallback()));
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Добавить всё · 5' }).click();
  // Своё уже добавлено и из списка ушло; осталось дело для группы и честная строка о нём.
  await expect(sheet.getByRole('button', { name: 'Добавить 1 дело' })).toBeVisible();
  await expect(sheet.getByText('Купить молоко')).toHaveCount(0);
  await expect(sheet.getByText('Позвонить маме')).toHaveCount(0);
  await expect(sheet.getByText('Читать')).toHaveCount(0);
  await expect(sheet.getByText('Гулять')).toHaveCount(0);
  await expect(sheet.getByText('Уборка')).toBeVisible();
  await expect(sheet.locator('.error')).toBeVisible();
  expect(await counts(me, g.id)).toEqual({ todos: 2, habits: 2, items: 0 });
  // Связь вернулась — «Добавить» ещё раз.
  await page.unroute('**/api/groups/*/items');
  await sheet.getByRole('button', { name: 'Добавить 1 дело' }).click();
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  expect(await counts(me, g.id)).toEqual({ todos: 2, habits: 2, items: 1 });
});

test('голос: ответы пачки дел потерялись — она остаётся целиком; следующий повтор без дублей', async ({ app: page, me }) => {
  const g = await me.api<{ id: number }>('POST', '/groups', { title: 'Семья' });
  const { day } = await me.api<{ day: string }>('GET', '/today');
  await page.reload();
  await page.route('**/api/voice*', reply(g.id, day, {}, true));
  await speak(page);
  const todos = await recordBatch(page, 'todos');
  const habits = await recordBatch(page, 'tasks');
  const lost = async (r: Route) => {
    // Даже не получив подтверждение, повторяем оба ключа и весь порядок пачки.
    todos.push(r.request().postDataJSON());
    expect((await r.fetch()).status()).toBe(201);
    return r.abort('failed');
  };
  await page.route('**/api/todos/batch', lost);
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Добавить всё · 5' }).click();
  await expect(sheet.getByRole('button', { name: 'Добавить 2 дела' })).toBeEnabled();
  await expect(sheet.getByText('Купить молоко', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Позвонить маме', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Читать', { exact: true })).toHaveCount(0);
  await expect(sheet.getByText('Гулять', { exact: true })).toHaveCount(0);
  await expect(sheet.getByText('Уборка', { exact: true })).toHaveCount(0);
  await expect(sheet.locator('.error')).toBeVisible();
  expect(todos).toHaveLength(3);
  expect(todos[1]).toEqual(todos[0]);
  expect(todos[2]).toEqual(todos[0]);
  expect(habits).toHaveLength(1);
  expect(await counts(me, g.id)).toEqual({ todos: 2, habits: 2, items: 1 });

  await page.unroute('**/api/todos/batch', lost);
  await sheet.getByRole('button', { name: 'Добавить 2 дела' }).click();
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  expect(todos).toHaveLength(4);
  expect(todos[3]).toEqual(todos[0]);
  expect(habits).toHaveLength(1);
  expect(await counts(me, g.id)).toEqual({ todos: 2, habits: 2, items: 1 });
});

test('голос: длинные названия — «Добавить всё» видно без прокрутки шторки', async ({ app: page, me }) => {
  const g = await me.api<{ id: number }>('POST', '/groups', { title: '👨‍👩‍👧‍👦 Семья Ивановых-Петровых-Сидоровых' });
  const { day } = await me.api<{ day: string }>('GET', '/today');
  await page.reload();
  await page.route(
    '**/api/voice*',
    reply(g.id, day, {
      todo: 'Записаться к стоматологу на четверг после работы и не забыть взять полис',
      habit: 'Читатьпоутрамхотябыдесятьстраницкаждыйдень',
      item: 'Вынестимусориразобратьбалконпередзимойвсемвместе',
    }),
  );
  await speak(page);
  await expect(page.locator('.sheet').getByRole('button', { name: 'Добавить всё · 3' })).toBeInViewport();
});
