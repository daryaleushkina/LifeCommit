// Вкладка «Я»: карта месяца и года, настройки (что уходит на сервер), «Поделиться» и удаление аккаунта.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { SummaryItem } from '../../shared/summary';
import type { HeatDay, UserSettings } from '../../shared/types';
import type { Template } from '../share/draw';
import { renderApp } from '../test/render';
import { Profile } from './Profile';

const m = vi.hoisted(() => ({
  api: { settings: vi.fn(), writeAccess: vi.fn(), deleteAccount: vi.fn(), summary: vi.fn(), blocks: vi.fn(), unblock: vi.fn() },
  share: { templates: null as Template[] | null },
  tg: { popup: false, answer: 'delete' as string | null, popups: [] as unknown[], writeAccess: false, writeAnswer: 'allowed', links: [] as string[] },
}));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: m.api }));
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
    await hours.getByRole('option', { name: '06' }).click();
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
    // Сервер не ответил — строка всё равно уходит; шторка закрывается.
    m.api.unblock.mockRejectedValue(new Error('сеть'));
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
