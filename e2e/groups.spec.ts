// Группы: новая группа, дело «кто-то один», общая цель и вклад, удалить свайпом, настройки, удалить группу.
import type { Page } from '@playwright/test';
import { closeSheet, expect, goTab, swipeLeft, test, type Me } from './fixtures';

test('группа от создания до удаления', async ({ app: page }) => {
  await goTab(page, 'Вместе');
  await page.getByRole('button', { name: 'Новая группа' }).click();
  await page.getByPlaceholder(/Как назовём/).fill('Соседи');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByText('Соседи').first()).toBeVisible();

  // Дело «кто-то один» — отметить.
  await page.getByRole('button', { name: /^\+?\s*Дело$/ }).first().click();
  const sheet = page.locator('.sheet');
  await sheet.getByPlaceholder('Что сделать?').fill('Полить цветы');
  await sheet.getByRole('button', { name: /^(Добавить|Сохранить)$/ }).click();
  const item = page.locator('li', { hasText: 'Полить цветы' });
  await expect(item).toHaveCount(1);
  await item.locator('.todo-check').first().click();
  await expect(item).toHaveClass(/done/);

  // Общая цель — завести и положить.
  await page.getByRole('button', { name: /^\+?\s*Дело$/ }).first().click();
  await sheet.getByText('Общая цель', { exact: true }).click();
  await sheet.getByPlaceholder(/отпуск/i).fill('На велосипед');
  await sheet.getByPlaceholder('150 000').fill('1000');
  await sheet.getByRole('button', { name: /^(Добавить|Сохранить)$/ }).click();
  const goal = page.locator('li.group-goal', { hasText: 'На велосипед' });
  await goal.getByRole('button', { name: /Положить/ }).click();
  await page.locator('.sheet input').first().fill('250');
  await page.locator('.sheet').getByRole('button', { name: 'Положить' }).click();
  await expect(goal).toContainText('250');

  // Удалить дело свайпом.
  await swipeLeft(page, item.locator('.swipe-body'));
  await expect(page.locator('.undo-toast')).toHaveCount(0, { timeout: 8_000 });
  await expect(item).toHaveCount(0);

  // Настройки: переименовать, «только админы», чат подключает создатель.
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  await sheet.locator('input.sheet-input').fill('Соседи по дому');
  await sheet.locator('input.sheet-input').press('Enter');
  const toggle = sheet.locator('input.switch');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(sheet.getByRole('button', { name: 'Подключить чат Telegram' })).toBeVisible();
  await closeSheet(page);
  await expect(page.getByText('Соседи по дому').first()).toBeVisible();

  // Удалить группу.
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Удалить группу' }).click();
  await goTab(page, 'Вместе').catch(() => {});
  await expect(page.getByText('Соседи по дому')).toHaveCount(0);
});

// Одной фразой — и в группу, и себе (просьба владелицы 04.10.2026). Куда что сказано, решает модель на сервере
// (эталоны — pnpm eval:voice); здесь ответ разбора подменён, а всё остальное — запись, список, «Добавить» — настоящее.
test.describe('голос с группами', () => {
  // Микрофон нужен и на iPhone: WebKit Playwright даёт поддельный, если доступ разрешён.
  test.use({ permissions: ['microphone'] });

  test('голос: подсказка, как назвать группу; одна фраза — и в группу, и себе', async ({ app: page, me }) => {
    const g = await me.api<{ id: number }>('POST', '/groups', { title: 'Семья ❤️' });
    await page.reload();
    await expect(page.locator('.page-head h1')).toHaveText('Сегодня');
    const said = 'в группу Семья: в субботу уборка, а себе купить молоко и читать каждый день';
    // Дело группы должно быть «сегодня» в любой день прогона: раньше повтор был жёстко по субботам (BYDAY=SA), и в
    // остальные дни группа показывала «На сегодня ничего» — тест проходил только по субботам (упал 04.10.2026, вс).
    // День и день недели — по часовому поясу тестов (Europe/Moscow), а не по UTC.
    const tz = 'Europe/Moscow';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const byday = new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' }).slice(0, 2).toUpperCase();
    await page.route('**/api/voice*', (r) =>
      r.fulfill({
        contentType: 'application/x-ndjson',
        body: [
          { text: said },
          {
            actions: [
              {
                type: 'create_group_item',
                group: { id: g.id, title: 'Семья ❤️' },
                item: { title: 'Уборка', mode: 'one', day: today, time: null, rrule: `FREQ=WEEKLY;BYDAY=${byday}`, assignees: [], all_members: false, rotate: false, target: null, unit: null, duration_min: null },
                names: [],
              },
              { type: 'create_todo', todo: { title: 'Купить молоко', day: null, time: null } },
              { type: 'create_habit', habit: { title: 'Читать', kind: 'check', target: 1, unit: null, schedule: 'daily', weekdays: 127, per_week: null } },
            ],
          },
        ]
          .map((e) => JSON.stringify(e))
          .join('\n'),
      }),
    );

    await page.locator('.tab-mic').click();
    await expect(page.getByText('Говори — я слушаю')).toBeVisible();
    // Эмодзи из названия не произносят — в подсказке группа так, как её говорят.
    await expect(page.getByText('Для группы назови её: «в группу Семья: в субботу уборка, а себе — купить молоко»')).toBeVisible();
    // Короче 0,8 с запись не отправляется — ждём, пока она идёт хотя бы секунду.
    await expect(page.locator('.voice-timer')).toHaveText('0:01');
    await page.getByRole('button', { name: 'Готово, разобрать' }).click();

    const sheet = page.locator('.sheet');
    await expect(sheet.getByRole('heading', { name: 'Вот что получилось' })).toBeVisible();
    const group = sheet.locator('section', { has: page.getByRole('heading', { name: 'В группу «Семья ❤️»' }) });
    await expect(group.getByText('Уборка')).toBeVisible();
    await expect(sheet.getByText('Купить молоко')).toBeVisible();
    await expect(sheet.getByText('Читать')).toBeVisible();
    await sheet.getByRole('button', { name: 'Добавить всё · 3' }).click();
    await expect(page.locator('.sheet-backdrop')).toHaveCount(0);

    // Своё — на «Сегодня», групповое — в группе.
    await expect(page.locator('.page-head h1')).toHaveText('Сегодня');
    await expect(page.locator('.todo-list li', { hasText: 'Купить молоко' })).toHaveCount(1);
    await expect(page.locator('.task', { hasText: 'Читать' })).toHaveCount(1);
    await goTab(page, 'Вместе');
    await page.getByText('Семья ❤️').first().click();
    await expect(page.getByText('Уборка').first()).toBeVisible();

    // С экрана группы подсказка другая: сказанное уйдёт в эту группу.
    await page.locator('.tab-mic').click();
    await expect(page.getByText('Сказанное пойдёт в группу «Семья ❤️». Своё — после слова «себе»')).toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  });

  test('голос: на экране только что созданной группы подсказка — про неё, а не про старую', async ({ app: page, me }) => {
    await me.api('POST', '/groups', { title: 'Семья' });
    await page.reload();
    await goTab(page, 'Вместе');
    await page.getByRole('button', { name: 'Новая группа' }).click();
    await page.getByPlaceholder(/Как назовём/).fill('Тестим бота');
    await page.getByRole('button', { name: 'Создать группу' }).click();
    await expect(page.getByText('Тестим бота').first()).toBeVisible();
    await page.locator('.tab-mic').click();
    await expect(page.getByText('Сказанное пойдёт в группу «Тестим бота». Своё — после слова «себе»')).toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  });

  // 04.10.2026, /lc-explore: шторка голоса, закрываясь, прятала кнопку «Назад» Telegram — с экрана группы было не уйти.
  test('голос на экране группы: «Отмена» — кнопка «Назад» Telegram на месте и уводит в список', async ({ app: page }) => {
    await goTab(page, 'Вместе');
    await page.getByRole('button', { name: 'Новая группа' }).click();
    await page.getByPlaceholder(/Как назовём/).fill('Дача');
    await page.getByRole('button', { name: 'Создать группу' }).click();
    await expect(page.locator('.group-header')).toBeVisible();
    const back = page.locator('#tg-mock-back');
    await expect(back).toBeVisible();
    await page.locator('.tab-mic').click();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.locator('.group-header')).toHaveCount(0);
    await expect(page.locator('.group-card', { hasText: 'Дача' })).toBeVisible();
  });
});

test('настройки группы: сервер не сохранил — имя и «только админы» как были, выйти не вышло — остаёмся', async ({ app: page }) => {
  await goTab(page, 'Вместе');
  await page.getByRole('button', { name: 'Новая группа' }).click();
  await page.getByPlaceholder(/Как назовём/).fill('Дача');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByText('Дача').first()).toBeVisible();

  await page.route('**/api/groups/*', (r) => (r.request().method() === 'PATCH' ? r.abort('failed') : r.fallback()));
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  const sheet = page.getByRole('dialog', { name: 'Настройки группы' });
  await sheet.locator('input.sheet-input').fill('Дача у озера');
  await sheet.locator('input.sheet-input').press('Enter');
  await expect(sheet.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
  await expect(sheet.locator('input.sheet-input')).toHaveValue('Дача');
  const toggle = sheet.locator('input.switch');
  await toggle.click();
  await expect(toggle).not.toBeChecked();

  // Удалить группу не вышло — экран группы на месте, подсказка поверх.
  await page.route('**/api/groups/*', (r) => (r.request().method() === 'DELETE' ? r.abort('failed') : r.fallback()));
  await sheet.getByRole('button', { name: 'Удалить группу' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Что-то пошло не так. Попробуй ещё раз.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Дача' })).toBeVisible();
});

// ── Находки /lc-explore 04.10.2026: экран не врёт и не молчит, когда сервер или сеть подвели ──

const ERR = 'Что-то пошло не так. Попробуй ещё раз.';

/** Группа через API (и её дела), затем её экран через интерфейс. */
async function openGroup(page: Page, me: Me, title = 'Дача', items: { title: string; mode?: string; target?: number }[] = []) {
  const g = await me.api<{ id: number }>('POST', '/groups', { title });
  for (const it of items) await me.api('POST', `/groups/${g.id}/items`, { mode: 'one', ...it });
  await page.reload();
  await expect(page.locator('.page-head h1')).toHaveText('Сегодня');
  await goTab(page, 'Вместе');
  await page.locator('.group-card', { hasText: title }).first().click();
  await expect(page.locator('.group-header')).toBeVisible();
  return g.id;
}

test('отметка дела без сети: сказано, галочка снята — и после возврата на экран тоже', async ({ app: page, me }) => {
  await openGroup(page, me, 'Дача', [{ title: 'Полить цветы' }]);
  const check = () => page.locator('li', { hasText: 'Полить цветы' }).locator('.todo-check');
  await page.route('**/api/**', (r) => r.abort('failed'));
  await check().click();
  await expect(page.getByRole('status').filter({ hasText: ERR })).toBeVisible();
  await expect(check()).toHaveAttribute('aria-pressed', 'false');
  // Кэш экрана группы тоже без отметки: вышли и снова зашли — дело не «сделано».
  await page.keyboard.press('Escape');
  await page.locator('.group-card', { hasText: 'Дача' }).click();
  await expect(check()).toHaveAttribute('aria-pressed', 'false');
});

test('«Позвать», удалить дело из шторки, отключить чат: сервер отказал — сказано и всё на месте', async ({ app: page, me }) => {
  const id = await openGroup(page, me, 'Дача', [{ title: 'Полить цветы' }]);

  // «Позвать» — ссылки нет.
  await page.getByRole('radio', { name: 'Люди' }).click();
  await page.route('**/api/groups/*/invite', (r) => r.abort('failed'));
  await page.getByRole('button', { name: /Позвать/ }).click();
  await expect(page.getByRole('status').filter({ hasText: ERR })).toBeVisible();
  await page.getByRole('radio', { name: 'Дела' }).click();

  // Удалить из шторки дела — отказ: шторка открыта и говорит, дело на месте.
  await page.locator('li', { hasText: 'Полить цветы' }).locator('.todo-main').click();
  const sheet = page.locator('.sheet');
  await page.route('**/api/groups/*/items/*', (r) => (r.request().method() === 'DELETE' ? r.abort('failed') : r.fallback()));
  await sheet.getByRole('button', { name: 'Удалить' }).click();
  await expect(sheet.getByText(ERR)).toBeVisible();
  await closeSheet(page);
  await expect(page.locator('li', { hasText: 'Полить цветы' })).toHaveCount(1);

  // Отключить чат — отказ: сказано, чат снова в настройках.
  await page.route(`**/api/groups/${id}`, async (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const res = await r.fetch();
    const j = await res.json();
    j.settings.tg_chat_title = 'Семейный чат';
    await r.fulfill({ response: res, json: j });
  });
  await page.route(`**/api/groups/${id}/chat/check`, (r) => r.fulfill({ json: { tg_chat_title: 'Семейный чат' } }));
  await page.route(`**/api/groups/${id}/chat`, (r) => (r.request().method() === 'DELETE' ? r.abort('failed') : r.fallback()));
  await page.keyboard.press('Escape');
  await page.locator('.group-card', { hasText: 'Дача' }).click();
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  const settings = page.getByRole('dialog', { name: 'Настройки группы' });
  await expect(settings.getByText('Семейный чат')).toBeVisible();
  await settings.getByRole('button', { name: 'Отключить' }).click();
  await expect(page.getByText(ERR).first()).toBeVisible();
  await expect(settings.getByText('Семейный чат')).toBeVisible();
});

test('вступить по ссылке: сеть моргнула — «попробуйте ещё раз», а не «приглашение не найдено»', async ({ app: page, people }) => {
  const anya = await people('Аня');
  const g = await anya.api<{ id: number }>('POST', '/groups', { title: 'Соседи' });
  const { link } = await anya.api<{ link: string }>('POST', `/groups/${g.id}/invite`);
  const url = new URL(page.url());
  url.searchParams.set('tgStart', link.split('startapp=')[1]!);
  await page.goto(url.toString());
  await expect(page.getByRole('heading', { name: 'Соседи' })).toBeVisible();
  await page.route('**/api/invites/*/join', (r) => r.abort('failed'));
  await page.getByRole('button', { name: /Вступить/ }).click();
  await expect(page.getByText(ERR)).toBeVisible();
  await expect(page.getByText('Приглашение не найдено.')).toHaveCount(0);
  // Сеть вернулась — вступить можно с той же кнопки.
  await page.unroute('**/api/invites/*/join');
  await page.getByRole('button', { name: /Вступить/ }).click();
  await expect(page.locator('.group-header')).toBeVisible();
});

test('длинное слово в названии группы: в шапке не залезает под шестерёнку, в карточке — под аватарки', async ({ app: page, me }) => {
  const long = 'Велоклубпонедельниковичетвергов';
  await openGroup(page, me, long);
  const head = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.group-header h1')!);
    return { text: Math.round(range.getBoundingClientRect().right), gear: Math.round(document.querySelector('.group-header .icon-btn')!.getBoundingClientRect().left) };
  });
  expect(head.text, `название до ${head.text}px, шестерёнка с ${head.gear}px`).toBeLessThanOrEqual(head.gear);
  await page.keyboard.press('Escape');
  // Список групп рисуется после ухода с экрана группы — мерить карточку, когда она уже есть.
  await expect(page.locator('.group-card-title b', { hasText: long })).toBeVisible();
  const card = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.group-card-title b')!);
    return { text: Math.round(range.getBoundingClientRect().right), stack: Math.round(document.querySelector('.group-card .avatar-stack')!.getBoundingClientRect().left) };
  });
  expect(card.text, `название до ${card.text}px, аватарки с ${card.stack}px`).toBeLessThanOrEqual(card.stack);
});

test('название из одних невидимых символов: создать нельзя, переименовать — прежнее имя на экране и на сервере', async ({ app: page, me }) => {
  await goTab(page, 'Вместе');
  await page.getByRole('button', { name: 'Новая группа' }).click();
  await page.getByPlaceholder(/Как назовём/).fill('​⁠');
  await expect(page.getByRole('button', { name: 'Создать группу' })).toBeDisabled();
  await closeSheet(page);

  const id = await openGroup(page, me, 'Дача');
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  const sheet = page.getByRole('dialog', { name: 'Настройки группы' });
  await sheet.locator('input.sheet-input').fill('​​');
  await sheet.locator('input.sheet-input').press('Enter');
  await expect(sheet.getByText(ERR)).toBeVisible();
  await expect(sheet.locator('input.sheet-input')).toHaveValue('Дача');
  await closeSheet(page);
  await expect(page.locator('.group-header h1')).toHaveText('Дача');
  expect((await me.api<{ title: string }>('GET', `/groups/${id}`)).title).toBe('Дача');
});

test('«только админы» туда-сюда, ответы пришли не по порядку: на экране то же, что на сервере', async ({ app: page, me }) => {
  const id = await openGroup(page, me, 'Дача');
  let n = 0;
  let finished = 0;
  let release!: () => void;
  const first = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/groups/${id}`, async (r) => {
    if (r.request().method() !== 'PATCH') return r.fallback();
    // Первый запрос держим до второго нажатия: следующий должен ждать его ответа, без пауз по времени.
    if (++n === 1) await first;
    const response = await r.fetch();
    await r.fulfill({ response });
    finished++;
  });
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  const toggle = page.getByRole('dialog', { name: 'Настройки группы' }).locator('input.switch');
  try {
    await toggle.click();
    await expect.poll(() => n).toBe(1);
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(n, 'второй запрос ушёл, пока первый ещё не вернулся').toBe(1);
  } finally {
    release();
  }
  await expect.poll(() => finished).toBe(2);
  await expect.poll(async () => (await me.api<{ settings: { admins_only_edit: boolean } }>('GET', `/groups/${id}`)).settings.admins_only_edit).toBe(false);
  await expect(toggle).not.toBeChecked();
});

test('Enter в имени группы, потом закрыть шторку — один запрос на сервер', async ({ app: page, me }) => {
  await openGroup(page, me, 'Дача');
  const patches: string[] = [];
  page.on('request', (r) => r.method() === 'PATCH' && r.url().includes('/api/groups/') && patches.push(r.postData() ?? ''));
  await page.getByRole('button', { name: 'Настройки группы' }).click();
  const input = page.getByRole('dialog', { name: 'Настройки группы' }).locator('input.sheet-input');
  await input.fill('Дача-2');
  await input.press('Enter');
  await closeSheet(page);
  await expect(page.locator('.group-header h1')).toHaveText('Дача-2');
  await expect.poll(() => patches.length).toBeGreaterThan(0);
  expect(patches, 'переименование ушло несколько раз').toHaveLength(1);
});

test('участник группы «только админы»: кнопки «+ Дело» нет, а когда снова можно всем — есть', async ({ app: page, me, people }) => {
  const anya = await people('Аня');
  const g = await anya.api<{ id: number }>('POST', '/groups', { title: 'Строгая' });
  const { link } = await anya.api<{ link: string }>('POST', `/groups/${g.id}/invite`);
  await me.api('POST', `/invites/${link.split('startapp=g_')[1]}/join`);
  await anya.api('PATCH', `/groups/${g.id}`, { admins_only_edit: true });
  await page.reload();
  await goTab(page, 'Вместе');
  await page.locator('.group-card', { hasText: 'Строгая' }).click();
  await expect(page.locator('.group-header')).toBeVisible();
  await expect(page.locator('.fab')).toHaveCount(0);
  await anya.api('PATCH', `/groups/${g.id}`, { admins_only_edit: false });
  await page.reload();
  await goTab(page, 'Вместе');
  await page.locator('.group-card', { hasText: 'Строгая' }).click();
  await expect(page.locator('.fab')).toBeVisible();
});
