// Сайт lifecommit.app: лендинг и документы без языка в адресе (решение владелицы 04.10.2026). Корень — лендинг,
// мини-апп — /app/; запуск из Telegram на корне встроенный скрипт отправляет в мини-апп (src/site/route.ts), язык
// выбирает Worker (worker/site.ts). Здесь — как это видит человек: язык, старые адреса /ru/ и /en/, Telegram,
// тема по системе и переключатель, примеры групп, голос «себе и в группу», кнопки, документы, ширина
// экрана, доступность и эталон первого экрана. Тест идёт без Telegram-подмены: сайт — обычная страница.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page, tgTheme }) => {
  await page.emulateMedia({ colorScheme: tgTheme });
});

/** Ничего не шире экрана: страница не листается вбок. */
async function noSideScroll(page: Page) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(extra, 'страница шире экрана').toBeLessThanOrEqual(0);
}

/** Путь адреса страницы. */
const path = (page: Page) => new URL(page.url()).pathname;

test('браузер на корне без Telegram — лендинг на русском прямо на корне, кнопки под устройство', async ({ page, tgPlatform }) => {
  await page.goto('/');
  await expect.poll(() => path(page)).toBe('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Привычки, дела, цели и календарь в одном месте');
  // на первом экране кнопок скачивания нет (решение владелицы 04.10): есть «Скачать» в шапке, кнопки — внизу
  await expect(page.locator('.hero').getByRole('link')).toHaveCount(0);
  const final = page.locator('#download');
  await expect(final.getByRole('link', { name: /Открыть в\s*Telegram/ })).toHaveAttribute('href', 'https://t.me/LifeCommit_bot');
  // на iPhone — App Store, на Android — Google Play; второй стор спрятан
  const mine = final.getByRole('link', { name: tgPlatform === 'ios' ? /App Store/ : /Google Play/ });
  const other = final.locator(tgPlatform === 'ios' ? '.store.play' : '.store.apple');
  await expect(mine).toBeVisible();
  await expect(other).toBeHidden();
  await noSideScroll(page);
});

test('метки рекламы остаются в адресе лендинга', async ({ page }) => {
  await page.goto('/?utm_source=threads');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Привычки, дела, цели и календарь в одном месте');
  expect(page.url()).toMatch(/\/\?utm_source=threads$/);
});

test('старые адреса /ru/ и /en/ ведут на те же страницы без языка и запоминают язык', async ({ page }) => {
  await page.goto('/en/');
  await expect.poll(() => path(page)).toBe('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Habits, to-dos, goals and calendar in one place');
  await page.goto('/ru/privacy/');
  await expect.poll(() => path(page)).toBe('/privacy/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Политика конфиденциальности');
  // русский запомнился: корень снова по-русски, хотя до этого выбрали английский
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});

test.describe('английский браузер', () => {
  test.use({ locale: 'en-US' });
  test('корень — английский лендинг, адрес без языка', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => path(page)).toBe('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Habits, to-dos, goals and calendar in one place');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await noSideScroll(page);
  });
  test('запуск из Telegram и с английского лендинга уходит в мини-апп', async ({ page }) => {
    await page.goto('/?join=abc#tgWebAppPlatform=ios&tgWebAppVersion=8.0');
    await expect.poll(() => path(page)).toBe('/app/');
    const u = new URL(page.url());
    expect(u.search).toBe('?join=abc');
    expect(u.hash).toBe('#tgWebAppPlatform=ios&tgWebAppVersion=8.0');
  });
});

test.describe('запуск из Telegram на корне — в мини-апп /app/', () => {
  test('параметры запуска в «#» (и старые кнопки бота с ?join=) переезжают целиком', async ({ page }) => {
    await page.goto('/?join=abc#tgWebAppPlatform=ios&tgWebAppVersion=8.0');
    await expect.poll(() => path(page)).toBe('/app/');
    const u = new URL(page.url());
    expect(u.search).toBe('?join=abc');
    expect(u.hash).toBe('#tgWebAppPlatform=ios&tgWebAppVersion=8.0');
  });

  test('после перезагрузки: параметры, сохранённые SDK', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('tapps/launchParams', '"tgWebAppPlatform=ios"'));
    await page.goto('/');
    await expect.poll(() => path(page)).toBe('/app/');
  });

  test('ссылка, открытая во встроенном браузере Telegram (есть мост, нет параметров запуска), — лендинг', async ({ page }) => {
    // так корень раньше оставался мини-аппом без данных запуска и не работал
    await page.addInitScript(() => {
      (window as unknown as { TelegramWebviewProxy: unknown }).TelegramWebviewProxy = { postEvent: () => {} };
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Привычки, дела, цели и календарь в одном месте');
    await expect.poll(() => path(page)).toBe('/');
  });
});

test('тема — по системе, переключатель её меняет и запоминает', async ({ page, tgTheme }) => {
  await page.goto('/');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = 'rgb(10, 15, 12)';
  const light = 'rgb(246, 244, 238)';
  await expect.poll(bg).toBe(tgTheme === 'dark' ? dark : light);
  await page.locator('.site-top [data-theme-toggle]').click();
  await expect.poll(bg).toBe(tgTheme === 'dark' ? light : dark);
  await page.reload();
  await expect.poll(bg).toBe(tgTheme === 'dark' ? light : dark);
  // экраны в телефонах — в той же теме
  await expect(page.locator('#heroPh .app')).toHaveClass(tgTheme === 'dark' ? /^(?!.*\bdark\b)/ : /\bdark\b/);
});

test('голос: одна фраза — и себе, и в группу', async ({ page }) => {
  await page.goto('/');
  const voice = page.locator('#voiceApp');
  await voice.scrollIntoViewIfNeeded();
  await expect(voice.locator('.v-title')).toHaveText('Нашлось 3');
  await expect(voice.locator('.vsec')).toHaveText(['В группу «Работа»', 'Себе']);
  await expect(voice.locator('.vrow b')).toHaveText(['Подготовить отчёт', 'Позвонить в банк', 'Пить воду']);
  await expect(page.locator('#voiceText')).toContainText('ответом в чате группы');
});

test.describe('с анимацией', () => {
  // по умолчанию тесты идут с «уменьшить движение», а там телефон не прилипает и всё сразу в конечном виде
  test.use({ reducedMotion: 'no-preference' });

test('голос на телефоне: экран прилипает под шапкой, шаги над ним идут вместе с ним', async ({ page }) => {
  await page.goto('/');
  const ph = page.locator('#voicePh');
  const steps = ph.locator('.steps-m span');
  await expect(steps).toHaveText(['Слушаю', 'Разбираю', 'Нашлось 3']);
  // доводим телефон до места прилипания и листаем дальше — он остаётся на том же месте под шапкой
  const stuckAt = await ph.evaluate((el) => parseFloat(getComputedStyle(el).top));
  const box = await ph.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), box - stuckAt + 200);
  await expect.poll(() => ph.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(Math.round(stuckAt));
  await expect(page.locator('#voiceApp .v-title')).toHaveText('Слушаю');
  await expect(steps.nth(0)).toHaveClass(/\bon\b/);
  // целиком в экране: шаги над телефоном и низ телефона видны
  await expect(steps.nth(0)).toBeInViewport({ ratio: 1 });
  await expect(ph.locator('.phone')).toBeInViewport({ ratio: 1 });
  // долистали — разобрано, горит последний шаг, а телефон всё ещё на месте
  await page.evaluate((y) => window.scrollTo(0, y + window.innerHeight * 0.85), box - stuckAt);
  await expect(page.locator('#voiceApp .v-title')).toHaveText('Нашлось 3');
  await expect(steps.nth(2)).toHaveClass(/\bon\b/);
  await expect(steps.nth(0)).toHaveClass(/\bdone\b/);
  expect(Math.round(await ph.evaluate((el) => el.getBoundingClientRect().top))).toBe(Math.round(stuckAt));
  await noSideScroll(page);
});

test.describe('узкий телефон, английский', () => {
  test.use({ viewport: { width: 320, height: 820 } });
  test('прилипший телефон «Голоса» и шаги над ним не шире экрана', async ({ page }) => {
    await page.goto('/lang/en?to=/');
    const ph = page.locator('#voicePh');
    const stuckAt = await ph.evaluate((el) => parseFloat(getComputedStyle(el).top));
    const box = await ph.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y), box - stuckAt + 200);
    await expect.poll(() => ph.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(Math.round(stuckAt));
    // каждая пилюля шагов и телефон целиком по ширине внутри экрана с полями 16px
    const sides = await page.evaluate(() => [...document.querySelectorAll('#voicePh .steps-m span, #voicePh .phone')].map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
    for (const [l, r] of sides) {
      expect(l, 'левый край в поле экрана').toBeGreaterThanOrEqual(16);
      expect(r, 'правый край в поле экрана').toBeLessThanOrEqual(320 - 16);
    }
    await noSideScroll(page);
  });
});

test('«уменьшить движение» выключено — заголовки сцен выезжают и остаются целыми', async ({ page }) => {
  await page.goto('/');
  const h2 = page.getByRole('heading', { name: 'Дела и календарь в одном списке' });
  await h2.scrollIntoViewIfNeeded();
  // после появления строки собраны обратно: заголовок — обычный текст, без обёрток анимации
  await expect(h2.locator('.ln')).toHaveCount(0);
  await expect(h2).toBeInViewport();
  await expect(page.locator('#calendar .copy p').first()).toHaveCSS('opacity', '1');
});
});

test('«Вместе»: примеры групп — работа, семья, друзья — и чат Telegram рядом', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('group', { name: 'Примеры групп' });
  await tabs.scrollIntoViewIfNeeded();
  const phone = page.locator('#groupApp');
  const chat = page.locator('#chat');
  await expect(tabs.getByRole('button', { name: 'Работа' })).toHaveAttribute('aria-pressed', 'true');
  await expect(phone.locator('h1')).toHaveText('Работа');
  await expect(chat).toContainText('Сегодня в «Работе»');
  await tabs.getByRole('button', { name: 'Семья' }).click();
  await expect(phone.locator('h1')).toHaveText('Семья');
  await expect(chat).toContainText('Сегодня в «Семье»');
  await expect(tabs.getByRole('button', { name: 'Семья' })).toHaveAttribute('aria-pressed', 'true');
  await tabs.getByRole('button', { name: 'Друзья' }).click();
  await expect(phone.locator('h1')).toHaveText('Поход');
  await expect(chat).toContainText('Сегодня в «Походе»');
  await expect(page.locator('.tg-note')).toContainText('в чате группы в Telegram');
  // на телефоне переключатель групп сразу над телефоном, а заметка про чат — под ним, после карточки чата;
  // меряем в конце страницы, где сдвиги появления (телефон и чат выезжают при прокрутке) уже доиграли
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const below = async (a: string, b: string) => page.evaluate(([a, b]) => document.querySelector(a)!.getBoundingClientRect().top >= document.querySelector(b)!.getBoundingClientRect().bottom, [a, b]);
  expect(await below('#togetherPh', '.gtabs'), 'телефон под переключателем групп').toBe(true);
  expect(await below('.tg-note', '#chat'), 'заметка про чат под карточкой чата').toBe(true);
  await noSideScroll(page);
});

test.describe('компьютер', () => {
  // правило владелицы 04.10: лендинг проверяется и на телефоне, и на компьютере
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('первый экран без кнопок, «Вместе»: телефон слева, текст и заметка про чат справа', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero').getByRole('link')).toHaveCount(0);
    await expect(page.locator('#heroPh .phone')).toBeInViewport();
    await page.locator('#together .gtabs').scrollIntoViewIfNeeded();
    const r = (sel: string) => page.locator(sel).evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
    const [phone, tabs, note] = [await r('#togetherPh .phone'), await r('#together .gtabs'), await r('.tg-note')];
    expect(note.left, 'заметка правее телефона').toBeGreaterThanOrEqual(phone.right);
    expect(note.top, 'заметка под переключателем групп').toBeGreaterThanOrEqual(tabs.bottom);
    await noSideScroll(page);
  });
});

test('кнопка стора пока неактивна и видно, что неактивна; Telegram работает; «Скачать» ведёт к кнопкам внизу', async ({ page, tgPlatform }) => {
  await page.goto('/');
  const store = page.locator('#download').getByRole('link', { name: tgPlatform === 'ios' ? /App Store/ : /Google Play/ });
  // решение владелицы 05.10: пока приложений нет, кнопки сторов серые и неактивные, Telegram — как был
  await expect(store).toHaveAttribute('aria-disabled', 'true');
  await expect(store).toHaveAttribute('tabindex', '-1');
  expect(Number(await store.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.6);
  const tg = page.locator('#download').getByRole('link', { name: /Telegram/ });
  await expect(tg).not.toHaveAttribute('aria-disabled', 'true');
  expect(Number(await tg.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
  // неактивную кнопку Playwright сам не нажимает — жмём, как человек, который всё равно ткнул в серую кнопку
  await store.click({ force: true });
  await expect.poll(() => path(page)).toBe('/');
  await page.locator('.site-top').getByRole('link', { name: 'Скачать' }).click();
  await expect(page.getByRole('heading', { name: 'Скачайте LifeCommit' })).toBeInViewport();
});

test('документы из подвала на двух языках, переключатель языка не меняет адрес', async ({ page }) => {
  await page.goto('/');
  const foot = page.locator('.site-foot');
  await foot.getByRole('link', { name: 'Политика конфиденциальности' }).click();
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect.poll(() => path(page)).toBe('/privacy/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Политика конфиденциальности');
  await noSideScroll(page);
  await page.locator('.site-foot').getByRole('link', { name: 'Условия использования' }).click();
  await expect.poll(() => path(page)).toBe('/terms/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Условия использования');
  await noSideScroll(page);
  // переключатель на странице документа — тот же документ на другом языке
  await page.locator('.site-foot').getByRole('link', { name: 'EN' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of use');
  await expect.poll(() => path(page)).toBe('/terms/');
  await page.locator('.site-top .brand').click();
  await expect.poll(() => path(page)).toBe('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Habits, to-dos, goals and calendar in one place');
  // выбор запомнился
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('.site-foot').getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  await page.locator('.site-foot').getByRole('link', { name: 'Terms of use' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of use');
  await noSideScroll(page);
});

for (const [lang, to] of [['ru', '/'], ['en', '/'], ['ru', '/privacy/'], ['ru', '/terms/'], ['en', '/privacy/'], ['en', '/terms/']] as const) {
  test(`доступность: ${to} (${lang})`, async ({ page }) => {
    await page.goto(`/lang/${lang}?to=${to}`);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // контраст считаем по ровному фону: поле клеток, зерно, виньетка и подложки под текстом на время проверки убраны
    await page.addStyleTag({ content: '#field, .grain, .vignette { display: none !important } .copy::before, .hero-text::before { display: none !important }' });
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const found = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} — ${n.any.map((a) => a.message).join('; ')}`).join(' | ')}`);
    expect(found, `нарушения доступности на ${to} (${lang})`).toEqual([]);
  });
}

// Приглашение для приложений (worker/invites.ts): на телефоне без приложения — страница с двумя кнопками.
test('приглашение lifecommit.app/j/<код>: «Открыть в приложении» и «Открыть в Telegram», доступность, эталон', async ({ page }) => {
  await page.goto('/lang/ru?to=/');
  await page.goto('/j/abc234xyz9');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Приглашение в группу');
  await expect(page.getByRole('link', { name: 'Открыть в приложении' })).toHaveAttribute('href', 'lifecommit://join/abc234xyz9');
  await expect(page.getByRole('link', { name: 'Открыть в Telegram' })).toHaveAttribute('href', /startapp=g_abc234xyz9$/);
  await noSideScroll(page);
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'нарушения доступности').toEqual([]);
  await expect(page).toHaveScreenshot('site-invite.png');
  // Плохой код — «Ссылка не работает», без кнопок.
  await page.goto('/f/%3Cb%3E');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ссылка не работает');
  await expect(page.getByRole('link')).toHaveCount(0);
});

test.describe('компьютер: приглашение', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('приглашение в друзья на компьютере — по центру, кнопки в одну колонку', async ({ page }) => {
    await page.goto('/lang/en?to=/');
    await page.goto('/f/j8wuasb95a');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friend invitation');
    await expect(page.getByRole('link', { name: 'Open in the app' })).toHaveAttribute('href', 'lifecommit://friend/j8wuasb95a');
    await noSideScroll(page);
    await expect(page).toHaveScreenshot('site-invite-desktop.png');
  });
});

test('эталон первого экрана лендинга', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#heroPh .app .habit').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // поле клеток рисуется со случайными фазами — на снимке его нет, остальное сравнивается целиком
  await page.addStyleTag({ content: '#field { visibility: hidden !important }' });
  await expect(page).toHaveScreenshot('site-hero.png');
});

// Баг 05.10 (владелица, телефон): долистала до низа, коснулась экрана — клетки пропали, остался голый фон. Касание
// внизу раскрывает панели браузера, окно становится ниже, холст пересоздаётся пустым, а у подвала анимация стояла —
// перерисовать было некому. Здесь то же самое: низ страницы, окно ниже — клетки на холсте должны остаться.
test.describe('поле клеток внизу страницы', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('касание внизу (окно браузера стало ниже) не гасит клетки', async ({ page }) => {
    await page.goto('/');
    const foot = page.locator('.site-foot');
    await foot.scrollIntoViewIfNeeded();
    await expect(foot).toBeInViewport();
    // сколько точек холста закрашено (альфа > 0)
    const lit = () =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('#field');
        const d = c?.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        if (d) for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
        return n;
      });
    await expect.poll(lit).toBeGreaterThan(0);
    const size = page.viewportSize();
    if (!size) throw new Error('нет размера окна');
    await page.setViewportSize({ width: size.width, height: size.height - 80 });
    await expect.poll(lit).toBeGreaterThan(0);
    await page.setViewportSize(size);
    await expect.poll(lit).toBeGreaterThan(0);
  });
});
