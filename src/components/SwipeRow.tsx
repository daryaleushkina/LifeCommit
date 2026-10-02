// Строка списка, которую можно смахнуть влево (круг 21, как в «Почте» iPhone): короткий свайп открывает кнопки,
// протянул до конца — срабатывает крайняя (обычно «Удалить»). Вертикальная прокрутка работает как обычно:
// строка ловит только явно горизонтальное движение. Открытой бывает одна строка: открыли другую — эта закрывается.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hapticFeedback, swipeBehavior } from '@tma.js/sdk-react';

export interface SwipeAction {
  label: string;
  tone: 'danger' | 'muted';
  icon: 'trash' | 'hide';
  run: () => void;
}

/** Ширина одной кнопки под строкой. */
const BUTTON = 84;
/** Дальше этой доли ширины — «до конца»: срабатывает крайнее действие. */
const FULL = 0.55;

let closeOpen: (() => void) | null = null;

/**
 * Свайп строки спорит с жестом Telegram «потянуть вниз — свернуть»: палец чуть уходит вниз, и весь мини-апп
 * съезжает (02.10.2026). Пока палец на смахиваемой строке — вертикальный жест Telegram выключаем, отпустили — включаем.
 * Свернуть за шапку можно всегда (документация Telegram).
 */
const holdTelegramSwipe = (hold: boolean) => {
  if (hold) swipeBehavior.disableVertical.ifAvailable();
  else swipeBehavior.enableVertical.ifAvailable();
};

const ICONS = {
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
  hide: (
    <>
      <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.3 8.2 3 12 3 12s4 6 9 6a9 9 0 0 0 4.2-1" />
      <path d="M9.9 10a3 3 0 0 0 4.1 4.1" />
    </>
  ),
};

interface Props {
  /** Кнопки слева направо; последняя — крайняя, она же срабатывает свайпом до конца. Пусто — строка не смахивается. */
  actions: SwipeAction[];
  className?: string;
  /** card — отдельная карточка (привычка на «Сегодня»): обёртка — div, кнопка во всю высоту карточки с её скруглением. */
  variant?: 'row' | 'card';
  children: ReactNode;
}

export function SwipeRow({ actions, className, variant = 'row', children }: Props): ReactNode {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const g = useRef<{ x0: number; y0: number; base: number; dir: 'h' | 'v' | null; id: number; full: boolean } | null>(null);
  // Только что смахивали — следующий клик по строке не открывает её.
  const moved = useRef(false);
  const open = actions.length * BUTTON;

  const close = () => setX(0);
  useEffect(() => () => {
    if (closeOpen === close) closeOpen = null;
  }, []);

  const Tag = variant === 'card' ? 'div' : 'li';
  if (!actions.length) return variant === 'card' ? <>{children}</> : <li className={className}>{children}</li>;

  const width = () => ref.current?.offsetWidth ?? 360;

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    g.current = { x0: e.clientX, y0: e.clientY, base: x, dir: null, id: e.pointerId, full: false };
    moved.current = false;
    holdTelegramSwipe(true);
  };
  const onMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.dir) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        s.dir = 'h';
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        if (closeOpen && closeOpen !== close) closeOpen();
        closeOpen = close;
        setDragging(true);
      } else if (Math.abs(dy) > 8) {
        s.dir = 'v';
      }
      return;
    }
    if (s.dir !== 'h') return;
    moved.current = true;
    const next = Math.min(0, Math.max(-width(), s.base + dx));
    const full = -next > width() * FULL;
    if (full !== s.full) {
      s.full = full;
      hapticFeedback.impactOccurred.ifAvailable('light');
    }
    setX(next);
  };
  const onUp = () => {
    const s = g.current;
    g.current = null;
    holdTelegramSwipe(false);
    setDragging(false);
    if (!s || s.dir !== 'h') return;
    if (s.full) {
      setX(-width());
      actions[actions.length - 1]!.run();
      return;
    }
    setX(-x > open / 2 ? -open : 0);
  };

  // Кнопки занимают ровно открытую часть строки; при длинном свайпе крайняя растягивается на всё.
  // Сама кнопка — скруглённая «таблетка» с отступом от строки (02.10.2026: острый прямоугольник выбивался из круглого
  // интерфейса и не доставал до края карточки).
  const shown = -x;
  const full = shown > width() * FULL;
  return (
    <Tag
      ref={ref as React.Ref<HTMLLIElement & HTMLDivElement>}
      className={`swipe${variant === 'card' ? ' swipe-card' : ''}${dragging ? ' dragging' : ''}${className ? ` ${className}` : ''}`}
    >
      {/* Кнопки лежат под строкой и открываются вместе с её сдвигом (обрезкой, а не шириной — без перерасчёта раскладки). */}
      <div className="swipe-actions" style={{ clipPath: `inset(0 0 0 calc(100% - ${shown}px))` }} aria-hidden={shown === 0}>
        {actions.map((a, i) => {
          const last = i === actions.length - 1;
          const w = full ? (last ? shown : 0) : shown / actions.length;
          if (w < 1) return null;
          return (
            <button
              key={a.label}
              className={`swipe-btn ${a.tone}`}
              style={{ width: w }}
              tabIndex={shown ? 0 : -1}
              onClick={() => {
                setX(0);
                a.run();
              }}
            >
              <span className="swipe-pill">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {ICONS[a.icon]}
                </svg>
                {w > 70 && <span>{a.label}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div
        className="swipe-body"
        style={{ transform: x ? `translateX(${x}px)` : undefined }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClickCapture={(e) => {
          // Смахивали или строка открыта — нажатие просто закрывает, а не открывает дело.
          // Клик сразу после перетаскивания — часть жеста: проглатываем, строка остаётся как легла.
          if (moved.current) {
            e.stopPropagation();
            e.preventDefault();
            moved.current = false;
            return;
          }
          if (x) {
            e.stopPropagation();
            e.preventDefault();
            close();
          }
        }}
      >
        {children}
      </div>
    </Tag>
  );
}
