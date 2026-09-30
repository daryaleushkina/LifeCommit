import type { ReactNode } from 'react';

/** Знак: сетка 3×3 клеток карты, самые тёмные складываются в галочку. */
export function Logo(): ReactNode {
  const levels = [0, 1, 4, 1, 4, 2, 4, 2, 0];
  return (
    <span className="logo" aria-hidden>
      {levels.map((l, i) => (
        <i key={i} className={l ? `l${l}` : undefined} />
      ))}
    </span>
  );
}

/** Заставка: крупный знак, клетки загораются по очереди, под ним название. */
export function Splash(): ReactNode {
  return (
    <main className="app-shell center splash" aria-busy="true">
      <Logo />
      <span className="brand">
        Life<b>Commit</b>
      </span>
    </main>
  );
}
