// Шторка дела: название, день, время, место; у события из календаря — его подробности и ссылки.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { TodoDetails } from '../../shared/types';
import { renderApp } from '../test/render';
import { openExternal, TodoSheet } from './TodoSheet';

const tg = vi.hoisted(() => ({ link: true, tgLink: true, openLink: vi.fn(), openTelegramLink: vi.fn() }));
vi.mock('@tma.js/sdk-react', async (orig) => ({
  ...(await orig<typeof import('@tma.js/sdk-react')>()),
  openLink: Object.assign((url: string) => tg.openLink(url), { isAvailable: () => tg.link }),
  openTelegramLink: Object.assign((url: string) => tg.openTelegramLink(url), { isAvailable: () => tg.tgLink }),
}));

const TODAY = '2026-10-03';
let windowOpen: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  tg.link = true;
  tg.tgLink = true;
  windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

function sheet(props: Partial<Parameters<typeof TodoSheet>[0]> = {}) {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const r = renderApp(<TodoSheet title="Купить молоко" day={TODAY} time={null} today={TODAY} onSave={onSave} onDelete={onDelete} onClose={onClose} {...props} />);
  return { r, onSave, onDelete, onClose };
}

const title = () => page.getByRole('textbox', { name: 'Дело' });
const radio = (name: string) => page.getByRole('radio', { name });
const done = () => page.getByRole('button', { name: 'Готово' });

describe('ссылки наружу', () => {
  it('ссылка Telegram — внутри Telegram, остальные — браузером; вне Telegram — новым окном', () => {
    openExternal('https://t.me/LifeCommit_bot');
    expect(tg.openTelegramLink).toHaveBeenCalledWith('https://t.me/LifeCommit_bot');
    openExternal('https://zoom.us/j/1');
    expect(tg.openLink).toHaveBeenCalledWith('https://zoom.us/j/1');
    tg.tgLink = false;
    openExternal('https://t.me/x');
    expect(tg.openLink).toHaveBeenLastCalledWith('https://t.me/x');
    tg.link = false;
    openExternal('https://example.com');
    expect(windowOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
  });
});

describe('своё дело', () => {
  it('правка названия, дня, времени и места уходит одним «Готово»', async () => {
    const { r, onSave, onClose } = sheet({ details: { location: 'Дом' } });
    await r;
    await expect.element(page.getByRole('dialog', { name: 'Дело' })).toBeVisible();
    await expect.element(radio('Сегодня')).toHaveAttribute('aria-checked', 'true');
    await expect.element(page.getByRole('button', { name: /Другой день/ })).toMatchTextContent(/Выбрать/);
    await title().fill('  Купить кефир ');
    await radio('Завтра').click();
    await expect.element(radio('Завтра')).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: /Время/ }).click();
    await page.getByRole('dialog', { name: 'Время' }).getByRole('button', { name: 'Готово' }).click();
    await expect.element(page.getByRole('button', { name: /Время/ })).toMatchTextContent(/12:00/);
    await page.getByPlaceholder('Где?').fill(' Магазин у дома ');
    await done().click();
    expect(onSave).toHaveBeenCalledWith({ title: 'Купить кефир', day: '2026-10-04', time: '12:00', location: 'Магазин у дома' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('переехавшее со вчера — уже сегодняшнее; другой день выбирается календарём', async () => {
    const { r, onSave } = sheet({ day: '2026-10-01', time: '09:00' });
    await r;
    await expect.element(radio('Сегодня')).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: /Другой день/ }).click();
    const cal = page.getByRole('dialog', { name: 'Другой день' });
    // Сегодня и завтра выбираются кнопками — в календаре они недоступны.
    await expect.element(cal.getByRole('button', { name: '4', exact: true })).toBeDisabled();
    await cal.getByRole('button', { name: '10', exact: true }).click();
    await expect.element(page.getByRole('button', { name: /Другой день/ })).toMatchTextContent(/10 октября/);
    await expect.element(radio('Сегодня')).toHaveAttribute('aria-checked', 'false');
    await expect.element(radio('Завтра')).toHaveAttribute('aria-checked', 'false');
    await radio('Сегодня').click();
    await done().click();
    expect(onSave).toHaveBeenCalledWith({ title: 'Купить молоко', day: TODAY, time: '09:00', location: '' });
  });

  it('во вкладке «Календарь» прошлый день остаётся своим: поправили букву — дело не уехало на сегодня', async () => {
    const { r, onSave } = sheet({ day: '2026-09-28', carried: false });
    await r;
    await expect.element(radio('Сегодня')).toHaveAttribute('aria-checked', 'false');
    await title().fill('Купить молоко!');
    await done().click();
    expect(onSave).toHaveBeenCalledWith({ title: 'Купить молоко!', day: '2026-09-28', time: null, location: '' });
  });

  it('пустое название не сохранить; место открывается на карте; «Удалить дело»', async () => {
    const { r, onSave, onDelete, onClose } = sheet();
    await r;
    await expect.element(page.getByRole('button', { name: 'Открыть на карте' })).not.toBeInTheDocument();
    await title().fill('   ');
    await expect.element(done()).toBeDisabled();
    await page.getByPlaceholder('Где?').fill('Кафе «Снежинка»');
    await page.getByRole('button', { name: 'Открыть на карте' }).click();
    expect(tg.openLink).toHaveBeenCalledWith(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Кафе «Снежинка»')}`);
    expect(onSave).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Удалить дело' }).click();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('черновик из голоса: без «Удалить»', async () => {
    await sheet({ onDelete: undefined }).r;
    await expect.element(done()).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Удалить/ })).not.toBeInTheDocument();
  });
});

describe('событие из календаря', () => {
  const details: TodoDetails = {
    location: 'Офис, Тверская 1',
    link: 'https://meet.google.com/abc-defg-hij',
    people_count: 6,
    people: ['Аня', 'Боря', 'Вера', 'Гоша'],
    notes: 'Короткое описание',
    open_url: 'https://calendar.google.com/event?eid=1',
  };

  it('подробности: место, созвон, люди, описание; ссылки открываются', async () => {
    const { r, onSave, onDelete, onClose } = sheet({ source: 'google', details, time: '10:00' });
    await r;
    await expect.element(page.getByRole('dialog', { name: 'Событие' })).toBeVisible();
    await page.getByRole('button', { name: 'Открыть на карте: Офис, Тверская 1' }).click();
    expect(tg.openLink).toHaveBeenLastCalledWith(expect.stringContaining(encodeURIComponent('Офис, Тверская 1')));
    const join = page.getByRole('button', { name: /Подключиться/ });
    await expect.element(join).toMatchTextContent(/meet\.google\.com\/abc-defg-hij/);
    await join.click();
    expect(tg.openLink).toHaveBeenLastCalledWith(details.link);
    // Трое по именам и «ещё двое»: всего шестеро вместе со мной.
    await expect.element(page.getByText('6 участников')).toBeVisible();
    await expect.element(page.getByText('Аня, Боря, Вера и ещё 2')).toBeVisible();
    // Короткое описание не раскрывается.
    await expect.element(page.getByRole('button', { name: 'Короткое описание' })).toBeDisabled();
    await expect.element(page.getByText('Ещё')).not.toBeInTheDocument();
    // Своего места у события нет — оно из календаря.
    await expect.element(page.getByPlaceholder('Где?')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Открыть в Google Календаре ↗' }).click();
    expect(tg.openLink).toHaveBeenLastCalledWith(details.open_url);
    await done().click();
    expect(onSave).toHaveBeenCalledWith({ title: 'Купить молоко', day: TODAY, time: '10:00' });
    expect(onClose).toHaveBeenCalledOnce();
    await page.getByRole('button', { name: 'Удалить событие' }).click();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('повторяющееся: день не выбирается; длинное описание раскрывается по «Ещё»', async () => {
    const notes = 'Строка один\nСтрока два\nСтрока три\nСтрока четыре';
    await sheet({ source: 'apple', recurring: true, day: '2026-09-01', details: { notes, link: 'not a url but quite a long text here, really long', people_count: 3, people: ['Аня', 'Боря'] } }).r;
    await expect.element(page.getByRole('radiogroup')).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Другой день/ })).not.toBeInTheDocument();
    await expect.element(page.getByText('Из Apple Календаря')).toBeVisible();
    // Ссылка не на созвон — «Открыть ссылку»; не адрес — показываем как есть, обрезав.
    await expect.element(page.getByRole('button', { name: /Открыть ссылку/ })).toMatchTextContent(/not a url but quite a long text here, re$/);
    await expect.element(page.getByText('Аня, Боря', { exact: true })).toBeVisible();
    const notesBtn = page.getByRole('button', { name: /Строка один/ });
    await expect.element(notesBtn).toBeEnabled();
    await expect.element(page.getByText('Ещё')).toBeVisible();
    expect(notesBtn.element().querySelector('.detail-text')!.className).toBe('detail-text clamp');
    await notesBtn.click();
    await expect.element(page.getByText('Ещё')).not.toBeInTheDocument();
    expect(notesBtn.element().querySelector('.detail-text')!.className).toBe('detail-text');
    await notesBtn.click();
    expect(notesBtn.element().querySelector('.detail-text')!.className).toBe('detail-text clamp');
  });

  it('без ссылки на событие — откуда оно; без подробностей — только поля', async () => {
    const { r } = sheet({ source: 'google', details: { people_count: 2 } });
    const { rerender } = await r;
    await expect.element(page.getByText('Из Google Календаря')).toBeVisible();
    await expect.element(page.getByText('2 участника')).toBeVisible();
    const longNotes = 'а'.repeat(150);
    await rerender(<TodoSheet title="Звонок" day={TODAY} time={null} today={TODAY} source="google" details={{ notes: longNotes, people_count: 0, link: 'https://example.com/' }} onSave={() => {}} onClose={() => {}} />);
    await expect.element(page.getByText('Ещё')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Открыть ссылку/ })).toMatchTextContent(/example\.com$/);
    await expect.element(page.getByText(/участник/)).not.toBeInTheDocument();
    await rerender(<TodoSheet title="Звонок" day={TODAY} time={null} today={TODAY} source="google" details={{ location: 'Дом' }} onSave={() => {}} onClose={() => {}} />);
    await expect.element(page.getByRole('button', { name: 'Открыть на карте: Дом' })).toBeVisible();
    expect(document.querySelectorAll('.event-details .detail-row')).toHaveLength(1);
    await rerender(<TodoSheet title="Звонок" day={TODAY} time={null} today={TODAY} source="google" details={null} onSave={() => {}} onClose={() => {}} />);
    expect(document.querySelector('.event-details')).toBeNull();
  });
});
