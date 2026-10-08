// Вкладка «Я»: карта месяца и года, настройки (что уходит на сервер), «Поделиться» и удаление аккаунта.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { SummaryItem } from '../../shared/summary';
import type { HeatDay, UserSettings } from '../../shared/types';
import type { Template } from '../share/draw';
import { ApiError } from '../api';
import { renderApp } from '../test/render';
import { Profile } from './Profile';

const m = vi.hoisted(() => ({
  api: {
    settings: vi.fn(), writeAccess: vi.fn(), deleteAccount: vi.fn(), summary: vi.fn(), blocks: vi.fn(), unblock: vi.fn(),
    desktopSessions: vi.fn(), logoutEverywhere: vi.fn(), logout: vi.fn(), feedback: vi.fn(),
  },
  desk: { desktop: false, lost: 0 },
  share: { templates: null as Template[] | null },
  tg: { popup: false, answer: 'delete' as string | null, popups: [] as unknown[], writeAccess: false, writeAnswer: 'allowed', links: [] as string[] },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));
vi.mock('../desktop/session', () => ({ isDesktop: () => m.desk.desktop, desktopToken: () => null, sessionLost: () => void m.desk.lost++ }));
vi.mock('@tma.js/sdk-react', async (orig) => {
  const real = await orig<typeof import('@tma.js/sdk-react')>();
  const show = Object.assign(
    async (p: unknown) => {
      m.tg.popups.push(p);
      return m.tg.answer;
    },
    { isAvailable: () => m.tg.popup },
  );
  const requestWriteAccess = Object.assign(async () => m.tg.writeAnswer, { isAvailable: () => m.tg.writeAccess });
  const openTelegramLink = Object.assign(() => {}, { ifAvailable: (url: string) => void m.tg.links.push(url), isAvailable: () => true });
  return { ...real, popup: { ...real.popup, show }, requestWriteAccess, openTelegramLink };
});
vi.mock('../share/ShareSheet', async () => {
  const { createElement } = await import('react');
  return {
    ShareSheet: ({ templates, onClose }: { templates: Template[]; onClose: () => void }) => {
      m.share.templates = templates;
      return createElement('button', { onClick: onClose }, 'Закрыть «Поделиться»');
    },
  };
});

const TODAY = '2026-10-03';
const user = (patch: Partial<UserSettings> = {}): UserSettings => ({
  id: 1, first_name: 'Даша', username: 'dasha', photo_url: null, language_code: 'ru', timezone: 'Europe/Moscow', day_start_hour: 4,
  remind_morning: null, remind_evening: null, bot_chat_ok: true, premium: false, ...patch,
});
const days: HeatDay[] = [
  { day: '2025-12-31', score: 1 },
  { day: '2026-09-15', score: 3 },
  { day: '2026-10-01', score: 1 },
  { day: '2026-10-02', score: 0 },
  { day: '2026-10-03', score: 2 },
];
const items: SummaryItem[] = [
  { id: 1, title: 'Вода', kind: 'count', unit: 'стаканов', total: 1240, months: [] },
  { id: 2, title: 'Отжимания', kind: 'count', unit: null, total: 50, months: [] },
  { id: 3, title: 'Спорт', kind: 'check', unit: null, total: 3, months: [] },
  { id: 4, title: 'Не курить', kind: 'abstain', unit: null, total: 5, months: [] },
];

async function setup(patch: Partial<UserSettings> = {}, lang: 'ru' | 'en' = 'ru') {
  const props = { onUser: vi.fn(), onTheme: vi.fn() };
  await renderApp(<Profile user={user(patch)} heat={{ today: TODAY, days }} theme="light" {...props} />, lang);
  return props;
}
const share = async () => {
  await page.getByRole('button', { name: 'Поделиться' }).click();
  return m.share.templates!;
};

beforeEach(() => {
  for (const f of Object.values(m.api)) f.mockReset();
  m.api.settings.mockImplementation(async (patch: Partial<UserSettings>) => user(patch));
  m.api.writeAccess.mockResolvedValue({ ok: true });
  m.api.summary.mockResolvedValue([]);
  m.api.blocks.mockResolvedValue([]);
  m.api.unblock.mockResolvedValue({ ok: true });
  m.api.desktopSessions.mockResolvedValue([]);
  m.api.logoutEverywhere.mockResolvedValue({ ok: true });
  m.api.logout.mockResolvedValue({ ok: true });
  Object.assign(m.desk, { desktop: false, lost: 0 });
  m.share.templates = null;
  Object.assign(m.tg, { popup: false, answer: 'delete', popups: [], writeAccess: false, writeAnswer: 'allowed', links: [] });
});

describe('шапка и карта', () => {
  it('имя, ник и буква вместо фото; без ника — без строки ника', async () => {
    await setup();
    await expect.element(page.getByRole('heading', { name: 'Даша' })).toBeVisible();
    await expect.element(page.getByText('@dasha')).toBeVisible();
    expect(document.querySelector('.profile-head .avatar')!.textContent).toBe('Д');
  });

  // 04.10.2026 (/lc-explore): имя «🦊 Лиса» давало в кружке половинку эмодзи («�»).
  it('имя начинается с эмодзи — в кружке эмодзи целиком', async () => {
    await setup({ first_name: '\u{1F98A} Лиса' });
    await expect.element(page.getByRole('heading', { name: '\u{1F98A} Лиса' })).toBeVisible();
    expect(document.querySelector('.profile-head .avatar')!.textContent).toBe('\u{1F98A}');
  });

  // Имя из одних невидимых символов («ㅤ») сервер чистит до пустой строки — пустой кружок и пустой заголовок.
  it('имя пустое — вместо него ник; нет и ника — «Я»', async () => {
    await setup({ first_name: '', username: 'dasha' });
    await expect.element(page.getByRole('heading', { name: '@dasha' })).toBeVisible();
    expect(document.querySelector('.profile-head .avatar')!.textContent).toBe('D');
    expect(page.getByText('@dasha').elements()).toHaveLength(1);
    await setup({ first_name: '', username: null });
    await expect.element(page.getByRole('heading', { name: 'Я', exact: true })).toBeVisible();
    expect(document.querySelectorAll('.profile-head .avatar')[1]!.textContent).toBe('Я');
  });

  it('фото из Telegram — картинкой', async () => {
    await setup({ photo_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', username: null });
    expect(document.querySelector('.profile-head img.avatar')).not.toBeNull();
    await expect.element(page.getByText(/^@/)).not.toBeInTheDocument();
  });

  it('месяц: активные дни, листать назад до 11 месяцев, вперёд — не дальше текущего', async () => {
    await setup();
    await expect.element(page.getByText('октябрь 2026')).toBeVisible();
    await expect.element(page.getByText('2 активных дня')).toBeVisible();
    const prev = page.getByRole('button', { name: 'Предыдущий месяц' });
    const next = page.getByRole('button', { name: 'Следующий месяц' });
    await expect.element(next).toBeDisabled();
    await prev.click();
    await expect.element(page.getByText('сентябрь 2026')).toBeVisible();
    await expect.element(page.getByText('1 активный день')).toBeVisible();
    expect(m.api.summary).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    for (let i = 0; i < 10; i++) await prev.click();
    await expect.element(page.getByText('ноябрь 2025')).toBeVisible();
    await expect.element(prev).toBeDisabled();
    await next.click();
    await expect.element(page.getByText('декабрь 2025')).toBeVisible();
  });

  it('год: период карты года и все активные дни, стрелок нет', async () => {
    await setup();
    expect(m.api.summary).toHaveBeenCalledWith('2026-10-01', TODAY);
    expect(m.api.summary).toHaveBeenCalledWith('2026-01-01', TODAY);
    await page.getByRole('button', { name: 'Год' }).click();
    await expect.element(page.getByText('сент 2025 — окт 2026')).toBeVisible();
    await expect.element(page.getByText('4 активных дня')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Предыдущий месяц' })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Месяц' }).click();
    await expect.element(page.getByText('октябрь 2026')).toBeVisible();
  });
});

describe('«Поделиться»', () => {
  it('без отметок за период — только месяц и год картой', async () => {
    await setup();
    const t = await share();
    expect(t.map((x) => x.kind)).toEqual(['month-heat', 'month-dark', 'year', 'year-dark']);
    expect(t[0]).toMatchObject({ big: '2 дня', caption: 'работы над собой в октябре', lead: 3 });
    expect((t[0] as { levels: number[] }).levels.slice(0, 4)).toEqual([2, 0, 2, 0]);
    expect(t[1]).toMatchObject({ title: 'Октябрь 2026', big: '2', caption: 'дня работы над собой' });
    expect(t[2]).toMatchObject({ big: '3 дня', caption: 'работы над собой в 2026' });
    expect((t[2] as { months: { name: string }[] }).months.map((x) => x.name).slice(0, 3)).toEqual(['янв', 'февр', 'март']);
    expect(t[3]).toMatchObject({ big: '3', caption: 'дня работы над собой' });
    await page.getByRole('button', { name: 'Закрыть «Поделиться»' }).click();
    await expect.element(page.getByRole('button', { name: 'Закрыть «Поделиться»' })).not.toBeInTheDocument();
  });

  it('итог по целям — четыре картинки месяца и одна года; единицы по видам', async () => {
    m.api.summary.mockResolvedValue(items);
    await setup();
    await expect.poll(() => m.api.summary.mock.calls.length).toBe(2);
    const t = await share();
    expect(t.map((x) => x.kind)).toEqual(['month-heat', 'month-dark', 'sum-list', 'sum-poster', 'sum-bento', 'sum-neon', 'year', 'year-dark', 'sum-year']);
    expect(t[2]).toMatchObject({ title: 'Мой октябрь' });
    expect(t[3]).toMatchObject({ title: 'Октябрь' });
    expect((t[2] as { rows: unknown[] }).rows).toEqual([
      { n: new Intl.NumberFormat('ru-RU').format(1240), u: 'стаканов', t: 'Вода', months: [] },
      { n: '50', u: '', t: 'Отжимания', months: [] },
      { n: '3', u: 'раза', t: 'Спорт', months: [] },
      { n: '5', u: 'дней без', t: 'Не курить', months: [] },
    ]);
  });

  it('открыт «Год» — картинки года первыми', async () => {
    await setup();
    await page.getByRole('button', { name: 'Год' }).click();
    const t = await share();
    expect(t.map((x) => x.kind)).toEqual(['year', 'year-dark', 'month-heat', 'month-dark']);
  });

  it('итог месяца ещё не пришёл для открытого месяца — картинок итога нет; ответ для ушедшего месяца не применяется', async () => {
    let resolveOct!: (v: SummaryItem[]) => void;
    m.api.summary.mockImplementation((from: string) => (from === '2026-10-01' ? new Promise((r) => (resolveOct = r)) : Promise.reject(new Error('сеть'))));
    await setup();
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect.element(page.getByText('сентябрь 2026')).toBeVisible();
    resolveOct(items);
    const t = await share();
    expect(t.map((x) => x.kind)).toEqual(['month-heat', 'month-dark', 'year', 'year-dark']);
    expect(t[0]).toMatchObject({ caption: 'работы над собой в сентябре' });
  });
});

describe('настройки', () => {
  it('напоминание: выключено → «Готово» включает на 21:00; включённое можно выключить', async () => {
    const { onUser } = await setup();
    await page.getByRole('button', { name: /Напоминание/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Готово' }).click();
    expect(m.api.settings).toHaveBeenCalledWith({ remind_evening: '21:00' });
    await expect.poll(() => onUser.mock.calls.length).toBe(1);
    expect(onUser.mock.calls[0]![0]).toMatchObject({ remind_evening: '21:00' });
  });

  it('включённое напоминание — «Выключить»', async () => {
    await setup({ remind_evening: '20:30' });
    await expect.element(page.getByRole('button', { name: /Напоминание/ })).toMatchTextContent(/20:30/);
    await page.getByRole('button', { name: /Напоминание/ }).click();
    await page.getByRole('button', { name: 'Выключить' }).click();
    expect(m.api.settings).toHaveBeenCalledWith({ remind_evening: null });
  });

  it('конец дня: выбрать час на барабане — уходит числом', async () => {
    await setup();
    await page.getByRole('button', { name: /День заканчивается/ }).click();
    const hours = page.getByRole('listbox', { name: 'Часы' });
    // Прямо по элементу: «06» за краем барабана, клик Playwright сам докручивает список, барабан с scroll-snap сдвигается,
    // и под нагрузкой клик по координатам попадал в соседнюю строку (тот же случай, что в Picker.test).
    (hours.getByRole('option', { name: '06' }).element() as HTMLElement).click();
    await expect.element(hours.getByRole('option', { name: '06' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('dialog').getByRole('button', { name: 'Готово' }).click();
    expect(m.api.settings).toHaveBeenCalledWith({ day_start_hour: 6 });
  });

  it('язык — через шторку выбора; переключателя «Приватность профиля» больше нет', async () => {
    await setup();
    expect(page.getByRole('button', { name: /Приватность профиля/ }).elements()).toEqual([]);
    await page.getByRole('button', { name: /Язык/ }).click();
    await page.getByRole('option', { name: 'English' }).click();
    expect(m.api.settings).toHaveBeenCalledWith({ language_code: 'en' });
  });

  it('язык не русский — показан английский', async () => {
    await setup({ language_code: 'en' }, 'en');
    await expect.element(page.getByRole('button', { name: /Language/ })).toMatchTextContent(/English/);
  });

  it('тёмная тема отмечена', async () => {
    await renderApp(<Profile user={user()} heat={{ today: TODAY, days }} theme="dark" onUser={() => {}} onTheme={() => {}} />);
    await expect.element(page.getByRole('radio', { name: 'Тёмная' })).toHaveAttribute('aria-checked', 'true');
    await expect.element(page.getByRole('radio', { name: 'Светлая' })).toHaveAttribute('aria-checked', 'false');
  });

  it('тема: светлая и тёмная', async () => {
    const { onTheme } = await setup();
    await expect.element(page.getByRole('radio', { name: 'Светлая' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Тёмная' }).click();
    await page.getByRole('radio', { name: 'Светлая' }).click();
    expect(onTheme.mock.calls).toEqual([['dark'], ['light']]);
  });

  it('настройка не сохранилась — сообщение об ошибке', async () => {
    m.api.settings.mockRejectedValue(new Error('сеть'));
    const { onUser } = await setup();
    await page.getByRole('button', { name: /Язык/ }).click();
    await page.getByRole('option', { name: 'English' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    expect(onUser).not.toHaveBeenCalled();
  });

  // 04.10.2026 (/lc-explore): после удачной повторной попытки красная строка оставалась.
  it('настройка не сохранилась, повтор удался — ошибки больше нет', async () => {
    m.api.settings.mockRejectedValueOnce(new Error('сеть'));
    await setup();
    await page.getByRole('button', { name: /Язык/ }).click();
    await page.getByRole('option', { name: 'English' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await page.getByRole('button', { name: /Язык/ }).click();
    await page.getByRole('option', { name: 'English' }).click();
    await expect.poll(() => m.api.settings.mock.calls.length).toBe(2);
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
  });

  it('разблокировали последнего — шторка закрывается, а не остаётся пустой', async () => {
    m.api.blocks.mockResolvedValue([{ id: 5, first_name: 'Тимур', username: 'timur', photo_url: null }]);
    await setup();
    await page.getByRole('button', { name: /Заблокированные/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Заблокированные' });
    await sheet.getByRole('button', { name: 'Разблокировать' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Заблокированные/ })).not.toBeInTheDocument();
  });

  it('разблокировать двоих подряд, обоим сервер отказал — оба на своих местах, по порядку', async () => {
    m.api.blocks.mockResolvedValue([
      { id: 5, first_name: 'Тимур', username: null, photo_url: null },
      { id: 6, first_name: 'Аня', username: null, photo_url: null },
    ]);
    const fails: Record<number, () => void> = {};
    m.api.unblock.mockImplementation((id: number) => new Promise((_, reject) => (fails[id] = () => reject(new Error('сеть')))));
    await setup();
    await page.getByRole('button', { name: /Заблокированные/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Заблокированные' });
    await sheet.getByRole('button', { name: 'Разблокировать' }).first().click();
    await expect.element(sheet.getByText('Тимур')).not.toBeInTheDocument();
    await sheet.getByRole('button', { name: 'Разблокировать' }).first().click();
    await expect.element(sheet.getByText('Аня')).not.toBeInTheDocument();
    // Ещё ждём сервер — шторка не закрывается, хотя список пуст.
    await expect.element(sheet).toBeVisible();
    fails[5]!();
    await expect.element(sheet.getByText('Тимур')).toBeVisible();
    fails[6]!();
    await expect.element(sheet.getByText('Аня')).toBeVisible();
    expect([...document.querySelectorAll('.person-row b')].map((b) => b.textContent)).toEqual(['Тимур', 'Аня']);
    await expect.element(sheet.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
  });

  it('заблокированные: строки нет, пока никого; есть — список и «Разблокировать»', async () => {
    await setup();
    await expect.element(page.getByRole('button', { name: /Язык/ })).toBeVisible();
    expect(page.getByRole('button', { name: /Заблокированные/ }).elements()).toEqual([]);
  });

  it('заблокированных можно разблокировать по одному', async () => {
    m.api.blocks.mockResolvedValue([
      { id: 5, first_name: 'Тимур', username: 'timur', photo_url: null },
      { id: 6, first_name: 'Аня', username: null, photo_url: null },
    ]);
    await setup();
    await page.getByRole('button', { name: /Заблокированные/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Заблокированные' });
    await expect.element(sheet.getByText('@timur')).toBeVisible();
    await sheet.getByRole('button', { name: 'Разблокировать' }).first().click();
    expect(m.api.unblock).toHaveBeenCalledWith(5);
    await expect.element(sheet.getByText('Тимур')).not.toBeInTheDocument();
    // Сервер не разблокировал — человек возвращается в список, в шторке строка ошибки (04.10.2026: раньше уходил молча).
    m.api.unblock.mockRejectedValue(new Error('сеть'));
    await sheet.getByRole('button', { name: 'Разблокировать' }).click();
    await expect.element(sheet.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(sheet.getByText('Аня')).toBeVisible();
    // Тап по ошибке её убирает; повтор удался — строка уходит, ошибки нет.
    await sheet.getByText('Что-то пошло не так. Попробуй ещё раз.').click();
    await expect.element(sheet.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
    m.api.unblock.mockResolvedValue({ ok: true });
    await sheet.getByRole('button', { name: 'Разблокировать' }).click();
    await expect.element(sheet.getByText('Аня')).not.toBeInTheDocument();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('список заблокированных не загрузился — строки нет', async () => {
    m.api.blocks.mockRejectedValue(new Error('сеть'));
    await setup();
    await expect.element(page.getByRole('button', { name: /Язык/ })).toBeVisible();
    expect(page.getByRole('button', { name: /Заблокированные/ }).elements()).toEqual([]);
  });

  it('«Поддержать проект» открывает страницу донатов в Telegram', async () => {
    await setup();
    await page.getByRole('button', { name: /Поддержать проект/ }).click();
    expect(m.tg.links).toEqual(['https://t.me/tribute/app?startapp=dRk2']);
  });
});

describe('бот и аккаунт', () => {
  it('боту уже можно писать — строки «Разрешить» нет', async () => {
    await setup();
    await expect.element(page.getByRole('button', { name: /Разрешить боту напоминать/ })).not.toBeInTheDocument();
  });

  it('вне Telegram «Разрешить боту» ничего не делает', async () => {
    const { onUser } = await setup({ bot_chat_ok: false });
    await page.getByRole('button', { name: /Разрешить боту напоминать/ }).click();
    expect(m.api.writeAccess).not.toHaveBeenCalled();
    expect(onUser).not.toHaveBeenCalled();
  });

  it('разрешили — сервер знает, строка пропадает; отказали — ничего', async () => {
    m.tg.writeAccess = true;
    m.tg.writeAnswer = 'rejected';
    const { onUser } = await setup({ bot_chat_ok: false });
    const allow = page.getByRole('button', { name: /Разрешить боту напоминать/ });
    await allow.click();
    expect(m.api.writeAccess).not.toHaveBeenCalled();
    m.tg.writeAnswer = 'allowed';
    await allow.click();
    await expect.poll(() => onUser.mock.calls.length).toBe(1);
    expect(m.api.writeAccess).toHaveBeenCalled();
    expect(onUser.mock.calls[0]![0]).toMatchObject({ bot_chat_ok: true });
  });

  // 04.10.2026 (/lc-explore): отказ сервера уходил в необработанную ошибку, на экране — ничего.
  it('«Удалить аккаунт» не вышло — сказано почему; связанный аккаунт — отдельным текстом', async () => {
    m.tg.popup = true;
    m.api.deleteAccount.mockRejectedValueOnce(new ApiError(403, 'linked_account')).mockRejectedValueOnce(new Error('сеть'));
    await setup();
    const del = page.getByRole('button', { name: 'Удалить аккаунт' });
    await del.click();
    await expect.element(page.getByText('Удалить аккаунт можно только из того Telegram, в котором он создан.')).toBeVisible();
    await del.click();
    await expect.poll(() => m.api.deleteAccount.mock.calls.length).toBe(2);
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText('Удалить аккаунт можно только из того Telegram, в котором он создан.')).not.toBeInTheDocument();
  });

  it.each([
    { lang: 'ru' as const, button: 'Удалить аккаунт', message: 'Удалить аккаунт можно в Telegram или в приложении LifeCommit на телефоне.' },
    { lang: 'en' as const, button: 'Delete account', message: 'You can delete your account in Telegram or in the LifeCommit app on your phone.' },
  ])('$lang: telegram_only — сказано, где можно удалить аккаунт', async ({ lang, button, message }) => {
    m.tg.popup = true;
    m.api.deleteAccount.mockRejectedValue(new ApiError(403, 'telegram_only'));
    await setup({}, lang);
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect.element(page.getByText(message, { exact: true })).toBeVisible();
    expect(m.api.deleteAccount).toHaveBeenCalledOnce();
  });

  it('EN: linked_account — отдельная причина отказа', async () => {
    m.tg.popup = true;
    m.api.deleteAccount.mockRejectedValue(new ApiError(403, 'linked_account'));
    await setup({}, 'en');
    await page.getByRole('button', { name: 'Delete account', exact: true }).click();
    await expect.element(page.getByText('You can delete the account only from the Telegram account it was created in.', { exact: true })).toBeVisible();
  });

  it('«Удалить аккаунт»: вне Telegram — ничего; «Отмена» — ничего; подтвердили — удаляем', async () => {
    m.api.deleteAccount.mockReturnValue(new Promise(() => {})); // после удаления страница перезагружается — в тесте не доходим
    await setup();
    const del = page.getByRole('button', { name: 'Удалить аккаунт' });
    await del.click();
    expect(m.tg.popups).toEqual([]);
    m.tg.popup = true;
    m.tg.answer = null;
    await del.click();
    await expect.poll(() => m.tg.popups.length).toBe(1);
    expect(m.tg.popups[0]).toMatchObject({ message: 'Удалить аккаунт и все данные без возможности восстановления?' });
    expect(m.api.deleteAccount).not.toHaveBeenCalled();
    m.tg.answer = 'delete';
    await del.click();
    await expect.poll(() => m.api.deleteAccount.mock.calls.length).toBe(1);
  });
});

describe('«Сообщить о проблеме»', () => {
  it('строка внизу открывает шторку жалобы, тема уходит в контекст; закрыли — шторки нет', async () => {
    m.api.feedback.mockResolvedValue(undefined);
    await setup();
    await page.getByRole('button', { name: 'Сообщить о проблеме' }).click();
    const sheet = page.getByRole('dialog', { name: 'Что случилось?' });
    await expect.element(sheet).toBeVisible();
    await sheet.getByRole('textbox', { name: 'Что случилось?' }).fill('Не листается');
    await sheet.getByRole('button', { name: 'Отправить' }).click();
    await page.getByRole('button', { name: 'Готово' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(m.api.feedback).toHaveBeenCalledWith('Не листается', expect.objectContaining({ theme: 'light', screen: 'me' }), []);
  });
});

describe('устройства (вход на Mac, в браузере и в приложениях на телефоне)', () => {
  const mac = { id: 2, device: 'mac', created_at: '2026-10-05T09:00:00Z', last_used_at: '2026-10-05T09:00:00Z', current: false };

  it('в Telegram: нигде не входили — строки нет; входили (компьютер, телефон) — «Устройства» с числом', async () => {
    await setup();
    await expect.element(page.getByText('Тема')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Устройства/ })).not.toBeInTheDocument();
    m.api.desktopSessions.mockResolvedValue([mac, { ...mac, id: 3, device: 'web' }, { ...mac, id: 4, device: 'ios' }]);
    await setup();
    await expect.element(page.getByRole('button', { name: /Устройства\s*3/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Выйти на этом устройстве' })).not.toBeInTheDocument();
  });

  it('«Выйти везде»: «Отмена» — ничего; подтвердили — сервер выходит, строка пропадает; не вышло — ошибка', async () => {
    m.api.desktopSessions.mockResolvedValue([mac]);
    m.tg.popup = true;
    m.tg.answer = null;
    await setup();
    const row = page.getByRole('button', { name: /Устройства/ });
    await row.click();
    await expect.poll(() => m.tg.popups.length).toBe(1);
    expect(m.tg.popups[0]).toMatchObject({ message: 'Выйти из LifeCommit на всех устройствах?', buttons: [{ id: 'out', type: 'destructive', text: 'Выйти везде' }, { type: 'cancel' }] });
    expect(m.api.logoutEverywhere).not.toHaveBeenCalled();

    m.tg.answer = 'out';
    m.api.logoutEverywhere.mockRejectedValueOnce(new Error('offline'));
    await row.click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(row).toBeVisible();

    await row.click();
    await expect.element(row).not.toBeInTheDocument();
    expect(m.api.logoutEverywhere).toHaveBeenCalledTimes(2);
  });

  it('список устройств не загрузился — строки нет, сбой виден в консоли', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.api.desktopSessions.mockRejectedValue(new Error('offline'));
    await setup();
    await expect.poll(() => warn.mock.calls.length).toBe(1);
    expect(warn).toHaveBeenCalledWith('desktop sessions failed', expect.any(Error));
    await expect.element(page.getByRole('button', { name: /Устройства/ })).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it('без подтверждений Telegram «Устройства» ничего не делает', async () => {
    m.api.desktopSessions.mockResolvedValue([mac]);
    await setup();
    await page.getByRole('button', { name: /Устройства/ }).click();
    expect(m.api.logoutEverywhere).not.toHaveBeenCalled();
  });

  it('на компьютере: списка устройств нет, есть «Выйти на этом компьютере» — с подтверждением', async () => {
    m.desk.desktop = true;
    m.tg.popup = true;
    m.tg.answer = null;
    await setup();
    const out = page.getByRole('button', { name: 'Выйти на этом устройстве' });
    // удалить аккаунт — только из Telegram
    await expect.element(page.getByRole('button', { name: 'Удалить аккаунт' })).not.toBeInTheDocument();
    await out.click();
    await expect.poll(() => m.tg.popups.length).toBe(1);
    expect(m.tg.popups[0]).toMatchObject({ message: 'Выйти из LifeCommit на этом устройстве?' });
    expect(m.api.logout).not.toHaveBeenCalled();
    expect(m.api.desktopSessions).not.toHaveBeenCalled();
    await expect.element(page.getByRole('button', { name: /Устройства/ })).not.toBeInTheDocument();

    m.tg.answer = 'out';
    m.api.logout.mockRejectedValueOnce(new Error('offline'));
    await out.click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    expect(m.desk.lost).toBe(0);

    await out.click();
    await expect.poll(() => m.desk.lost).toBe(1);
  });

  it('на компьютере без подтверждений «Выйти» ничего не делает', async () => {
    m.desk.desktop = true;
    await setup();
    await page.getByRole('button', { name: 'Выйти на этом устройстве' }).click();
    expect(m.api.logout).not.toHaveBeenCalled();
  });
});
