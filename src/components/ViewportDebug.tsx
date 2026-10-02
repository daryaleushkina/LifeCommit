// Временная панель замеров высоты (03.10.2026): календарь на iPhone не листался, в браузере это не повторить.
// Пять тапов по заголовку экрана — показать или убрать. Снимок экрана с ней сразу говорит, где расхождение.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { retrieveLaunchParams } from '@tma.js/sdk-react';

/** Пять тапов подряд (меньше чем за 2 секунды) переключают панель; третье — закрыть её сразу. */
export function useDebugTaps(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      setOpen((v) => !v);
    }
  };
  return [open, tap, () => setOpen(false)];
}

const px = (n: number) => `${Math.round(n)}`;

function measure(): string[] {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(name).trim() || '—';
  const main = document.querySelector<HTMLElement>('main.app-shell');
  const bar = document.querySelector('.tabbar')?.getBoundingClientRect();
  const mr = main?.getBoundingClientRect();
  let lp = '';
  try {
    const p = retrieveLaunchParams();
    lp = `${p.tgWebAppPlatform} ${p.tgWebAppVersion}`;
  } catch {
    lp = '?';
  }
  return [
    `платформа ${lp}`,
    `окно innerH ${px(innerHeight)} · visual ${px(visualViewport?.height ?? 0)} · doc ${px(document.documentElement.clientHeight)} · screen ${px(screen.height)}`,
    `tg height ${v('--tg-viewport-height')} · stable ${v('--tg-viewport-stable-height')}`,
    `safe ${v('--tg-viewport-safe-area-inset-top')}/${v('--tg-viewport-safe-area-inset-bottom')} · content ${v('--tg-viewport-content-safe-area-inset-top')}/${v('--tg-viewport-content-safe-area-inset-bottom')}`,
    main && mr ? `main h ${px(main.clientHeight)} · scrollH ${px(main.scrollHeight)} · top ${px(main.scrollTop)} · rect ${px(mr.top)}–${px(mr.bottom)}` : 'main —',
    main ? `листать есть куда: ${main.scrollHeight > main.clientHeight + 1 ? `да, ${px(main.scrollHeight - main.clientHeight)}` : 'нет'}` : '',
    bar ? `панель ${px(bar.top)}–${px(bar.bottom)}` : 'панели нет',
  ];
}

/** Последнее касание: где начали, сколько движений дошло, сколько из них кто-то отменил, сдвинулась ли прокрутка. */
interface TouchLog {
  target: string;
  moves: number;
  prevented: number;
  scrolls: number;
  cancels: number;
  from: number;
  to: number;
}

const short = (el: EventTarget | null): string => {
  const parts: string[] = [];
  for (let n = el as Element | null; n && parts.length < 3 && n !== document.body; n = n.parentElement) {
    parts.push(`${n.tagName.toLowerCase()}${n.classList.length ? `.${[...n.classList].slice(0, 2).join('.')}` : ''}`);
  }
  return parts.join(' < ');
};

export function ViewportDebug({ onClose }: { onClose: () => void }): ReactNode {
  const [lines, setLines] = useState(measure);
  const [touch, setTouch] = useState<TouchLog | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setLines(measure()), 400);
    return () => window.clearInterval(id);
  }, []);
  // Слушаем касания на window в последней фазе: видно, отменил ли движение кто-то из обработчиков страницы.
  useEffect(() => {
    const main = () => document.querySelector<HTMLElement>('main.app-shell');
    let cur: TouchLog | null = null;
    const start = (e: TouchEvent) => {
      cur = { target: short(e.target), moves: 0, prevented: 0, scrolls: 0, cancels: 0, from: main()?.scrollTop ?? 0, to: main()?.scrollTop ?? 0 };
      setTouch({ ...cur });
    };
    const move = (e: TouchEvent) => {
      if (!cur) return;
      cur.moves++;
      if (e.defaultPrevented) cur.prevented++;
    };
    const end = () => {
      if (!cur) return;
      cur.to = main()?.scrollTop ?? 0;
      setTouch({ ...cur });
    };
    const cancel = () => {
      if (cur) cur.cancels++;
    };
    const scroll = () => {
      if (!cur) return;
      cur.scrolls++;
      cur.to = main()?.scrollTop ?? 0;
      setTouch({ ...cur });
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end, { passive: true });
    window.addEventListener('touchcancel', end, { passive: true });
    window.addEventListener('pointercancel', cancel, { passive: true });
    const m = main();
    m?.addEventListener('scroll', scroll, { passive: true });
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      window.removeEventListener('pointercancel', cancel);
      m?.removeEventListener('scroll', scroll);
    };
  }, []);
  const touchLines = touch
    ? [`касание: ${touch.target}`, `движений ${touch.moves} · отменено ${touch.prevented} · pointercancel ${touch.cancels} · scroll ${touch.scrolls} · прокрутка ${Math.round(touch.from)}→${Math.round(touch.to)}`]
    : ['касание: — (проведи пальцем по списку)'];
  return (
    <button className="viewport-debug" onClick={onClose}>
      {[...lines, ...touchLines].map((l) => (
        <span key={l}>{l}</span>
      ))}
    </button>
  );
}
