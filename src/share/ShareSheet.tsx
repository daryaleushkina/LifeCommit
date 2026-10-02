// Окно «Поделиться» (дизайн 20J): шаблоны листаются крупно, под ними — «В сторис Telegram», «Отправить в чат»,
// «Сохранить». Переключателей нет: QR и название — на картинке всегда (решение владелицы 02.10.2026).
//
// Скорость (02.10.2026): картинка, на которой остановилась лента, готовится заранее — рисуется в полном размере,
// сжимается в JPEG и уходит в Telegram, пока человек смотрит. К нажатию кнопки ссылка обычно уже есть.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { downloadFile, initData, openLink, requestWriteAccess, shareMessage, shareStory, swipeBehavior } from '@tma.js/sdk-react';
import { api, ApiError } from '../api';
import { Sheet } from '../components/Picker';
import { useT } from '../i18n';
import { draw, fontsReady, H, PREVIEW_SCALE, render, W, type Template } from './draw';

const BOT_URL = 'https://t.me/LifeCommit_bot';
/** Лента остановилась на картинке — через столько начинаем её готовить. */
const PREPARE_AFTER_MS = 350;

interface Uploaded {
  url: string;
  file_id: string;
}

interface Props {
  templates: Template[];
  onClose: () => void;
}

export function ShareSheet({ templates, onClose }: Props): ReactNode {
  const t = useT();
  const s = t.share;
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Загрузка по номеру шаблона: начатая заранее, нажатие её просто дожидается; второй раз не грузим.
  const uploads = useRef(new Map<number, Promise<Uploaded>>());

  useEffect(() => {
    let alive = true;
    void fontsReady().then(() => {
      if (!alive) return;
      templates.forEach((tpl, i) => {
        const c = canvases.current[i];
        if (c) draw(c, tpl, { bot: s.bot }, PREVIEW_SCALE);
      });
      setDrawn(true);
    });
    return () => {
      alive = false;
    };
  }, [templates]);

  /** Картинка шаблона в Telegram (через бота). Не вышло — забываем, чтобы следующая попытка пошла заново. */
  const prepare = (i: number): Promise<Uploaded> => {
    const ready = uploads.current.get(i);
    if (ready) return ready;
    const job = render(templates[i]!, { bot: s.bot }).then((blob) => api.share(blob));
    uploads.current.set(i, job);
    job.catch(() => uploads.current.delete(i));
    return job;
  };

  // Готовим ту картинку, на которой лента остановилась (и первую — сразу, как нарисовались).
  useEffect(() => {
    if (!drawn) return;
    const id = window.setTimeout(() => void prepare(index).catch(() => {}), PREPARE_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [drawn, index]);

  const step = () => {
    const card = strip.current?.firstElementChild as HTMLElement | null;
    return (card?.offsetWidth ?? 1) + 12;
  };

  // Какой шаблон сейчас в центре ленты: у ленты поля по половине свободного места, поэтому центр i-й — ровно i шагов.
  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    setIndex(Math.max(0, Math.min(templates.length - 1, Math.round(el.scrollLeft / step()))));
  };

  /** Тап по соседней картинке — выбрать её: лента подъезжает, рамка переходит сразу. */
  const pick = (i: number) => {
    if (i === index) return;
    setIndex(i);
    strip.current?.scrollTo({ left: i * step(), behavior: 'smooth' });
  };

  /** Сама картинка; если бот не может писать — просим разрешение (только по нажатию) и пробуем снова. */
  const upload = async (): Promise<Uploaded> => {
    try {
      return await prepare(index);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403) || !requestWriteAccess.isAvailable()) throw e;
      if ((await requestWriteAccess()) !== 'allowed') throw e;
      await api.writeAccess().catch(() => {});
      return prepare(index);
    }
  };

  const run = async (what: 'story' | 'chat' | 'save') => {
    setBusy(true);
    setNote(null);
    try {
      const img = await upload();
      if (what === 'story') {
        // Ссылка-виджет в сторис есть только у Telegram Premium; у остальных бота ведёт QR на картинке.
        const premium = initData.user()?.is_premium === true;
        shareStory(img.url, premium ? { widgetLink: { url: BOT_URL, name: 'LifeCommit' } } : undefined);
      } else if (what === 'chat') {
        const res = await api.shareChat(img.file_id, s.caption);
        if (res.prepared_id && shareMessage.isAvailable()) await shareMessage(res.prepared_id);
        else setNote(s.sentToBot);
      } else if (downloadFile.isAvailable()) {
        await downloadFile(img.url, 'lifecommit.jpg');
      } else {
        openLink.ifAvailable(img.url);
      }
    } catch (e) {
      console.warn('share failed', e);
      setNote(e instanceof ApiError && e.status === 403 ? s.needWrite : s.error);
    } finally {
      setBusy(false);
    }
  };

  // Пока палец на ленте, Telegram не сворачивает мини-апп жестом вниз: косой свайп по картинкам не должен его тянуть.
  // Касания, а не pointer-события: когда лента начинает прокручиваться сама, браузер шлёт pointercancel посреди жеста.
  const hold = (on: boolean) => (on ? swipeBehavior.disableVertical.ifAvailable() : swipeBehavior.enableVertical.ifAvailable());
  useEffect(() => () => void hold(false), []);

  return (
    <Sheet title={s.title} onClose={onClose}>
      <div
        className="share-strip"
        ref={strip}
        onScroll={onScroll}
        onTouchStart={() => hold(true)}
        onTouchEnd={() => hold(false)}
        onTouchCancel={() => hold(false)}
      >
        {templates.map((tpl, i) => (
          <canvas
            key={`${tpl.kind}-${i}`}
            ref={(el) => {
              canvases.current[i] = el;
            }}
            className={`share-card${i === index ? ' on' : ''}`}
            width={W}
            height={H}
            role="img"
            aria-label={s.preview}
            onClick={() => pick(i)}
          />
        ))}
      </div>
      {templates.length > 1 && (
        <div className="share-dots" aria-hidden>
          {templates.map((_, i) => (
            <i key={i} className={i === index ? 'on' : undefined} />
          ))}
        </div>
      )}
      {note && <p className="sheet-note">{note}</p>}
      {shareStory.isAvailable() && (
        <button className="act primary wide" disabled={busy} onClick={() => void run('story')}>
          {busy ? s.busy : s.story}
        </button>
      )}
      <div className="share-more">
        <button className="act soft" disabled={busy} onClick={() => void run('chat')}>
          {s.chat}
        </button>
        <button className="act soft" disabled={busy} onClick={() => void run('save')}>
          {s.save}
        </button>
      </div>
    </Sheet>
  );
}
