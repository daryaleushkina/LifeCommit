import type { ReactNode } from 'react';

/**
 * Логотип-заставка: сетка 3×3, клетки загораются зелёным по очереди,
 * как дни на карте. Пока грузится сессия — крутится по кругу.
 */
export function Logo({ animated = false, size = 72 }: { animated?: boolean; size?: number }): ReactNode {
  const levels = [1, 2, 4, 2, 3, 1, 4, 3, 2];
  return (
    <div className={`logo${animated ? ' animated' : ''}`} style={{ width: size, height: size }} aria-hidden>
      {levels.map((l, i) => (
        <i key={i} className={`cell l${l}`} style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}

export function Splash(): ReactNode {
  return (
    <main className="app-shell center splash">
      <Logo animated size={84} />
      <div className="wordmark">LifeCommit</div>
    </main>
  );
}
