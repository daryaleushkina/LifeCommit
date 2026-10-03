// Календари: подключение Google и Apple, выбор календарей, куда писать дела, отключение.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { api, ApiError, type CalendarAccount } from '../api';
import { caches } from '../caches';
import { useT } from '../i18n';
import { renderApp } from '../test/render';
import { CalendarsSheet, syncedLabel } from './CalendarsSheet';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  api: {
    calendars: vi.fn(),
    googleUrl: vi.fn(),
    connectApple: vi.fn(),
    confirmGoogle: vi.fn(),
    toggleCollection: vi.fn(),
    setDefaultCalendar: vi.fn(),
    disconnectCalendar: vi.fn(),
  },
}));
const tg = vi.hoisted(() => ({ popup: true, answer: 'off' as string | undefined, show: vi.fn(), open: vi.fn() }));
vi.mock('@tma.js/sdk-react', async (orig) => ({
  ...(await orig<typeof import('@tma.js/sdk-react')>()),
  openLink: { ifAvailable: (url: string) => tg.open(url) },
  popup: {
    show: Object.assign(
      async (p: unknown) => {
        tg.show(p);
        return tg.answer;
      },
      { isAvailable: () => tg.popup },
    ),
  },
}));

const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/auth?x=1';
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const google = (p: Partial<CalendarAccount> = {}): CalendarAccount => ({
  id: 1, provider: 'google', login: 'dasha@gmail.com', status: 'ok', last_sync_at: minutesAgo(5), default_url: 'g1',
  collections: [
    { url: 'g1', name: 'Личный', color: '#E67C73', enabled: true, writable: true },
    { url: 'g2', name: 'Работа', color: null, enabled: true, writable: true },
    { url: 'g3', name: 'Праздники', color: null, enabled: false, writable: false },
  ],
  ...p,
});
const apple = (p: Partial<CalendarAccount> = {}): CalendarAccount => ({
  id: 2, provider: 'apple', login: 'dasha@icloud.com', status: 'ok', last_sync_at: new Date().toISOString(), default_url: 'a1',
  collections: [{ url: 'a1', name: 'Дом', color: '#34C759', enabled: true, writable: true }],
  ...p,
});

function setup() {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const r = renderApp(<CalendarsSheet onClose={onClose} onChanged={onChanged} />);
  return { r, onClose, onChanged };
}

const provider = (name: string) => page.getByText(name, { exact: true }).element().closest('.provider')!;
const appleForm = () => page.getByRole('dialog', { name: 'Подключить Apple' });

beforeEach(() => {
  vi.clearAllMocks();
  caches.accounts = null;
  caches.googleUrl = null;
  tg.popup = true;
  tg.answer = 'off';
  // Сервер отдаёт то, что уже на экране (правки на экране и на сервере совпадают).
  vi.mocked(api.calendars).mockImplementation(async () => caches.accounts ?? []);
  vi.mocked(api.googleUrl).mockResolvedValue({ url: GOOGLE_URL });
  vi.mocked(api.toggleCollection).mockResolvedValue({ ok: true });
  vi.mocked(api.setDefaultCalendar).mockResolvedValue({ ok: true });
  vi.mocked(api.disconnectCalendar).mockResolvedValue({ ok: true });
  vi.mocked(api.confirmGoogle).mockResolvedValue({ ok: true });
  vi.mocked(api.connectApple).mockResolvedValue({ ok: true });
});

describe('«обновлено … назад»', () => {
  it('только что, минуты, без даты — пусто', async () => {
    let t!: ReturnType<typeof useT>;
    const Probe = () => {
      t = useT();
      return null;
    };
    await renderApp(<Probe />);
    expect(syncedLabel(t, null)).toBe('');
    expect(syncedLabel(t, new Date().toISOString())).toBe('обновлено только что');
    expect(syncedLabel(t, minutesAgo(12))).toBe('обновлено 12 мин назад');
  });
});

describe('ничего не подключено', () => {
  it('пока список грузится, не пишем «не подключено» и кнопок нет', async () => {
    let answer!: (v: CalendarAccount[]) => void;
    vi.mocked(api.calendars).mockReturnValue(new Promise((res) => (answer = res)));
    await setup().r;
    await expect.element(page.getByRole('dialog', { name: 'Календари' })).toBeVisible();
    expect(provider('Google Календарь').querySelector('small')).toBeNull();
    expect(provider('Apple (iCloud)').querySelector('small')).toBeNull();
    await expect.element(page.getByRole('button', { name: 'Подключить' })).not.toBeInTheDocument();
    answer([]);
    await expect.element(page.getByText('Нужен пароль приложения')).toBeVisible();
    expect(caches.accounts).toEqual([]);
  });

  it('Google — вход по ссылке, пока она не пришла, кнопка не нажимается', async () => {
    caches.accounts = [];
    let answer!: (v: { url: string }) => void;
    vi.mocked(api.googleUrl).mockReturnValue(new Promise((res) => (answer = res)));
    await setup().r;
    await expect.element(page.getByText('Вход через Google')).toBeVisible();
    const connect = page.getByRole('button', { name: 'Подключить' }).first();
    await expect.element(connect).toBeDisabled();
    await expect.element(page.getByText(/Google может предупредить/)).toBeVisible();
    answer({ url: GOOGLE_URL });
    await expect.element(connect).toBeEnabled();
    await connect.click();
    expect(tg.open).toHaveBeenCalledWith(GOOGLE_URL);
    expect(caches.googleUrl!.url).toBe(GOOGLE_URL);
  });

  it('свежая ссылка из кэша не перезапрашивается; Google не настроен — «Скоро»', async () => {
    caches.googleUrl = { url: GOOGLE_URL, at: Date.now() };
    const first = await setup().r;
    await expect.element(page.getByText('Нужен пароль приложения')).toBeVisible();
    expect(api.googleUrl).not.toHaveBeenCalled();
    await first.unmount();
    caches.googleUrl = null;
    vi.mocked(api.googleUrl).mockRejectedValue(new Error('not configured'));
    await setup().r;
    await expect.element(page.getByText('Скоро')).toBeVisible();
    expect(provider('Google Календарь').className).toBe('provider off');
    await expect.element(page.getByText('Вход через Google')).not.toBeInTheDocument();
    await expect.element(page.getByText(/Google может предупредить/)).not.toBeInTheDocument();
  });

  it('список не загрузился — показываем как неподключённые; Escape закрывает', async () => {
    vi.mocked(api.calendars).mockRejectedValue(new Error('offline'));
    const { r, onClose } = setup();
    await r;
    await expect.element(page.getByText('Нужен пароль приложения')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('вернулись из браузера — перечитываем календари и ссылку входа', async () => {
    await setup().r;
    await expect.element(page.getByText('Вход через Google')).toBeVisible();
    expect(api.calendars).toHaveBeenCalledOnce();
    vi.mocked(api.calendars).mockResolvedValue([google({ status: 'setup' })]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api.calendars).toHaveBeenCalledOnce();
    delete (document as { visibilityState?: unknown }).visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    await expect.element(page.getByText('Выберите календари')).toBeVisible();
    expect(api.googleUrl).toHaveBeenCalledTimes(2);
  });
});

describe('Google', () => {
  it('подключён: когда обновлялся, куда писать дела, что забирать', async () => {
    caches.accounts = [google()];
    const { r, onChanged } = setup();
    await r;
    await expect.element(page.getByText('Подключено · обновлено 5 мин назад')).toBeVisible();
    // Чужие календари (только чтение) писать нельзя — в списке «куда» их нет.
    const writeTo = page.getByRole('button', { name: /^Наши дела — в/ });
    await expect.element(writeTo).toMatchTextContent(/Личный/);
    await writeTo.click();
    expect(page.getByRole('option').elements().map((o) => o.textContent)).toEqual(['Личный', 'Работа']);
    await page.getByRole('option', { name: 'Работа' }).click();
    await expect.element(writeTo).toMatchTextContent(/Работа/);
    expect(api.setDefaultCalendar).toHaveBeenCalledWith(1, 'g2');
    await expect.poll(() => onChanged).toHaveBeenCalledOnce();
    expect(caches.accounts![0]!.default_url).toBe('g2');

    const holidays = page.getByRole('checkbox', { name: 'Праздники' });
    await expect.element(holidays).not.toBeChecked();
    await holidays.click();
    await expect.element(holidays).toBeChecked();
    expect(api.toggleCollection).toHaveBeenCalledWith(1, 'g3', true);
    await expect.poll(() => onChanged).toHaveBeenCalledTimes(2);
    // 04.10.2026: сервер не сохранил — выбор возвращается как был, в шторке строка ошибки (раньше на экране оставалось несохранённое).
    vi.mocked(api.toggleCollection).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(api.setDefaultCalendar).mockRejectedValueOnce(new Error('offline'));
    await page.getByRole('checkbox', { name: 'Личный' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: 'Личный' })).toBeChecked();
    await writeTo.click();
    await page.getByRole('option', { name: 'Личный' }).click();
    await expect.element(writeTo).toMatchTextContent(/Работа/);
    expect(caches.accounts![0]!.default_url).toBe('g2');
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    // Ничего не поменялось — экран календаря не перечитываем.
    expect(onChanged).toHaveBeenCalledTimes(2);
    // Следующая правка удалась — строки ошибки нет.
    await page.getByRole('checkbox', { name: 'Праздники' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).not.toBeInTheDocument();
  });

  it('отключить — после подтверждения; «Отмена» ничего не делает', async () => {
    caches.accounts = [google()];
    const { r, onChanged } = setup();
    await r;
    tg.answer = undefined;
    await page.getByRole('button', { name: 'Отключить Google Календарь' }).click();
    await expect.poll(() => tg.show).toHaveBeenCalledOnce();
    expect(tg.show.mock.calls[0]![0]).toMatchObject({ message: 'Отключить календарь? Дела, пришедшие из него, уберём, ваши останутся.' });
    expect(api.disconnectCalendar).not.toHaveBeenCalled();
    tg.answer = 'off';
    vi.mocked(api.calendars).mockResolvedValue([]);
    await page.getByRole('button', { name: 'Отключить Google Календарь' }).click();
    await expect.poll(() => api.disconnectCalendar).toHaveBeenCalledWith('google');
    await expect.poll(() => onChanged).toHaveBeenCalledOnce();
    await expect.element(page.getByText('Вход через Google')).toBeVisible();
  });

  it('вне Telegram отключаем без вопроса', async () => {
    tg.popup = false;
    caches.accounts = [google()];
    const { r, onChanged } = setup();
    await r;
    await page.getByRole('button', { name: 'Отключить Google Календарь' }).click();
    await expect.poll(() => onChanged).toHaveBeenCalledOnce();
    expect(api.disconnectCalendar).toHaveBeenCalledWith('google');
    expect(tg.show).not.toHaveBeenCalled();
  });

  // 04.10.2026: раньше сбой отключения проходил молча.
  it('сервер не отключил — календарь на месте, в шторке строка ошибки', async () => {
    tg.popup = false;
    caches.accounts = [google()];
    vi.mocked(api.disconnectCalendar).mockRejectedValue(new Error('offline'));
    const { r, onChanged } = setup();
    await r;
    await page.getByRole('button', { name: 'Отключить Google Календарь' }).click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Отключить Google Календарь' })).toBeVisible();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('только что подключили: выбрать календари и «Готово»', async () => {
    caches.accounts = [google({ status: 'setup', default_url: null })];
    let confirm!: () => void;
    vi.mocked(api.confirmGoogle).mockReturnValueOnce(new Promise((res) => (confirm = () => res({ ok: true }))));
    const { r, onChanged } = setup();
    await r;
    await expect.element(page.getByText('Выберите календари')).toBeVisible();
    await expect.element(page.getByText(/Свои календари уже отмечены/)).toBeVisible();
    // Отключить и «куда писать» появятся после настройки.
    await expect.element(page.getByRole('button', { name: /Отключить/ })).not.toBeInTheDocument();
    await page.getByRole('checkbox', { name: 'Личный' }).click();
    await page.getByRole('checkbox', { name: 'Работа' }).click();
    // Ни одного — нечего забирать.
    await expect.element(page.getByRole('button', { name: 'Готово' })).toBeDisabled();
    expect(onChanged).not.toHaveBeenCalled();
    await page.getByRole('checkbox', { name: 'Работа' }).click();
    vi.mocked(api.calendars).mockResolvedValue([google()]);
    await page.getByRole('button', { name: 'Готово' }).click();
    await expect.element(page.getByRole('button', { name: 'Подключаю…' })).toBeDisabled();
    confirm();
    await expect.poll(() => onChanged).toHaveBeenCalledOnce();
    expect(api.confirmGoogle).toHaveBeenCalledWith(1);
    await expect.element(page.getByText('Подключено · обновлено 5 мин назад')).toBeVisible();
  });

  it('настройка не дошла до Google — ошибка, можно снова', async () => {
    caches.accounts = [google({ status: 'setup' })];
    vi.mocked(api.confirmGoogle).mockRejectedValueOnce(new Error('offline'));
    const { r, onChanged } = setup();
    await r;
    await page.getByRole('button', { name: 'Готово' }).click();
    await expect.element(page.getByText('Не достучался до Google. Попробуйте ещё раз чуть позже.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Готово' })).toBeEnabled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('доступ истёк — предупреждение и «Подключить заново»', async () => {
    caches.accounts = [google({ status: 'auth_failed' })];
    await setup().r;
    await expect.element(page.getByText(/Google больше не пускает/)).toBeVisible();
    await expect.element(provider('Google Календарь').querySelector('small')!).toHaveTextContent('dasha@gmail.com');
    await page.getByRole('button', { name: 'Подключить заново' }).click();
    expect(tg.open).toHaveBeenCalledWith(GOOGLE_URL);
    // Сломанный не пишет дела — «куда писать» не показываем.
    await expect.element(page.getByRole('button', { name: /^Наши дела — в/ })).not.toBeInTheDocument();
  });

  it('ошибка без ссылки входа — без кнопки «Подключить заново»', async () => {
    caches.accounts = [google({ status: 'error', collections: [] })];
    vi.mocked(api.googleUrl).mockRejectedValue(new Error('down'));
    await setup().r;
    await expect.element(page.getByText(/Google больше не пускает/)).toBeVisible();
    await expect.poll(() => api.googleUrl).toHaveBeenCalled();
    await expect.element(page.getByRole('button', { name: 'Подключить заново' })).not.toBeInTheDocument();
    await expect.element(page.getByText('Что забирать')).not.toBeInTheDocument();
  });
});

describe('Apple', () => {
  it('подключение по шагам: сайт Apple ID, почта и пароль приложения', async () => {
    const { r, onChanged } = setup();
    await r;
    await page.getByRole('button', { name: 'Подключить' }).last().click();
    await expect.element(appleForm()).toBeVisible();
    expect(appleForm().getByRole('listitem').elements()).toHaveLength(3);
    await page.getByRole('button', { name: 'Открыть сайт Apple ID ↗' }).click();
    expect(tg.open).toHaveBeenCalledWith('https://account.apple.com/account/manage');
    const go = appleForm().getByRole('button', { name: 'Подключить' });
    await expect.element(go).toBeDisabled();
    await page.getByRole('textbox', { name: 'Apple ID (почта)' }).fill('dasha@icloud.com');
    await page.getByRole('textbox', { name: /Пароль приложения/ }).fill('abcd-efgh-ijk');
    // 11 букв без дефисов — мало.
    await expect.element(go).toBeDisabled();
    await page.getByRole('textbox', { name: /Пароль приложения/ }).fill('abcd-efgh-ijkl-mnop');
    let connect!: () => void;
    vi.mocked(api.connectApple).mockReturnValueOnce(new Promise((res) => (connect = () => res({ ok: true }))));
    vi.mocked(api.calendars).mockResolvedValue([apple()]);
    await go.click();
    await expect.element(appleForm().getByRole('button', { name: 'Подключаю…' })).toBeDisabled();
    connect();
    await expect.element(appleForm()).not.toBeInTheDocument();
    expect(api.connectApple).toHaveBeenCalledWith('dasha@icloud.com', 'abcd-efgh-ijkl-mnop');
    expect(onChanged).toHaveBeenCalledOnce();
    await expect.element(page.getByText('Подключено · обновлено только что')).toBeVisible();
  });

  it('ошибки входа объясняются по-разному; Escape возвращает к списку', async () => {
    await setup().r;
    await page.getByRole('button', { name: 'Подключить' }).last().click();
    await page.getByRole('textbox', { name: 'Apple ID (почта)' }).fill('dasha@icloud.com');
    await page.getByRole('textbox', { name: /Пароль приложения/ }).fill('abcdefghijklmnop');
    const go = appleForm().getByRole('button', { name: 'Подключить' });
    const cases: [unknown, string][] = [
      [new ApiError(401, 'apple_auth'), 'Apple не пустил: проверьте почту и пароль приложения.'],
      [new ApiError(400, 'apple_bad_input'), 'Нужна почта Apple ID и пароль приложения из 16 букв.'],
      [new ApiError(502, 'apple_down'), 'Не достучался до Apple. Попробуйте ещё раз чуть позже.'],
      [new Error('offline'), 'Не достучался до Apple. Попробуйте ещё раз чуть позже.'],
    ];
    for (const [error, text] of cases) {
      vi.mocked(api.connectApple).mockRejectedValueOnce(error);
      await go.click();
      await expect.element(page.getByText(text)).toBeVisible();
      await expect.element(go).toBeEnabled();
    }
    await userEvent.keyboard('{Escape}');
    await expect.element(appleForm()).not.toBeInTheDocument();
    await expect.element(page.getByRole('dialog', { name: 'Календари' })).toBeVisible();
  });

  it('пароль отозван — предупреждение, форма с той же почтой', async () => {
    caches.accounts = [apple({ status: 'auth_failed', last_sync_at: null })];
    await setup().r;
    await expect.element(page.getByText(/Apple перестал пускать/)).toBeVisible();
    await expect.element(provider('Apple (iCloud)').querySelector('small')!).toHaveTextContent('dasha@icloud.com');
    expect(provider('Apple (iCloud)').querySelector('button')).toBeNull();
    await page.getByRole('button', { name: 'Ввести новый пароль' }).click();
    await expect.element(page.getByRole('textbox', { name: 'Apple ID (почта)' })).toHaveValue('dasha@icloud.com');
  });

  it('оба подключены: дела пишутся в подключённый последним', async () => {
    const family = { url: 'a2', name: 'Семья', color: null, enabled: false, writable: true };
    caches.accounts = [google({ last_sync_at: null }), apple({ collections: [...apple().collections, family] })];
    const { r, onChanged } = setup();
    await r;
    await expect.element(page.getByText('Подключено ·', { exact: true })).toBeVisible();
    const writeTo = page.getByRole('button', { name: /^Наши дела — в/ });
    expect(writeTo.elements()).toHaveLength(1);
    await expect.element(writeTo).toMatchTextContent(/Дом/);
    // Правка одного календаря не трогает другой.
    await writeTo.click();
    await page.getByRole('option', { name: 'Семья' }).click();
    expect(api.setDefaultCalendar).toHaveBeenCalledWith(2, 'a2');
    await page.getByRole('checkbox', { name: 'Праздники' }).click();
    expect(api.toggleCollection).toHaveBeenCalledWith(1, 'g3', true);
    await expect.poll(() => onChanged).toHaveBeenCalledTimes(2);
    expect(caches.accounts!.map((a) => a.default_url)).toEqual(['g1', 'a2']);
    expect(caches.accounts![1]!.collections.map((c) => c.enabled)).toEqual([true, false]);
    await page.getByRole('button', { name: 'Отключить Apple (iCloud)' }).click();
    await expect.poll(() => api.disconnectCalendar).toHaveBeenCalledWith('apple');
    await expect.poll(() => onChanged).toHaveBeenCalledTimes(3);
  });
});
