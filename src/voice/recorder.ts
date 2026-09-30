// Запись голоса в мини-аппе: микрофон через getUserMedia, звук — MediaRecorder.
// Формат выбирает браузер (webm/Opus в Android и Chrome, mp4/AAC на iPhone) — сервер принимает любой.

/** В порядке предпочтения: Opus компактнее, mp4 — единственное, что пишет Safari. */
const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

/** Есть ли вообще чем записывать. Разрешения на микрофон это не проверяет. */
export function canRecord(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export interface Recording {
  audio: Blob;
  seconds: number;
}

export class Recorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private bins: Uint8Array<ArrayBuffer> | null = null;
  private startedAt = 0;
  /** Для волны на экране; может не быть — тогда волна просто дышит. */
  analyser: AnalyserNode | null = null;

  /** Бросает, если микрофона нет или доступ не дали (NotAllowedError). */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    this.rec = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    // Без timeslice: одним куском в конце. Склейка кусков mp4 из Safari бывает нечитаемой.
    this.rec.start();
    this.startedAt = performance.now();
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.ctx = new Ctx();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 64;
        this.analyser.smoothingTimeConstant = 0.6;
        this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
        this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      }
    } catch {
      this.analyser = null; // волна без звука — не повод не записывать
    }
  }

  /** Громкость по полосам частот, 0..1 — для волны. */
  levels(): Uint8Array<ArrayBuffer> | null {
    if (!this.analyser || !this.bins) return null;
    this.analyser.getByteFrequencyData(this.bins);
    return this.bins;
  }

  get seconds(): number {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  stop(): Promise<Recording> {
    const rec = this.rec;
    const seconds = this.seconds;
    if (!rec || rec.state === 'inactive') {
      this.release();
      return Promise.resolve({ audio: new Blob(), seconds: 0 });
    }
    return new Promise((resolve) => {
      rec.onstop = () => {
        const audio = new Blob(this.chunks, { type: rec.mimeType || this.chunks[0]?.type || 'audio/webm' });
        this.release();
        resolve({ audio, seconds });
      };
      rec.stop();
    });
  }

  /** Бросить запись: микрофон отпускаем, звук никуда не уходит. */
  cancel(): void {
    if (this.rec) {
      this.rec.onstop = null;
      this.rec.ondataavailable = null;
      if (this.rec.state !== 'inactive') this.rec.stop();
    }
    this.release();
  }

  private release(): void {
    // Пока дорожки не остановлены, телефон показывает, что микрофон занят.
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }
}
