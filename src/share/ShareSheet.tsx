// Окно «Поделиться» (дизайн 20J): шаблоны листаются крупно, под ними — «В сторис Telegram», «Отправить в чат»,
// «Сохранить». Переключателей нет: QR и название — на картинке всегда (решение владелицы 02.10.2026).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { downloadFile, initData, openLink, requestWriteAccess, shareMessage, shareStory } from '@tma.js/sdk-react';
import { api, ApiError } from '../api';
import { Sheet } from '../components/Picker';
import { useT } from '../i18n';
import { draw, fontsReady, H, toBlob, W, type Template } from './draw';

const BOT_URL = 'https://t.me/LifeCommit_bot';

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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Загруженная картинка — по номеру шаблона: второй раз не грузим.
  const uploaded = useRef(new Map<number, { url: string; file_id: string }>());

  useEffect(() => {
    let alive = true;
    void fontsReady().then(() => {
      if (!alive) return;
      templates.forEach((tpl, i) => {
        const c = canvases.current[i];
        if (c) draw(c, tpl, { bot: s.bot });
      });
    });
    return () => {
      alive = false;
    };
  }, [templates]);

  // Какой шаблон сейчас в центре ленты.
  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const step = (card?.offsetWidth ?? 1) + 12;
    setIndex(Math.max(0, Math.min(templates.length - 1, Math.round(el.scrollLeft / step))));
  };

  /** Картинка выбранного шаблона в Telegram (через бота). Бот не может писать — просим разрешение и пробуем снова. */
  const upload = async () => {
    const done = uploaded.current.get(index);
    if (done) return done;
    const canvas = canvases.current[index];
    if (!canvas) throw new Error('no canvas');
    const blob = await toBlob(canvas);
    try {
      const res = await api.share(blob);
      uploaded.current.set(index, res);
      return res;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403) || !requestWriteAccess.isAvailable()) throw e;
      if ((await requestWriteAccess()) !== 'allowed') throw e;
      await api.writeAccess().catch(() => {});
      const res = await api.share(blob);
      uploaded.current.set(index, res);
      return res;
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

  return (
    <Sheet title={s.title} onClose={onClose}>
      <div className="share-strip" ref={strip} onScroll={onScroll}>
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
