// Запись голоса: микрофон, MediaRecorder и анализатор для волны подменены — проверяем, что и когда отпускаем.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canRecord, Recorder } from './recorder';

/** Подменный MediaRecorder: запоминает себя, stop() отдаёт накопленные куски и зовёт onstop. */
class FakeRecorder {
  static last: FakeRecorder | null = null;
  static supported: string[] | null = ['audio/mp4'];
  static isTypeSupported?: (t: string) => boolean = (t) => FakeRecorder.supported?.includes(t) ?? false;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  /** Что «запишется» к остановке. */
  pending: Blob[] = [new Blob(['звук'], { type: 'audio/mp4' })];
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    for (const data of this.pending) this.ondataavailable?.({ data });
    this.onstop?.();
  });
  constructor(
    readonly stream: MediaStream,
    readonly options?: { mimeType: string },
  ) {
    this.mimeType = options?.mimeType ?? '';
    FakeRecorder.last = this;
  }
}

const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] } as unknown as MediaStream;
const getUserMedia = vi.fn(async () => stream);

const analyser = {
  fftSize: 0,
  smoothingTimeConstant: 0,
  frequencyBinCount: 4,
  getByteFrequencyData: vi.fn((a: Uint8Array) => a.fill(200)),
};
const source = { connect: vi.fn() };
const close = vi.fn(async () => {});
class FakeAudioContext {
  static made = 0;
  constructor() {
    FakeAudioContext.made++;
  }
  createAnalyser = () => analyser;
  createMediaStreamSource = vi.fn(() => source);
  close = close;
}

const realMediaDevices = Object.getOwnPropertyDescriptor(Navigator.prototype, 'mediaDevices')!;
function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeRecorder.last = null;
  FakeRecorder.supported = ['audio/mp4'];
  FakeRecorder.isTypeSupported = (t) => FakeRecorder.supported?.includes(t) ?? false;
  FakeAudioContext.made = 0;
  analyser.fftSize = 0;
  analyser.smoothingTimeConstant = 0;
  close.mockImplementation(async () => {});
  setMediaDevices({ getUserMedia });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  Object.defineProperty(Navigator.prototype, 'mediaDevices', realMediaDevices);
  vi.restoreAllMocks();
});

describe('canRecord', () => {
  it('есть микрофон и MediaRecorder — можно', () => {
    expect(canRecord()).toBe(true);
  });
  it('нет MediaRecorder — нельзя', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(canRecord()).toBe(false);
  });
  it('нет mediaDevices (не https, старый WebView) — нельзя', () => {
    setMediaDevices(undefined);
    expect(canRecord()).toBe(false);
  });
});

describe('Recorder', () => {
  it('просит микрофон с шумоподавлением, берёт первый поддерживаемый формат, пишет одним куском', async () => {
    const r = new Recorder();
    await r.start();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true } });
    const rec = FakeRecorder.last!;
    expect(rec.stream).toBe(stream);
    expect(rec.options).toEqual({ mimeType: 'audio/mp4' });
    expect(rec.start).toHaveBeenCalledWith(); // без timeslice
  });

  it('Opus в приоритете', async () => {
    FakeRecorder.supported = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4'];
    await new Recorder().start();
    expect(FakeRecorder.last!.options).toEqual({ mimeType: 'audio/webm;codecs=opus' });
  });

  it('ни один формат не подошёл или isTypeSupported нет — браузер выбирает сам', async () => {
    FakeRecorder.supported = [];
    await new Recorder().start();
    expect(FakeRecorder.last!.options).toBeUndefined();
    FakeRecorder.isTypeSupported = undefined;
    await new Recorder().start();
    expect(FakeRecorder.last!.options).toBeUndefined();
  });

  it('доступ к микрофону не дали — start бросает', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expect(new Recorder().start()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('анализатор для волны: 64 полосы, сглаживание, уровни из getByteFrequencyData', async () => {
    const r = new Recorder();
    expect(r.levels()).toBeNull();
    await r.start();
    expect(r.analyser).toBe(analyser);
    expect(analyser.fftSize).toBe(64);
    expect(analyser.smoothingTimeConstant).toBe(0.6);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    const levels = r.levels()!;
    expect(levels).toBeInstanceOf(Uint8Array);
    expect([...levels]).toEqual([200, 200, 200, 200]);
  });

  it('старый Safari: webkitAudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    const r = new Recorder();
    await r.start();
    expect(FakeAudioContext.made).toBe(1);
    expect(r.analyser).toBe(analyser);
  });

  it('AudioContext нет совсем — пишем без волны', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const r = new Recorder();
    await r.start();
    expect(r.analyser).toBeNull();
    expect(r.levels()).toBeNull();
    expect(FakeRecorder.last!.start).toHaveBeenCalled();
  });

  it('анализатор сломался — волны нет, запись идёт', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('нельзя');
        }
      },
    );
    const r = new Recorder();
    await r.start();
    expect(r.analyser).toBeNull();
    const { audio } = await r.stop();
    expect(audio.size).toBeGreaterThan(0);
  });

  it('секунды считаются от start', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const r = new Recorder();
    expect(r.seconds).toBe(0);
    await r.start();
    now.mockReturnValue(3500);
    expect(r.seconds).toBe(2.5);
  });

  it('stop: звук одним Blob с типом записи, пустые куски выкинуты, микрофон и контекст отпущены', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const r = new Recorder();
    await r.start();
    const rec = FakeRecorder.last!;
    rec.pending = [new Blob([], { type: 'audio/mp4' }), new Blob(['раз'], { type: 'audio/mp4' }), new Blob(['два'], { type: 'audio/mp4' })];
    now.mockReturnValue(4000);
    const res = await r.stop();
    expect(res.seconds).toBe(3);
    expect(res.audio.type).toBe('audio/mp4');
    expect(await res.audio.text()).toBe('раздва');
    expect(track.stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(r.analyser).toBeNull();
    expect(r.levels()).toBeNull();
  });

  it('тип: у записи нет — берём у куска, у куска нет — audio/webm', async () => {
    FakeRecorder.supported = [];
    const r1 = new Recorder();
    await r1.start();
    FakeRecorder.last!.pending = [new Blob(['x'], { type: 'audio/ogg' })];
    expect((await r1.stop()).audio.type).toBe('audio/ogg');

    const r2 = new Recorder();
    await r2.start();
    FakeRecorder.last!.pending = [new Blob(['x'])];
    expect((await r2.stop()).audio.type).toBe('audio/webm');

    const r3 = new Recorder();
    await r3.start();
    FakeRecorder.last!.pending = [];
    expect((await r3.stop()).audio.type).toBe('audio/webm');
  });

  it('stop без записи или уже остановленной — пустой звук и ноль секунд', async () => {
    expect(await new Recorder().stop()).toMatchObject({ seconds: 0, audio: { size: 0 } });
    const r = new Recorder();
    await r.start();
    FakeRecorder.last!.state = 'inactive';
    const res = await r.stop();
    expect(res).toMatchObject({ seconds: 0, audio: { size: 0 } });
    expect(FakeRecorder.last!.stop).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it('cancel: запись останавливаем, обработчики снимаем — звук никуда не уходит', async () => {
    const r = new Recorder();
    await r.start();
    const rec = FakeRecorder.last!;
    const chunk = vi.fn();
    rec.ondataavailable = chunk;
    r.cancel();
    expect(rec.stop).toHaveBeenCalled();
    expect(chunk).not.toHaveBeenCalled();
    expect(rec.onstop).toBeNull();
    expect(track.stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('cancel до start и по остановленной записи — без лишнего stop', async () => {
    expect(() => new Recorder().cancel()).not.toThrow();
    const r = new Recorder();
    await r.start();
    FakeRecorder.last!.state = 'inactive';
    r.cancel();
    expect(FakeRecorder.last!.stop).not.toHaveBeenCalled();
  });

  it('контекст не закрылся — ошибку глотаем', async () => {
    close.mockRejectedValueOnce(new Error('closed'));
    const r = new Recorder();
    await r.start();
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    r.cancel();
    expect(close).toHaveBeenCalled();
    // Один оборот очереди задач: необработанный отказ браузер сообщает именно тогда.
    await new Promise((res) => setTimeout(res, 0));
    window.removeEventListener('unhandledrejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
