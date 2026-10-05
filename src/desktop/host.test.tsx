// Мост «как в Telegram» в браузере (без оболочки Mac): SDK мини-аппа зовёт те же методы, что в Telegram, а главная
// кнопка, «назад», подтверждения, ссылки и скачивание делаются на странице.
import {
  backButton,
  cloudStorage,
  downloadFile,
  hapticFeedback,
  init,
  mainButton,
  miniApp,
  openLink,
  openTelegramLink,
  popup,
  postEvent,
  requestWriteAccess,
  shareMessage,
  themeParams,
  viewport,
} from '@tma.js/sdk-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { installDesktopHost } from './host';

// Язык страницы — как у приложения (index.html и App ставят lang); по нему подписи «Назад», «Отмена».
document.documentElement.lang = 'ru';
installDesktopHost();
init();
themeParams.mount();
miniApp.mount();
backButton.mount();
mainButton.mount();
await viewport.mount();

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('.host-popup').forEach((p) => p.remove());
});

const bar = () => document.querySelector<HTMLElement>('.host-bar')!;
const top = () => document.querySelector<HTMLElement>('.host-top')!;

describe('главная кнопка', () => {
  it('появляется полосой снизу с текстом и цветом; нажатие — обработчик приложения; высота окна для приложения меньше', async () => {
    const onClick = vi.fn();
    const off = mainButton.onClick(onClick);
    mainButton.setParams({ text: 'Сохранить', isVisible: true, isEnabled: true, bgColor: '#237A46', textColor: '#FFFFFF' });
    const btn = page.getByRole('button', { name: 'Сохранить' });
    await expect.element(btn).toBeVisible();
    await expect.element(btn).toHaveStyle({ backgroundColor: 'rgb(35, 122, 70)', color: 'rgb(255, 255, 255)' });
    await btn.click();
    expect(onClick).toHaveBeenCalledOnce();
    await expect.poll(() => viewport.height()).toBe(window.innerHeight - bar().offsetHeight);

    mainButton.setParams({ isLoaderVisible: true });
    await expect.element(btn).toBeDisabled();
    await expect.element(btn).toHaveAttribute('aria-busy', 'true');
    mainButton.setParams({ isLoaderVisible: false, isEnabled: false });
    await expect.element(btn).toBeDisabled();
    await expect.element(btn).toHaveAttribute('aria-busy', 'false');

    mainButton.setParams({ isVisible: false });
    expect(bar().hidden).toBe(true);
    await expect.poll(() => viewport.height()).toBe(window.innerHeight);
    off();
  });

  it('цвет полосы — цвет нижней панели, который задаёт приложение', () => {
    miniApp.setBottomBarColor('#0F1511');
    expect(bar().style.background).toBe('rgb(15, 21, 17)');
  });
});

describe('«назад»', () => {
  it('в браузере — полоса сверху с «Назад»; место под ней — отступом сверху; нажатие и Escape — «назад»', async () => {
    const onBack = vi.fn();
    const off = backButton.onClick(onBack);
    expect(top().hidden).toBe(true);
    backButton.show();
    const back = page.getByRole('button', { name: 'Назад' });
    await expect.element(back).toBeVisible();
    await expect.poll(() => viewport.contentSafeAreaInsetTop()).toBe(top().offsetHeight);
    await back.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onBack).toHaveBeenCalledTimes(2);

    // Человек печатает в поле — Escape не уводит с экрана (и не во время набора через IME).
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    input.remove();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
    expect(onBack).toHaveBeenCalledTimes(2);

    // Открыта шторка — Escape закрывает её, а не уводит назад.
    const sheet = document.createElement('div');
    sheet.className = 'sheet-backdrop';
    document.body.append(sheet);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    sheet.remove();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onBack).toHaveBeenCalledTimes(2);

    backButton.hide();
    expect(top().hidden).toBe(true);
    await expect.poll(() => viewport.contentSafeAreaInsetTop()).toBe(0);
    window.lifecommitHost!.back(); // спрятан — «назад» ничего не делает
    expect(onBack).toHaveBeenCalledTimes(2);
    off();
  });

  it('по-английски — «Back»; цвет полосы — цвет шапки приложения', async () => {
    document.documentElement.lang = 'en';
    miniApp.setHeaderColor('#0F1511');
    backButton.show();
    await expect.element(page.getByRole('button', { name: 'Back' })).toBeVisible();
    expect(top().style.background).toBe('rgb(15, 21, 17)');
    backButton.hide();
    document.documentElement.lang = 'ru';
  });
});

describe('подтверждения', () => {
  it('шторка с текстом и кнопками: удалить — красная, отмена — мягкая; ответ — id нажатой', async () => {
    const answer = popup.show({ message: 'Удалить привычку?', buttons: [{ id: 'delete', type: 'destructive', text: 'Удалить' }, { type: 'cancel' }] });
    const dialog = page.getByRole('alertdialog', { name: 'Удалить привычку?' });
    await expect.element(dialog.getByRole('button', { name: 'Удалить' })).toHaveClass(/danger/);
    await expect.element(dialog.getByRole('button', { name: 'Отмена' })).toHaveClass(/soft/);
    // фокус — на безопасной «Отмена»: привычный Return ничего не удалит
    await expect.element(dialog.getByRole('button', { name: 'Отмена' })).toHaveFocus();
    // страница под шторкой с клавиатуры недоступна, пока спрашиваем
    expect(bar().inert).toBe(true);
    expect(top().inert).toBe(true);
    await dialog.getByRole('button', { name: 'Удалить' }).click();
    expect(await answer).toBe('delete');
    await expect.element(dialog).not.toBeInTheDocument();
    expect(bar().inert).toBe(false);
    expect(top().inert).toBe(false);
  });

  it('подтверждение из шторки: шторка под ним (она вне #root, порталом в body) тоже недоступна с клавиатуры', async () => {
    const sheet = document.createElement('div');
    sheet.className = 'sheet-backdrop';
    const already = document.createElement('div');
    already.inert = true;
    document.body.append(sheet, already);
    const answer = popup.show({ message: 'Отключить календарь?', buttons: [{ id: 'off', type: 'destructive', text: 'Отключить' }, { type: 'cancel' }] });
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    expect(sheet.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('.host-popup')!.inert).toBe(false);
    await page.getByRole('button', { name: 'Отмена' }).click();
    await answer;
    expect(sheet.inert).toBe(false);
    expect(already.inert).toBe(true); // что было недоступно до подтверждения, таким и осталось
    sheet.remove();
    already.remove();
  });

  it('«назад» при открытом подтверждении (⌘[ в заголовке окна) закрывает подтверждение, а не экран под ним', async () => {
    const onBack = vi.fn();
    const off = backButton.onClick(onBack);
    backButton.show();
    const answer = popup.show({ message: 'Удалить?', buttons: [{ id: 'delete', type: 'destructive', text: 'Удалить' }, { type: 'cancel' }] });
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    window.lifecommitHost!.back();
    expect(await answer).toBeUndefined();
    expect(onBack).not.toHaveBeenCalled();
    window.lifecommitHost!.back();
    expect(onBack).toHaveBeenCalledOnce();
    backButton.hide();
    off();
  });

  it('«Отмена» — не «удалить»; заголовок; без кнопок — одна «Закрыть»; «ОК» — главной кнопкой', async () => {
    const cancelled = popup.show({ title: 'Точно?', message: 'Совсем?', buttons: [{ id: 'yes', type: 'destructive', text: 'Да' }, { type: 'cancel' }] });
    await expect.element(page.getByRole('alertdialog', { name: 'Точно?' })).toHaveAccessibleDescription('Совсем?');
    await page.getByRole('button', { name: 'Отмена' }).click();
    expect(await cancelled).not.toBe('yes');

    const closed = popup.show({ message: 'Готово' });
    await page.getByRole('button', { name: 'Закрыть' }).click();
    await closed;

    const ok = popup.show({ message: 'Цель изменится с завтра', buttons: [{ type: 'ok' }] });
    await expect.element(page.getByRole('button', { name: 'OK' })).toHaveClass(/primary/);
    await page.getByRole('button', { name: 'OK' }).click();
    await ok;
  });

  it('Escape и тап мимо — закрыть без ответа; Escape не доходит до шторки под подтверждением', async () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    const byEscape = popup.show({ message: 'А?', buttons: [{ id: 'yes', type: 'default', text: 'Да' }] });
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await byEscape).toBeUndefined();
    expect(behind.mock.calls.map(([e]) => (e as KeyboardEvent).key)).toEqual(['Enter']);
    window.removeEventListener('keydown', behind);

    const byTap = popup.show({ message: 'Б?', buttons: [{ id: 'yes', type: 'default', text: 'Да' }] });
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    // тап по самой шторке — не мимо
    document.querySelector<HTMLElement>('.host-popup .sheet')!.click();
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    document.querySelector<HTMLElement>('.host-popup')!.click();
    expect(await byTap).toBeUndefined();
  });

  it('по-английски — «Cancel», «Close»', async () => {
    document.documentElement.lang = 'en';
    const answer = popup.show({ message: 'Sure?', buttons: [{ id: 'x', type: 'close' }, { type: 'cancel' }] });
    await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    expect(await answer).toBe('x');
    document.documentElement.lang = 'ru';
  });
});

describe('наружу', () => {
  it('ссылки — в новой вкладке; ссылки Telegram — на t.me (страница сама откроет Telegram)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openLink('https://lifecommit.app/privacy/');
    openTelegramLink('https://t.me/tribute/app?startapp=dRk2');
    expect(open.mock.calls).toEqual([
      ['https://lifecommit.app/privacy/', '_blank', 'noopener'],
      ['https://t.me/tribute/app?startapp=dRk2', '_blank', 'noopener'],
    ]);
  });

  it('наружу — только веб, Telegram и почта: javascript: и чужие схемы не открываются', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openLink('javascript:alert(document.domain)');
    openLink('file:///etc/passwd');
    openLink('mailto:hi@lifecommit.app');
    expect(open.mock.calls).toEqual([['mailto:hi@lifecommit.app', '_blank', 'noopener']]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('разрешить боту писать — только в Telegram: открываем чат с ботом, ответ «не разрешили»', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(await requestWriteAccess()).toBe('cancelled');
    expect(open).toHaveBeenCalledWith('https://t.me/LifeCommit_bot', '_blank', 'noopener');
  });

  it('скачать картинку: файл со своего сервера сохраняется ссылкой-скачиванием', async () => {
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(new Blob(['jpeg'], { type: 'image/jpeg' })));
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    await downloadFile('/share/a.jpg', 'lifecommit.jpg');
    expect(fetch).toHaveBeenCalledWith(new URL('/share/a.jpg', window.location.href).toString());
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toBe('lifecommit.jpg');
    expect(clicks[0]!.href).toMatch(/^blob:/);
  });

  it('не скачалось — ошибка, а не тишина: «Сохранить» скажет «Не получилось»', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(downloadFile('/share/a.jpg', 'a.jpg')).rejects.toThrow();
    vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(downloadFile('/share/a.jpg', 'a.jpg')).rejects.toThrow();
  });

  it('отправить в чат и облачное хранилище Telegram — на компьютере нет: честный отказ, а не вечное ожидание', async () => {
    await expect(shareMessage('prepared-1')).rejects.toThrow();
    await expect(cloudStorage.getItem('x')).rejects.toThrow();
  });
});

describe('тема и прочее', () => {
  it('тема — системная (светлая в тестовом браузере); приложение красится своими токенами', () => {
    expect(miniApp.isDark()).toBe(false);
    expect(themeParams.bgColor()?.toLowerCase()).toBe('#f6f4ee');
  });

  it('хаптика и «готово» в браузере ничего не ломают; окно поменяло размер — высота пересчитана', async () => {
    hapticFeedback.impactOccurred('light');
    miniApp.ready();
    window.dispatchEvent(new Event('resize'));
    await expect.poll(() => viewport.height()).toBe(window.innerHeight);
  });
});

describe('испорченные события от приложения', () => {
  // Приложение так не шлёт, но мост принимает всё как чужой ввод: без нужного поля — ничего не делает и не падает.
  const send = postEvent as unknown as (method: string, params?: unknown) => void;

  it('без адреса, цвета, видимости — ничего; скачивание без адреса — отказ', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    send('web_app_open_link', {});
    send('web_app_open_tg_link', { path_full: 42 });
    send('web_app_set_header_color', { color_key: 'bg_color' });
    send('web_app_set_bottom_bar_color', {});
    send('web_app_setup_back_button', {});
    send('web_app_setup_main_button', {});
    send('web_app_invoke_custom_method', {});
    send('web_app_frobnicate', { x: 1 });
    expect(open).not.toHaveBeenCalled();
    expect(top().hidden).toBe(true);
    expect(bar().hidden).toBe(true);
    expect(bar().style.background).toBe('');
    await expect(downloadFile('', 'a.jpg')).rejects.toThrow();
  });

  it('подтверждение: кнопки не списком или не объектами — одна «Закрыть»; без текста — пусто', async () => {
    send('web_app_open_popup', { buttons: 'нет', message: 7 });
    await expect.element(page.getByRole('button', { name: 'Закрыть' })).toBeVisible();
    expect(document.querySelector('.host-popup-message')!.textContent).toBe('');
    await page.getByRole('button', { name: 'Закрыть' }).click();
    send('web_app_open_popup', { message: 'Да?', buttons: [1, null, { type: 'destructive' }] });
    await expect.element(page.getByRole('button', { name: 'OK' })).toHaveClass(/danger/);
    await page.getByRole('button', { name: 'OK' }).click();
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
  });
});
