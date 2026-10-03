// Группы: новая группа, дело «кто-то один», общая цель и вклад, удалить свайпом, настройки, удалить группу.
import { closeSheet, expect, goTab, swipeLeft, test } from './fixtures';

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
                item: { title: 'Уборка', mode: 'one', day: new Date().toISOString().slice(0, 10), time: null, rrule: 'FREQ=WEEKLY;BYDAY=SA', assignees: [], all_members: false, rotate: false, target: null, unit: null, duration_min: null },
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
});
