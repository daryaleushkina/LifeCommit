// Окно «Поделиться»: шаблоны листаются, выбранная картинка готовится заранее (одна загрузка на картинку),
// кнопки «В сторис», «Отправить в чат», «Сохранить» и просьба разрешить боту писать при 403.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { LangContext } from '../i18n';
import { renderApp } from '../test/render';
import type { Template } from './draw';

const sdk = vi.hoisted(() => {
  const feature = <F extends (...a: never[]) => unknown>(impl: F) => Object.assign(vi.fn(impl), { isAvailable: vi.fn(() => true) });
  return {
    shareStory: feature(() => {}),
    shareMessage: feature(async (_id: string) => {}),
    downloadFile: feature(async (_url: string, _name: string) => {}),
    requestWriteAccess: feature(async (): Promise<string> => 'allowed'),
    openLink: { ifAvailable: vi.fn() },
    initData: { user: vi.fn((): { is_premium?: boolean } | undefined => ({ is_premium: false })) },
  };
});
vi.mock('@tma.js/sdk-react', () => sdk);
// На компьютере (приложение для Mac, браузер) сторис и отправки в чат нет — только «Сохранить».
const desk = vi.hoisted(() => ({ desktop: false }));
vi.mock('../desktop/session', () => ({ isDesktop: () => desk.desktop }));

vi.mock('../api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  }
  return { ApiError, api: { share: vi.fn(), shareChat: vi.fn(), writeAccess: vi.fn() } };
});

vi.mock('./draw', async (importOriginal) => {
  const m = await importOriginal<typeof import('./draw')>();
  return { ...m, draw: vi.fn(m.draw), fontsReady: vi.fn(m.fontsReady), render: vi.fn(m.render) };
});

import { api, ApiError } from '../api';
import { draw, fontsReady, render } from './draw';
import { ShareSheet } from './ShareSheet';

const m = vi.mocked(api);
const footer = 'Отмечаю в LifeCommit';
const TEMPLATES: Template[] = [
  { kind: 'number', title: 'Вода', big: '42', caption: 'дня подряд', footer },
  { kind: 'month-dark', title: 'Октябрь 2026', big: '12', caption: 'дней', lead: 3, levels: Array(31).fill(2), footer },
  { kind: 'sum-list', title: 'Мой октябрь', rows: [{ n: '8', u: 'раз', t: 'Зарядка' }], footer },
];
const uploaded = (i: number) => ({ url: `https://cdn/${i}.jpg`, file_id: `F${i}` });

const cards = page.getByRole('img', { name: 'Картинка, которой можно поделиться' });
const story = page.getByRole('button', { name: 'В сторис Telegram' });
const chat = page.getByRole('button', { name: 'Отправить в чат' });
const save = page.getByRole('button', { name: 'Сохранить' });
const card = (i: number) => cards.nth(i).element() as HTMLCanvasElement;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function open(templates = TEMPLATES, onClose = () => {}) {
  const r = await renderApp(<ShareSheet templates={templates} onClose={onClose} />);
  // Первая картинка готовится, как только превью нарисованы.
  await expect.poll(() => m.share.mock.calls.length).toBe(1);
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Отрисовке — снова настоящая реализация: тест «картинка не собралась» ломает её до конца файла.
  for (const f of [draw, fontsReady, render]) vi.mocked(f).mockReset();
  desk.desktop = false;
  for (const f of [sdk.shareStory, sdk.shareMessage, sdk.downloadFile, sdk.requestWriteAccess]) f.isAvailable.mockReturnValue(true);
  sdk.requestWriteAccess.mockResolvedValue('allowed');
  sdk.initData.user.mockReturnValue({ is_premium: false });
  let n = 0;
  m.share.mockImplementation(async () => uploaded(n++));
  m.shareChat.mockResolvedValue({ prepared_id: 'P1' });
  m.writeAccess.mockResolvedValue({ ok: true });
});
afterEach(async () => {
  // Закрыть окно и дождаться начатых картинок: иначе их загрузка попала бы в счётчики следующего теста.
  await cleanup();
  await Promise.allSettled(vi.mocked(render).mock.results.map((r) => r.value));
  vi.restoreAllMocks();
});

/** Тот же экран с языком — rerender без обёртки пересоздал бы окно целиком. */
const sheet = (templates: Template[]) => (
  <LangContext.Provider value="ru">
    <ShareSheet templates={templates} onClose={() => {}} />
  </LangContext.Provider>
);

describe('лента шаблонов', () => {
  it('превью на каждый шаблон, первый выбран, точки по числу шаблонов', async () => {
    await open();
    expect(cards.all()).toHaveLength(3);
    await expect.element(cards.nth(0)).toHaveClass(/\bon\b/);
    await expect.element(cards.nth(1)).not.toHaveClass(/\bon\b/);
    expect(document.querySelectorAll('.share-dots i')).toHaveLength(3);
    expect(document.querySelector('.share-dots i')!.className).toBe('on');
    // Превью нарисованы в уменьшенном размере и не пустые.
    expect(card(0).width).toBe(720);
    const corner = card(0).getContext('2d')!.getImageData(4, 4, 1, 1).data;
    expect([...corner]).toEqual([15, 21, 17, 255]);
  });

  it('один шаблон — без точек', async () => {
    await open(TEMPLATES.slice(0, 1));
    expect(document.querySelector('.share-dots')).toBeNull();
  });

  it('видимая картинка готовится заранее: полный JPEG уходит боту один раз, нажатие его дожидается', async () => {
    await open();
    const blob = m.share.mock.calls[0]![0];
    expect(blob.type).toBe('image/jpeg');
    expect(render).toHaveBeenCalledWith(TEMPLATES[0], { bot: '@LifeCommit_bot · бесплатно в Telegram' });
    await story.click();
    expect(sdk.shareStory).toHaveBeenCalledWith('https://cdn/0.jpg', undefined);
    await save.click();
    expect(m.share).toHaveBeenCalledTimes(1);
  });

  it('тап по соседней картинке выбирает её и готовит; повторный тап — ничего', async () => {
    await open();
    card(1).click();
    await expect.element(cards.nth(1)).toHaveClass(/\bon\b/);
    await expect.element(cards.nth(0)).not.toHaveClass(/\bon\b/);
    await expect.poll(() => m.share.mock.calls.length).toBe(2);
    expect(render).toHaveBeenLastCalledWith(TEMPLATES[1], expect.anything());
    card(1).click();
    await save.click();
    expect(sdk.downloadFile).toHaveBeenCalledWith('https://cdn/1.jpg', 'lifecommit.jpg');
    expect(m.share).toHaveBeenCalledTimes(2);
  });

  it('пролистали ленту — выбрана картинка в центре', async () => {
    await open();
    const strip = document.querySelector<HTMLElement>('.share-strip')!;
    strip.style.scrollSnapType = 'none';
    strip.scrollLeft = (card(0).offsetWidth + 12) * 2;
    await expect.element(cards.nth(2)).toHaveClass(/\bon\b/);
    expect(document.querySelectorAll('.share-dots i')[2]!.className).toBe('on');
  });

  it('шаблоны поменялись (догрузился итог) — перерисовка и новая загрузка; те же — ничего', async () => {
    const r = await open();
    const draws = vi.mocked(draw).mock.calls.length;
    await r.rerender(sheet(TEMPLATES.map((t) => ({ ...t }))));
    expect(vi.mocked(draw).mock.calls.length).toBe(draws);
    const next = TEMPLATES.map((t) => ({ ...t, footer: 'Считаю дни в LifeCommit' }));
    await r.rerender(sheet(next));
    await expect.poll(() => m.share.mock.calls.length).toBe(2);
    expect(render).toHaveBeenLastCalledWith(next[0], expect.anything());
  });

  it('шаблоны поменялись, пока ждали подготовки, — готовим новую картинку, а не старую', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      const r = await renderApp(<ShareSheet templates={TEMPLATES} onClose={() => {}} />);
      // Превью нарисованы, и таймер подготовки (350 мс) уже стоит со старыми шаблонами
      // (второй таймер — запасные 1,5 с ожидания шрифта).
      while (vi.mocked(draw).mock.calls.length < 3 || vi.getTimerCount() < 2) await frame();
      const next = TEMPLATES.map((t) => ({ ...t, footer: 'Считаю дни в LifeCommit' }));
      await r.rerender(sheet(next));
      while (vi.mocked(draw).mock.calls.length < 6) await frame();
      await frame();
      vi.advanceTimersByTime(350);
      await vi.waitUntil(() => vi.mocked(render).mock.calls.length > 0, { timeout: 2000 });
      expect(vi.mocked(render).mock.calls.map((c) => c[0])).toEqual([next[0]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('закрыли до загрузки шрифта — ничего не рисуем', async () => {
    const fonts = deferred<void>();
    vi.mocked(fontsReady).mockReturnValueOnce(fonts.promise);
    const r = await renderApp(<ShareSheet templates={TEMPLATES} onClose={() => {}} />);
    await r.unmount();
    fonts.resolve();
    await fonts.promise;
    expect(draw).not.toHaveBeenCalled();
  });

  it('Escape закрывает окно', async () => {
    const onClose = vi.fn();
    await open(TEMPLATES, onClose);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('кнопки', () => {
  it('Premium — в сторис ещё и ссылка-виджет на бота', async () => {
    sdk.initData.user.mockReturnValue({ is_premium: true });
    await open();
    await story.click();
    expect(sdk.shareStory).toHaveBeenCalledWith('https://cdn/0.jpg', { widgetLink: { url: 'https://t.me/LifeCommit_bot', name: 'LifeCommit' } });
  });

  it('без пользователя в initData — как без Premium', async () => {
    sdk.initData.user.mockReturnValue(undefined);
    await open();
    await story.click();
    expect(sdk.shareStory).toHaveBeenCalledWith('https://cdn/0.jpg', undefined);
  });

  it('сторис недоступны (Desktop) — кнопки нет', async () => {
    sdk.shareStory.isAvailable.mockReturnValue(false);
    await open();
    await expect.element(story).not.toBeInTheDocument();
    await expect.element(chat).toBeVisible();
  });

  it('в чат: подготовленное сообщение — shareMessage с подписью', async () => {
    await open();
    await chat.click();
    expect(m.shareChat).toHaveBeenCalledWith('F0', 'LifeCommit · t.me/LifeCommit_bot');
    expect(sdk.shareMessage).toHaveBeenCalledWith('P1');
    await expect.element(page.getByText('Картинка — в чате с ботом', { exact: false })).not.toBeInTheDocument();
  });

  it('в чат: подготовить не вышло — картинка у бота, говорим об этом', async () => {
    m.shareChat.mockResolvedValue({ sent: true });
    await open();
    await chat.click();
    expect(sdk.shareMessage).not.toHaveBeenCalled();
    await expect.element(page.getByText('Картинка — в чате с ботом: оттуда её можно переслать.')).toBeVisible();
  });

  it('в чат: shareMessage нет в этой версии Telegram — тоже через бота', async () => {
    sdk.shareMessage.isAvailable.mockReturnValue(false);
    await open();
    await chat.click();
    expect(sdk.shareMessage).not.toHaveBeenCalled();
    await expect.element(page.getByText('Картинка — в чате с ботом', { exact: false })).toBeVisible();
  });

  it('сохранить: downloadFile, а если его нет — открыть ссылку', async () => {
    await open();
    await save.click();
    expect(sdk.downloadFile).toHaveBeenCalledWith('https://cdn/0.jpg', 'lifecommit.jpg');
    sdk.downloadFile.isAvailable.mockReturnValue(false);
    await save.click();
    expect(sdk.openLink.ifAvailable).toHaveBeenCalledWith('https://cdn/0.jpg');
  });

  it('пока готовится — кнопки выключены и «Готовлю картинку…»', async () => {
    const job = deferred<{ url: string; file_id: string }>();
    m.share.mockReturnValue(job.promise);
    await renderApp(<ShareSheet templates={TEMPLATES} onClose={() => {}} />);
    await expect.poll(() => m.share.mock.calls.length).toBe(1);
    await chat.click();
    const busy = page.getByRole('button', { name: 'Готовлю картинку…' });
    await expect.element(busy).toBeDisabled();
    await expect.element(chat).toBeDisabled();
    await expect.element(save).toBeDisabled();
    job.resolve(uploaded(0));
    await expect.element(chat).toBeEnabled();
    expect(m.shareChat).toHaveBeenCalledWith('F0', expect.any(String));
  });

  it('заранее не загрузилось — по нажатию пробуем снова', async () => {
    m.share.mockRejectedValueOnce(new ApiError(500, 'failed'));
    await open();
    await story.click();
    await vi.waitFor(() => expect(sdk.shareStory).toHaveBeenCalledWith('https://cdn/0.jpg', undefined));
    expect(m.share).toHaveBeenCalledTimes(2);
  });
});

describe('бот не может писать (403)', () => {
  /** Бот не может писать, пока не разрешили. */
  function blockedUntilAllowed() {
    let allowed = false;
    m.share.mockImplementation(async () => {
      if (!allowed) throw new ApiError(403, 'bot_blocked');
      return uploaded(9);
    });
    sdk.requestWriteAccess.mockImplementation(async () => {
      allowed = true;
      return 'allowed';
    });
  }

  it('просим разрешение по нажатию, сообщаем серверу и грузим снова', async () => {
    blockedUntilAllowed();
    await open();
    expect(sdk.requestWriteAccess).not.toHaveBeenCalled(); // заранее не спрашиваем
    await story.click();
    await vi.waitFor(() => expect(sdk.shareStory).toHaveBeenCalledWith('https://cdn/9.jpg', undefined));
    expect(sdk.requestWriteAccess).toHaveBeenCalledTimes(1);
    expect(m.writeAccess).toHaveBeenCalled();
  });

  it('сервер не узнал о разрешении — не страшно, грузим всё равно', async () => {
    blockedUntilAllowed();
    m.writeAccess.mockRejectedValue(new ApiError(500, 'failed'));
    await open();
    await save.click();
    await vi.waitFor(() => expect(sdk.downloadFile).toHaveBeenCalledWith('https://cdn/9.jpg', 'lifecommit.jpg'));
  });

  it('не разрешили — просим разрешить', async () => {
    m.share.mockRejectedValue(new ApiError(403, 'bot_blocked'));
    sdk.requestWriteAccess.mockResolvedValue('rejected');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    await story.click();
    await expect.element(page.getByText('Разрешите боту писать вам', { exact: false })).toBeVisible();
    expect(sdk.shareStory).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('запросить разрешение нельзя — тоже просим разрешить', async () => {
    m.share.mockRejectedValue(new ApiError(403, 'bot_blocked'));
    sdk.requestWriteAccess.isAvailable.mockReturnValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    await chat.click();
    expect(sdk.requestWriteAccess).not.toHaveBeenCalled();
    await expect.element(page.getByText('Разрешите боту писать вам', { exact: false })).toBeVisible();
  });

  it('другая ошибка — «Не получилось», разрешение не спрашиваем; новая попытка убирает текст', async () => {
    m.share.mockRejectedValue(new ApiError(500, 'failed'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    await story.click();
    const note = page.getByText('Не получилось. Попробуйте ещё раз.');
    await expect.element(note).toBeVisible();
    expect(sdk.requestWriteAccess).not.toHaveBeenCalled();
    m.share.mockResolvedValue(uploaded(1));
    await story.click();
    await expect.element(note).not.toBeInTheDocument();
  });

  it('ошибка не от API (картинка не собралась) — «Не получилось»', async () => {
    vi.mocked(render).mockRejectedValue(new Error('toBlob'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderApp(<ShareSheet templates={TEMPLATES} onClose={() => {}} />);
    await save.click();
    await expect.element(page.getByText('Не получилось. Попробуйте ещё раз.')).toBeVisible();
    expect(m.share).not.toHaveBeenCalled();
  });
});

describe('на компьютере', () => {
  it('только «Сохранить» — крупной кнопкой; сторис и чата нет', async () => {
    desk.desktop = true;
    await open();
    await expect.element(save).toHaveClass(/primary/);
    await expect.element(story).not.toBeInTheDocument();
    await expect.element(chat).not.toBeInTheDocument();
    await save.click();
    expect(sdk.downloadFile).toHaveBeenCalledWith('https://cdn/0.jpg', 'lifecommit.jpg');
  });
});
