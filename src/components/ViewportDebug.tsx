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
    bar ? `панель ${px(bar.top)}–${px(bar.bottom)}` : 'панели нет',
  ];
}

export function ViewportDebug({ onClose }: { onClose: () => void }): ReactNode {
  const [lines, setLines] = useState(measure);
  useEffect(() => {
    const id = window.setInterval(() => setLines(measure()), 400);
    return () => window.clearInterval(id);
  }, []);
  return (
    <button className="viewport-debug" onClick={onClose}>
      {lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </button>
  );
}
