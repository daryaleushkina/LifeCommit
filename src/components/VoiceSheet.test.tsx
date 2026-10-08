// Голос: запись → «Разбираю…» с расслышанной фразой → список дел и привычек → «Добавить».
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { GroupItemDraft } from '../../shared/groups';
import type { TaskInput, TodoInput, VoiceAction } from '../../shared/types';
import { api, ApiError } from '../api';
import { renderApp } from '../test/render';
import { VoiceSheet, type GroupVoiceItem, type VoicePreview } from './VoiceSheet';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: { voice: vi.fn() } }));
const tg = vi.hoisted(() => ({ notify: vi.fn(), openTg: vi.fn() }));
vi.mock('@tma.js/sdk-react', async (orig) => ({
  ...(await orig<typeof import('@tma.js/sdk-react')>()),
  hapticFeedback: { notificationOccurred: { ifAvailable: tg.notify } },
  openTelegramLink: { ifAvailable: tg.openTg },
}));

/** Подменённый микрофон: сколько «записано», что отдаёт остановка, громкость для волны. */
const mic = vi.hoisted(() => ({
  can: true,
  startError: null as Error | null,
  startGate: null as Promise<void> | null,
  seconds: 0,
  result: null as { audio: Blob; seconds: number } | null,
  levels: null as Uint8Array | null,
  made: [] as { cancel: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
}));
vi.mock('../voice/recorder', () => ({
  canRecord: () => mic.can,
  Recorder: class {
    cancel = vi.fn();
    stop = vi.fn(async () => mic.result!);
    constructor() {
      mic.made.push(this);
    }
    async start() {
      if (mic.startGate) await mic.startGate;
      if (mic.startError) throw mic.startError;
    }
    get seconds() {
      return mic.seconds;
    }
    levels() {
      return mic.levels;
    }
  },
}));

// 3 октября 2026 — суббота.
const TODAY = '2026-10-03';
const audio = new Blob(['голос'], { type: 'audio/webm' });

const habit = (p: Partial<TaskInput>): TaskInput => ({ title: 'Читать', kind: 'count', target: 20, unit: 'страниц', ...p });
const draft = (p: Partial<GroupItemDraft>): GroupItemDraft => ({
  title: 'Дело', mode: 'one', day: TODAY, time: null, rrule: null, assignees: [], all_members: false, rotate: false, target: null, unit: null, duration_min: null, ...p,
});
const gi = (item: Partial<GroupItemDraft>, names: string[] = [], group = { id: 10, title: 'Семья' }): GroupVoiceItem => ({ type: 'create_group_item', group, item: draft(item), names });
const keyed = <T extends object>(row: T) => ({ ...row, key: expect.stringMatching(/^[0-9a-f]{32}$/) });

let latest: VoicePreview | null;
function setup(opts: { preview?: VoicePreview; room?: number | null; groupId?: number | null; groups?: { id: number; title: string }[] } = {}) {
  const cb = { setPreview: vi.fn(), onEdit: vi.fn(), onAdd: vi.fn<Parameters<typeof VoiceSheet>[0]['onAdd']>(async () => {}), onManual: vi.fn(), onClose: vi.fn() };
  latest = opts.preview ?? null;
  function Host() {
    const [preview, setPreview] = useState<VoicePreview | null>(opts.preview ?? null);
    latest = preview;
    return (
      <VoiceSheet
        preview={preview}
        setPreview={(p) => {
          cb.setPreview(p);
          setPreview(p);
        }}
        room={opts.room === undefined ? null : opts.room}
        today={TODAY}
        groupId={opts.groupId}
        groups={opts.groups}
        onEdit={cb.onEdit}
        onAdd={cb.onAdd}
        onManual={cb.onManual}
        onClose={cb.onClose}
      />
    );
  }
  return { r: renderApp(<Host />), ...cb };
}

const backdrop = () => document.querySelector<HTMLElement>('.sheet-backdrop')!;
const stopBtn = () => page.getByRole('button', { name: 'Готово, разобрать' });
const heading = () => page.getByRole('heading', { level: 2 });

beforeEach(() => {
  vi.clearAllMocks();
  mic.can = true;
  mic.startError = null;
  mic.startGate = null;
  mic.seconds = 0;
  mic.result = { audio, seconds: 3 };
  mic.levels = null;
  mic.made = [];
});
afterEach(() => vi.restoreAllMocks());

describe('нет микрофона', () => {
  it('записывать нечем — сразу ведём к боту, без экрана записи', async () => {
    mic.can = false;
    const { r, onManual, onClose } = setup();
    await r;
    await expect.element(heading()).toHaveTextContent('Микрофон недоступен');
    expect(mic.made).toHaveLength(0);
    await page.getByRole('button', { name: 'Открыть чат с ботом' }).click();
    expect(tg.openTg).toHaveBeenCalledWith('https://t.me/LifeCommit_bot');
    await page.getByRole('button', { name: 'Выбрать вручную' }).click();
    expect(onManual).toHaveBeenCalledOnce();
    backdrop().click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('доступ к микрофону не дали — то же', async () => {
    mic.startError = new Error('NotAllowedError');
    await setup().r;
    await expect.element(heading()).toHaveTextContent('Микрофон недоступен');
    expect(mic.made).toHaveLength(1);
  });
});

describe('запись', () => {
  it('слушаем: таймер, волна; тап мимо шторки не прерывает, «Отмена» — закрывает и бросает запись', async () => {
    mic.levels = new Uint8Array(32).fill(255);
    const { r, onClose } = setup();
    await r;
    await expect.element(page.getByText('Говори — я слушаю')).toBeVisible();
    await expect.element(page.getByText('0:00')).toBeVisible();
    mic.seconds = 65.4;
    await expect.element(page.getByText('1:05')).toBeVisible();
    // Волна: середина выше краёв.
    const bars = [...document.querySelectorAll<HTMLElement>('.wave i')];
    expect(bars).toHaveLength(17);
    await expect.poll(() => bars[8]!.style.transform).toBe('scaleY(1)');
    expect(bars[0]!.style.transform).toBe('scaleY(0.614)');
    expect(bars[16]!.style.transform).toBe('scaleY(0.614)');
    backdrop().click();
    expect(onClose).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Отмена' }).click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(mic.made[0]!.cancel).toHaveBeenCalled();
  });

  // Одной фразой — и в группу, и себе (просьба владелицы 04.10.2026): пока человек говорит, видно, как назвать группу.
  it('групп нет — только общий пример', async () => {
    await setup().r;
    await expect.element(page.getByText(/^Например:/)).toBeVisible();
    expect(document.querySelector('.voice-tip')).toBeNull();
  });

  it('есть группы — как назвать группу голосом и вернуться к своему; эмодзи из названия не произносят', async () => {
    await setup({ groups: [{ id: 2, title: 'Семья ❤️' }, { id: 3, title: 'Тестим бота' }] }).r;
    await expect.element(page.getByText('Для группы назови её: «в группу Семья: в субботу уборка, а себе — купить молоко»')).toBeVisible();
  });

  it('с экрана группы — сказанное пойдёт в неё, своё — после «себе»', async () => {
    await setup({ groupId: 3, groups: [{ id: 2, title: 'Семья ❤️' }, { id: 3, title: 'Тестим бота' }] }).r;
    await expect.element(page.getByText('Сказанное пойдёт в группу «Тестим бота». Своё — после слова «себе»')).toBeVisible();
  });

  it('с экрана группы, которой ещё нет в списке, — без подсказки про другую группу', async () => {
    await setup({ groupId: 9, groups: [{ id: 2, title: 'Семья ❤️' }] }).r;
    await expect.element(page.getByText(/^Например:/)).toBeVisible();
    expect(document.querySelector('.voice-tip')).toBeNull();
  });

  it('название из одних эмодзи — как есть', async () => {
    await setup({ groups: [{ id: 4, title: ' 🏃‍♀️ ' }] }).r;
    await expect.element(page.getByText(/^Для группы назови её/)).toBeVisible();
    expect(document.querySelector('.voice-tip')!.textContent).toContain('«в группу 🏃‍♀️: в субботу');
  });

  it('без анализатора волна просто дышит', async () => {
    await setup().r;
    const bar = () => document.querySelector<HTMLElement>('.wave i')!;
    await expect.poll(() => bar().style.transform).toBe('scaleY(0.18)');
  });

  it('слишком коротко — «Ничего не расслышал», «Сказать ещё раз» снова слушает', async () => {
    mic.result = { audio, seconds: 0.5 };
    const { r, setPreview } = setup();
    await r;
    await stopBtn().click();
    await expect.element(heading()).toHaveTextContent('Не понял, что добавить');
    await expect.element(page.getByText(/Ничего не расслышал/)).toBeVisible();
    expect(api.voice).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Сказать ещё раз' }).click();
    await expect.element(page.getByText('Говори — я слушаю')).toBeVisible();
    expect(mic.made).toHaveLength(2);
    expect(setPreview).toHaveBeenLastCalledWith(null);
  });

  it('пустая запись тоже не отправляется', async () => {
    mic.result = { audio: new Blob([]), seconds: 5 };
    await setup().r;
    await stopBtn().click();
    await expect.element(heading()).toHaveTextContent('Не понял, что добавить');
    expect(api.voice).not.toHaveBeenCalled();
  });

  it('на пределе длины останавливается сама', async () => {
    vi.mocked(api.voice).mockReturnValue(new Promise(() => {}));
    await setup().r;
    await expect.element(page.getByText('Говори — я слушаю')).toBeVisible();
    mic.seconds = 90;
    await expect.element(heading()).toHaveTextContent('Разбираю…');
    expect(mic.made[0]!.stop).toHaveBeenCalledOnce();
  });
});

describe('разбор', () => {
  it('сначала «перевожу голос», потом расслышанная фраза, потом список; на экране группы — в группу', async () => {
    let finish!: (a: VoiceAction[]) => void;
    let onText!: (text: string) => void;
    vi.mocked(api.voice).mockImplementation((_audio, cb) => {
      onText = cb;
      return new Promise((res) => (finish = res));
    });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    const { r, setPreview } = setup({ groupId: 10 });
    await r;
    await stopBtn().click();
    await expect.element(heading()).toHaveTextContent('Разбираю…');
    await expect.element(page.getByText('Перевожу голос в текст')).toBeVisible();
    expect(vi.mocked(api.voice).mock.calls[0]![0]).toBe(audio);
    expect(vi.mocked(api.voice).mock.calls[0]![2]).toBe(10);
    onText('купить молоко');
    await expect.element(page.getByText('Ищу в ней дела и привычки')).toBeVisible();
    // Фраза «проявляется» из перебирающихся букв слева направо и встаёт как есть.
    const quote = page.getByLabelText('купить молоко');
    const seen: string[] = [];
    new MutationObserver(() => seen.push(quote.element().textContent!)).observe(quote.element(), { subtree: true, childList: true, characterData: true });
    await expect.poll(() => seen.length, { timeout: 3000 }).toBeGreaterThan(1);
    await expect.poll(() => seen.at(-1), { timeout: 3000 }).toBe('«купить молоко»');
    expect(seen.slice(0, -1).some((x) => x !== '«купить молоко»' && x.length === '«купить молоко»'.length)).toBe(true);
    // Пробел не перебирается.
    expect(seen.every((x) => x[7] === ' ')).toBe(true);
    const todo: TodoInput = { title: 'Купить молоко' };
    finish([{ type: 'create_todo', todo }]);
    await expect.element(heading()).toHaveTextContent('Вот что получилось');
    expect(setPreview).toHaveBeenLastCalledWith({ text: 'купить молоко', habits: [], todos: [keyed(todo)], groupItems: [] });
    expect(tg.notify).toHaveBeenCalledWith('success');
  });

  it('привычки, дела и групповые дела раскладываются по своим спискам', async () => {
    const h = habit({});
    const todo: TodoInput = { title: 'Хлеб' };
    const g = gi({ title: 'Мусор' });
    vi.mocked(api.voice).mockResolvedValue([{ type: 'create_habit', habit: h }, g, { type: 'create_todo', todo }]);
    const { r, setPreview } = setup();
    await r;
    await stopBtn().click();
    await expect.element(heading()).toHaveTextContent('Вот что получилось');
    expect(setPreview).toHaveBeenLastCalledWith({ text: '', habits: [keyed(h)], todos: [keyed(todo)], groupItems: [keyed(g)] });
    expect(new Set([latest!.habits[0]!.key, latest!.todos[0]!.key, latest!.groupItems[0]!.key]).size).toBe(3);
  });

  it('двойное нажатие «Готово» отправляет запись один раз; пока она дописывается, таймер стоит на нуле', async () => {
    let release!: () => void;
    mic.seconds = 5;
    vi.mocked(api.voice).mockReturnValue(new Promise(() => {}));
    await setup().r;
    await expect.element(page.getByText('0:05')).toBeVisible();
    mic.made[0]!.stop.mockReturnValueOnce(new Promise((res) => (release = () => res({ audio, seconds: 5 }))));
    const btn = stopBtn().element() as HTMLButtonElement;
    btn.click();
    btn.click();
    expect(mic.made[0]!.stop).toHaveBeenCalledOnce();
    await expect.element(page.getByText('0:00')).toBeVisible();
    release();
    await expect.element(heading()).toHaveTextContent('Разбираю…');
    expect(api.voice).toHaveBeenCalledOnce();
  });

  it('без анимации, если просили меньше движения', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    vi.mocked(api.voice).mockImplementation((_a, cb) => {
      cb('привет');
      return new Promise(() => {});
    });
    await setup().r;
    await stopBtn().click();
    await expect.element(page.getByLabelText('привет')).toHaveTextContent('«привет»');
  });

  it('ничего не нашлось — показываем, что расслышали', async () => {
    vi.mocked(api.voice).mockImplementation(async (_a, cb) => {
      cb('какая хорошая погода');
      return [];
    });
    await setup().r;
    await stopBtn().click();
    await expect.element(heading()).toHaveTextContent('Не понял, что добавить');
    await expect.element(page.getByText(/«какая хорошая погода»/)).toBeVisible();
  });

  it('лимит на сегодня — только «Выбрать вручную»', async () => {
    vi.mocked(api.voice).mockRejectedValue(new ApiError(429, 'voice_limit'));
    const { r, onManual } = setup();
    await r;
    await stopBtn().click();
    await expect.element(heading()).toHaveTextContent('На сегодня хватит');
    await expect.element(page.getByText('Разбираю до 20 записей в день. Завтра — снова можно.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Сказать ещё раз' })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Выбрать вручную' }).click();
    expect(onManual).toHaveBeenCalledOnce();
  });

  it('другая ошибка — «Не получилось разобрать» и можно ещё раз', async () => {
    vi.mocked(api.voice).mockRejectedValue(new Error('offline'));
    await setup().r;
    await stopBtn().click();
    await expect.element(heading()).toHaveTextContent('Не получилось разобрать');
    await page.getByRole('button', { name: 'Сказать ещё раз' }).click();
    await expect.element(page.getByText('Говори — я слушаю')).toBeVisible();
  });

  it('шторку закрыли, пока шёл разбор, — ответ никуда не идёт', async () => {
    let finish!: (a: VoiceAction[]) => void;
    let onText!: (text: string) => void;
    vi.mocked(api.voice).mockImplementation((_a, cb) => {
      onText = cb;
      return new Promise((res) => (finish = res));
    });
    const { r, setPreview } = setup();
    const { unmount } = await r;
    await stopBtn().click();
    await expect.element(heading()).toHaveTextContent('Разбираю…');
    await unmount();
    setPreview.mockClear();
    onText('поздно');
    finish([{ type: 'create_todo', todo: { title: 'Поздно' } }]);
    await Promise.resolve();
    expect(setPreview).not.toHaveBeenCalled();
    expect(tg.notify).not.toHaveBeenCalled();
  });

  it('закрыли до ошибки разбора — тоже тихо', async () => {
    let fail!: (e: unknown) => void;
    vi.mocked(api.voice).mockReturnValue(new Promise((_res, rej) => (fail = rej)));
    const { r } = setup();
    const { unmount } = await r;
    await stopBtn().click();
    await expect.element(heading()).toHaveTextContent('Разбираю…');
    await unmount();
    fail(new Error('late'));
    await Promise.resolve();
    expect(document.querySelector('.voice-sheet')).toBeNull();
  });

  it('закрыли, пока микрофон включался, — запись бросаем', async () => {
    let open!: () => void;
    mic.startGate = new Promise((res) => (open = res));
    const { r } = setup();
    const { unmount } = await r;
    await unmount();
    open();
    await expect.poll(() => mic.made[0]!.cancel.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('список', () => {
  const full: VoicePreview = {
    text: 'всё сразу',
    todos: [
      { title: 'Купить молоко' },
      { title: 'Встреча', day: '2026-10-04', time: '10:00', duration_min: 60, location: 'Кафе' },
      { title: 'Звонок', day: '2026-10-06', time: '18:30' },
    ],
    habits: [
      habit({}),
      habit({ title: 'Спортзал', kind: 'check', target: 1, unit: null, schedule: 'per_week', per_week: 3 }),
      habit({ title: 'Сладкое', kind: 'abstain', target: 1, unit: null }),
      habit({ title: 'Отжимания', unit: null, target: 30, schedule: 'weekdays', weekdays: 1 | 4 | 16 }),
    ],
    groupItems: [
      gi({ title: 'Отпуск', mode: 'goal', target: 150000 }),
      gi({ title: 'Копилка', mode: 'goal', target: null }),
      gi({ title: 'Ужин', mode: 'event', rrule: 'FREQ=DAILY', time: '19:00' }),
      gi({ title: 'Мусор', mode: 'one', day: '2026-10-04' }),
      gi({ title: 'Посуда', mode: 'assign', all_members: true, rotate: true, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }),
      gi({ title: 'Уборка', mode: 'assign', all_members: true, rrule: 'FREQ=WEEKLY;BYDAY=SA,SU' }),
      gi({ title: 'Цветы', mode: 'assign', rrule: 'FREQ=WEEKLY;BYDAY=TU' }, ['', 'Алёна']),
      gi({ title: 'Пробежка', mode: 'assign', rotate: true }, ['Лёша'], { id: 20, title: 'Спорт' }),
    ],
  };
  const line = (title: string) => page.getByText(title, { exact: true }).element().closest('li')!.querySelector('small')!.textContent!.replace(/\u00a0/g, ' ');

  it('группы, свои дела и привычки — с подписями, что куда и когда', async () => {
    await setup({ preview: full }).r;
    expect(mic.made).toHaveLength(0);
    await expect.element(heading()).toHaveTextContent('Вот что получилось');
    const sections = page.getByRole('heading', { level: 3 }).elements().map((h) => h.textContent);
    expect(sections).toEqual(['В группу «Семья»', 'В группу «Спорт»', 'Дела', 'Привычки']);
    expect(line('Отпуск')).toBe('Общая цель · 150 000');
    expect(line('Копилка')).toBe('Общая цель · 0');
    expect(line('Ужин')).toBe('мероприятие · Каждый день · 19:00');
    expect(line('Мусор')).toBe('кто-то один · завтра');
    expect(line('Посуда')).toBe('по очереди · Будни');
    expect(line('Уборка')).toBe('каждому · Выходные');
    expect(line('Цветы')).toBe('тебе, Алёна · Раз в неделю');
    expect(line('Пробежка')).toBe('Лёша · по очереди · сегодня');
    expect(line('Купить молоко')).toBe('сегодня');
    expect(line('Встреча')).toBe('завтра · 10:00–11:00 · Кафе');
    expect(line('Звонок')).toBe('вт, 6 октября · 18:30');
    expect(line('Читать')).toBe('20 страниц в день · каждый день');
    expect(line('Спортзал')).toBe('3 раза в неделю');
    expect(line('Сладкое')).toBe('бросить');
    expect(line('Отжимания')).toBe('30 в день · пн, ср, пт');
    await expect.element(page.getByRole('button', { name: 'Добавить всё · 15' })).toBeEnabled();
  });

  it('«Добавить» отдаёт всё наверх; ошибка — текст и кнопка снова доступна', async () => {
    const { r, onAdd } = setup({ preview: full });
    await r;
    let fail!: (e: unknown) => void;
    onAdd.mockReturnValueOnce(new Promise((_res, rej) => (fail = rej)));
    const add = page.getByRole('button', { name: 'Добавить всё · 15' });
    await add.click();
    expect(onAdd).toHaveBeenCalledWith(full.todos.map(keyed), full.habits.map(keyed), full.groupItems.map(keyed));
    const first = onAdd.mock.calls[0];
    await expect.element(add).toBeDisabled();
    fail(new ApiError(403, 'task_limit'));
    await expect.element(page.getByText('Бесплатно — до 0 привычек. Можно отложить какую-нибудь.')).toBeVisible();
    await expect.element(add).toBeEnabled();
    onAdd.mockRejectedValueOnce(new Error('offline'));
    await add.click();
    expect(onAdd.mock.calls[1]).toEqual(first);
    await expect.element(page.getByText('Что-то пошло не так. Попробуй ещё раз.')).toBeVisible();
    await expect.element(page.getByText(/Можно отложить/)).not.toBeInTheDocument();
  });

  it('лишнее убирается крестиком; убрали последнее — слушаем заново', async () => {
    const { r } = setup({ preview: { text: '', todos: [{ title: 'Хлеб' }], habits: [habit({})], groupItems: [gi({ title: 'Мусор' })] } });
    await r;
    await page.getByRole('button', { name: 'Убрать «Мусор»' }).click();
    expect(latest!.groupItems).toEqual([]);
    // Групп больше нет — подписи «Дела» и «Привычки» остаются, потому что есть и то и другое.
    await expect.element(page.getByRole('heading', { name: 'Дела' })).toBeVisible();
    await page.getByRole('button', { name: 'Убрать «Читать»' }).click();
    expect(latest!.habits).toEqual([]);
    await expect.element(page.getByRole('heading', { level: 3 })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Добавить 1 дело' })).toBeVisible();
    await page.getByRole('button', { name: 'Убрать «Хлеб»' }).click();
    await expect.element(page.getByText('Говори — я слушаю')).toBeVisible();
    expect(latest).toBeNull();
    expect(mic.made).toHaveLength(1);
  });

  it('свои дела рядом с групповыми подписаны «Себе»', async () => {
    await setup({ preview: { text: '', todos: [{ title: 'Хлеб' }], habits: [], groupItems: [gi({ title: 'Мусор' })] } }).r;
    await expect.element(page.getByRole('heading', { name: 'Себе' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Добавить 2 дела' })).toBeVisible();
  });

  it('только привычки — без подзаголовков', async () => {
    await setup({ preview: { text: '', todos: [], habits: [habit({}), habit({ title: 'Вода' })], groupItems: [] } }).r;
    await expect.element(page.getByRole('heading', { level: 3 })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Добавить 2 привычки' })).toBeVisible();
  });

  it('привычка открывается в редакторе, дело — в шторке поверх списка', async () => {
    const { r, onEdit } = setup({ preview: full });
    await r;
    await page.getByText('Спортзал', { exact: true }).click();
    expect(onEdit).toHaveBeenCalledWith(1);
    await page.getByText('Встреча', { exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Дело' });
    await expect.element(sheet).toBeVisible();
    await expect.element(page.getByPlaceholder('Где?')).toHaveValue('Кафе');
    await page.getByRole('textbox', { name: 'Дело' }).fill('Встреча с Аней');
    await sheet.getByRole('button', { name: 'Готово' }).click();
    await expect.element(sheet).not.toBeInTheDocument();
    expect(latest!.todos[1]).toEqual({ title: 'Встреча с Аней', day: '2026-10-04', time: '10:00', duration_min: 60, location: 'Кафе' });
    expect(latest!.todos[0]).toEqual(full.todos[0]);
    // Дело без дня — на сегодня, без места — пустое поле.
    await page.getByText('Купить молоко', { exact: true }).click();
    await expect.element(page.getByRole('radio', { name: 'Сегодня' })).toHaveAttribute('aria-checked', 'true');
    await expect.element(page.getByPlaceholder('Где?')).toHaveValue('');
  });

  it('не помещается бесплатно — лишние привычки бледнее, считаются только помещающиеся', async () => {
    const preview = { text: '', todos: [], habits: [habit({}), habit({ title: 'Вода' })], groupItems: [] };
    const { r, onAdd } = setup({ preview, room: 1 });
    const { unmount } = await r;
    expect(page.getByText('Вода', { exact: true }).element().closest('li')!.className).toBe('wont-fit');
    await expect.element(page.getByText(/добавятся первые 1/)).toBeVisible();
    await page.getByRole('button', { name: 'Добавить 1 привычку' }).click();
    expect(onAdd).toHaveBeenCalledWith([], [keyed(preview.habits[0]!)], []);
    await unmount();
    await setup({ preview, room: 0 }).r;
    await expect.element(page.getByText(/все места заняты/)).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Добавить/ })).toBeDisabled();
  });

  it('редактирование дела сохраняет ключ, повторное нажатие отправляет его снова', async () => {
    const todo = { title: 'Молоко', key: 'same-row' };
    const { r, onAdd } = setup({ preview: { text: '', todos: [todo], habits: [], groupItems: [] } });
    await r;
    await page.getByText('Молоко', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Дело' }).fill('Молоко и хлеб');
    await page.getByRole('dialog', { name: 'Дело' }).getByRole('button', { name: 'Готово' }).click();
    expect(latest!.todos[0]!.key).toBe('same-row');
    onAdd.mockRejectedValue(new TypeError('Failed to fetch'));
    await page.getByRole('button', { name: 'Добавить 1 дело' }).click();
    await expect.element(page.getByRole('button', { name: 'Добавить 1 дело' })).toBeEnabled();
    await page.getByRole('button', { name: 'Добавить 1 дело' }).click();
    expect(onAdd.mock.calls[0]).toEqual(onAdd.mock.calls[1]);
    expect(onAdd.mock.calls[0]![0][0]).toMatchObject({ title: 'Молоко и хлеб', key: 'same-row' });
  });

  it('двойное нажатие добавляет один раз; во время добавления строки и новая запись недоступны', async () => {
    const { r, onAdd } = setup({ preview: { text: '', todos: [{ title: 'Молоко' }], habits: [], groupItems: [] } });
    await r;
    let done!: () => void;
    onAdd.mockReturnValueOnce(new Promise((res) => (done = res)));
    const btn = page.getByRole('button', { name: 'Добавить 1 дело' }).element() as HTMLButtonElement;
    btn.click();
    btn.click();
    expect(onAdd).toHaveBeenCalledOnce();
    await expect.element(page.getByRole('button', { name: 'Убрать «Молоко»' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Сказать ещё раз' })).toBeDisabled();
    done();
    await expect.element(page.getByRole('button', { name: 'Добавить 1 дело' })).toBeEnabled();
  });

  it('длинные названия: «Добавить всё» видно без прокрутки шторки', async () => {
    await setup({ preview: {
      text: '',
      todos: [{ title: 'Записаться к стоматологу на четверг после работы и не забыть взять полис' }],
      habits: [habit({ title: 'Читатьпоутрамхотябыдесятьстраницкаждыйдень', kind: 'check', target: 1, unit: null })],
      groupItems: [gi({ title: 'Вынестимусориразобратьбалконпередзимойвсемвместе' })],
    } }).r;
    const add = page.getByRole('button', { name: 'Добавить всё · 3' });
    await expect.element(add).toBeVisible();
    await expect.poll(() => add.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    await expect.poll(() => add.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it('по-английски — английские даты', async () => {
    await renderApp(
      <VoiceSheet preview={{ text: '', todos: [{ title: 'Call', day: '2026-10-06' }], habits: [], groupItems: [] }} setPreview={() => {}} room={null} today={TODAY} onEdit={() => {}} onAdd={async () => {}} onManual={() => {}} onClose={() => {}} />,
      'en',
    );
    await expect.element(page.getByText('Tue, October 6')).toBeVisible();
  });

  it('«Сказать ещё раз» под списком и тап мимо — закрыть', async () => {
    const { r, onClose } = setup({ preview: full });
    await r;
    backdrop().click();
    expect(onClose).toHaveBeenCalledOnce();
    await page.getByRole('button', { name: 'Сказать ещё раз' }).click();
    await expect.element(page.getByText('Говори — я слушаю')).toBeVisible();
    expect(latest).toBeNull();
  });
});
