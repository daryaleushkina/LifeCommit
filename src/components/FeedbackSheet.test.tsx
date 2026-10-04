// Шторка «Сообщить о проблеме»: текст, голос в поле, до 4 скриншотов, контекст, «Отправить» → «Получили, спасибо!».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { api, ApiError } from '../api';
import { renderApp } from '../test/render';
import { FeedbackSheet } from './FeedbackSheet';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: { feedback: vi.fn(), feedbackVoice: vi.fn() } }));

const mic = vi.hoisted(() => ({
  can: true,
  startError: null as Error | null,
  made: [] as { cancel: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
}));
vi.mock('../voice/recorder', () => ({
  canRecord: () => mic.can,
  Recorder: class {
    cancel = vi.fn();
    stop = vi.fn(async () => ({ audio: new Blob(['голос'], { type: 'audio/webm' }), seconds: 3 }));
    constructor() {
      mic.made.push(this);
    }
    async start() {
      if (mic.startError) throw mic.startError;
    }
  },
}));

const feedback = vi.mocked(api.feedback);
const feedbackVoice = vi.mocked(api.feedbackVoice);

beforeEach(() => {
  vi.clearAllMocks();
  feedback.mockResolvedValue(undefined);
  feedbackVoice.mockResolvedValue('и календарь пустой');
  mic.can = true;
  mic.startError = null;
  mic.made = [];
});
afterEach(() => vi.restoreAllMocks());

/** Настоящая картинка w×h в PNG — её ужмёт настоящий canvas. */
async function png(w: number, h: number, name = 'shot.png'): Promise<File> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.fillRect(0, 0, w, h);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}

function open(lang: 'ru' | 'en' = 'ru') {
  const onClose = vi.fn();
  const r = renderApp(<FeedbackSheet theme="dark" onClose={onClose} />, lang);
  return { r, onClose };
}

const text = () => page.getByRole('textbox', { name: 'Что случилось?' });
const send = () => page.getByRole('button', { name: 'Отправить' });
const shotInput = () => page.getByLabelText('+ Скриншот');

describe('текст', () => {
  it('пусто — «Отправить» не нажать; написали — уходит текст с контекстом, дальше «Получили, спасибо!»', async () => {
    const { r, onClose } = open();
    await r;
    await expect.element(page.getByRole('dialog', { name: 'Что случилось?' })).toBeVisible();
    await expect.element(page.getByText('Приложим: версию приложения, устройство и экран')).toBeVisible();
    await expect.element(send()).toBeDisabled();
    await text().fill('   ');
    await expect.element(send()).toBeDisabled();
    await text().fill('  Не сохраняется дело\nна «Сегодня»  ');
    await send().click();
    await expect.element(page.getByRole('dialog', { name: 'Получили, спасибо!' })).toBeVisible();
    expect(feedback).toHaveBeenCalledWith(
      'Не сохраняется дело\nна «Сегодня»',
      expect.objectContaining({ version: 'dev', lang: 'ru', theme: 'dark', screen: 'me', viewport: expect.stringMatching(/^\d+×\d+$/), tz: expect.any(String), platform: expect.any(String) }),
      [],
    );
    await page.getByRole('button', { name: 'Готово' }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it('пока уходит — кнопка занята; лимит — «Уже много за сегодня», написанное остаётся', async () => {
    let fail: (e: unknown) => void = () => {};
    feedback.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    const { r } = open();
    await r;
    await text().fill('Белый экран');
    await send().click();
    await expect.element(send()).toBeDisabled();
    fail(new ApiError(429, 'feedback_limit'));
    await expect.element(page.getByText('Уже много за сегодня — завтра примем ещё.')).toBeVisible();
    await expect.element(text()).toHaveValue('Белый экран');
    await expect.element(send()).toBeEnabled();
  });

  it('потолок проекта — тоже «Уже много»; сеть или сервер — «Что-то пошло не так»', async () => {
    feedback.mockRejectedValueOnce(new ApiError(429, 'feedback_busy')).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { r } = open();
    await r;
    await text().fill('Белый экран');
    await send().click();
    await expect.element(page.getByText('Уже много за сегодня — завтра примем ещё.')).toBeVisible();
    await send().click();
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
  });

  it('по-английски', async () => {
    const { r } = open('en');
    await r;
    await expect.element(page.getByRole('dialog', { name: 'What happened?' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});

describe('скриншоты', () => {
  it('скриншот ужимается до JPEG 1280 px и уходит вместе с текстом; можно убрать; без текста — тоже можно отправить', async () => {
    const { r } = open();
    await r;
    await shotInput().upload(await png(2560, 1440));
    await expect.element(page.getByRole('button', { name: 'Убрать скриншот' })).toBeVisible();
    await expect.element(send()).toBeEnabled();
    await shotInput().upload(await png(100, 50));
    await expect.element(page.getByRole('button', { name: 'Убрать скриншот' }).nth(1)).toBeVisible();
    await page.getByRole('button', { name: 'Убрать скриншот' }).nth(1).click();
    await expect.element(page.getByRole('button', { name: 'Убрать скриншот' }).nth(1)).not.toBeInTheDocument();
    await send().click();
    await expect.element(page.getByRole('dialog', { name: 'Получили, спасибо!' })).toBeVisible();
    const [, , shots] = feedback.mock.lastCall!;
    expect(shots).toHaveLength(1);
    expect(shots[0]!.type).toBe('image/jpeg');
    const bitmap = await createImageBitmap(shots[0]!);
    expect([bitmap.width, bitmap.height]).toEqual([1280, 720]);
  });

  it('больше 4 — берём 4 и говорим; «+ Скриншот» пропадает', async () => {
    const { r } = open();
    await r;
    const files = await Promise.all([1, 2, 3, 4, 5].map((n) => png(20, 20, `${n}.png`)));
    await shotInput().upload(files);
    await expect.element(page.getByText('Не больше 4 скриншотов.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Убрать скриншот' }).nth(3)).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Убрать скриншот' }).nth(4)).not.toBeInTheDocument();
    await expect.element(shotInput()).not.toBeInTheDocument();
  });

  it('не картинка — «попробуй другую», ничего не добавлено', async () => {
    const { r } = open();
    await r;
    await shotInput().upload(new File(['это не картинка'], 'note.png', { type: 'image/png' }));
    await expect.element(page.getByText('Эту картинку не получилось прочитать — попробуй другую.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Убрать скриншот' })).not.toBeInTheDocument();
  });
});

describe('голос', () => {
  const micButton = () => page.getByRole('button', { name: 'Сказать голосом' });
  const stopButton = () => page.getByRole('button', { name: 'Закончить запись' });

  it('запись → расшифровка дописывается в поле с новой строки', async () => {
    const { r } = open();
    await r;
    await text().fill('Не открывается календарь');
    await micButton().click();
    await expect.element(page.getByText('Говори — нажми ещё раз, чтобы закончить')).toBeVisible();
    await expect.element(send()).toBeDisabled();
    await stopButton().click();
    await expect.element(text()).toHaveValue('Не открывается календарь\nи календарь пустой');
    expect(feedbackVoice).toHaveBeenCalledWith(expect.any(Blob));
    // В пустое поле — без пустой строки сверху.
    await text().fill('');
    await micButton().click();
    await stopButton().click();
    await expect.element(text()).toHaveValue('и календарь пустой');
  });

  it('лимит голоса, сбой распознавания и пустая расшифровка — просим текстом', async () => {
    feedbackVoice.mockRejectedValueOnce(new ApiError(429, 'voice_limit')).mockRejectedValueOnce(new ApiError(502, 'failed')).mockResolvedValueOnce('');
    const { r } = open();
    await r;
    await micButton().click();
    await stopButton().click();
    await expect.element(page.getByText('Голосовых на сегодня хватит — напиши текстом.')).toBeVisible();
    await micButton().click();
    await stopButton().click();
    await expect.element(page.getByText('Не получилось разобрать голос — напиши текстом.')).toBeVisible();
    await micButton().click();
    await expect.element(page.getByText('Не получилось разобрать голос — напиши текстом.')).not.toBeInTheDocument();
    await stopButton().click();
    await expect.element(page.getByText('Не получилось разобрать голос — напиши текстом.')).toBeVisible();
    await expect.element(text()).toHaveValue('');
  });

  it('нет микрофона или доступ не дали — «Микрофон недоступен»', async () => {
    mic.can = false;
    const { r } = open();
    await r;
    await micButton().click();
    await expect.element(page.getByText('Микрофон недоступен — напиши текстом.')).toBeVisible();
    mic.can = true;
    mic.startError = new DOMException('denied', 'NotAllowedError');
    await micButton().click();
    await expect.element(micButton()).toBeVisible();
    expect(mic.made[0]!.cancel).toHaveBeenCalled();
  });

  it('закрыли шторку во время записи — микрофон отпущен', async () => {
    const { r } = open();
    const screen = await r;
    await micButton().click();
    await expect.element(stopButton()).toBeVisible();
    await screen.unmount();
    expect(mic.made[0]!.cancel).toHaveBeenCalled();
  });
});
