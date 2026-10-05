// Доступность каждого экрана (axe-core, правила WCAG 2.1 A/AA): контраст, подписи кнопок и полей, роли.
import AxeBuilder from '@axe-core/playwright';
import { expect, goTab, test } from './fixtures';
import { seed } from './seed';

test.beforeEach(async ({ me }) => {
  await seed(me);
});

const screens: [string, (page: import('@playwright/test').Page) => Promise<void>][] = [
  ['Сегодня', async () => {}],
  ['Календарь', async (p) => goTab(p, 'Календарь')],
  ['Вместе', async (p) => goTab(p, 'Вместе')],
  ['Я', async (p) => goTab(p, 'Я')],
  ['Чего я хочу?', async (p) => p.getByRole('button', { name: 'Добавить привычку' }).click()],
  ['редактор «Считать»', async (p) => {
    await p.getByRole('button', { name: 'Добавить привычку' }).click();
    await p.getByRole('button', { name: /Считать что-то/ }).first().click();
  }],
  ['экран привычки', async (p) => p.locator('.task', { hasText: 'Пить воду' }).locator('.task-main h2').click()],
  ['экран группы', async (p) => {
    await goTab(p, 'Вместе');
    await p.getByText('Семья').first().click();
  }],
  ['шторка дела', async (p) => p.locator('.todo-list li', { hasText: 'Купить корм Тесле' }).locator('.todo-main').click()],
  ['«Войти на Mac?»', async (p) => {
    const { link } = (await (await p.request.post('/api/desktop/login', { data: { device: 'mac' } })).json()) as { link: string };
    const url = new URL(p.url());
    url.searchParams.set('tgStart', new URL(link).searchParams.get('startapp')!);
    await p.goto(url.toString());
    await expect(p.getByRole('heading', { name: 'Войти на Mac?' })).toBeVisible();
  }],
  ['друзья и заявки', async (p) => {
    await goTab(p, 'Вместе');
    await p.getByRole('radio', { name: 'Друзья' }).click();
    await p.getByRole('button', { name: 'Позвать друга' }).click();
  }],
];

for (const [name, open] of screens) {
  test(`доступность: «${name}»`, async ({ app: page }) => {
    await open(page);
    // Контраст axe не считает поверх градиента (цветные пятна фона): на время проверки фон — ровный, того же цвета.
    await page.addStyleTag({ content: 'body { background: var(--bg) !important; }' });
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('[id^="tg-mock"]').analyze();
    const found = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} — ${n.any.map((a) => a.message).join('; ')}`).join(' | ')}`);
    expect(found, `нарушения доступности на «${name}»`).toEqual([]);
    // Не оценённое axe — только то, что он принципиально не умеет (иконки, однобуквенная подпись, перекрытие при
    // прокрутке); фон-градиент выше заменён ровным, поэтому «не смог из-за градиента» — уже ошибка.
    const unsure = res.incomplete
      .filter((i) => i.id === 'color-contrast')
      .flatMap((i) => i.nodes.filter((n) => n.any.some((a) => /gradient/i.test(a.message))).map((n) => n.target.join(' ')));
    expect(unsure, `контраст не оценён на «${name}»`).toEqual([]);
  });
}
