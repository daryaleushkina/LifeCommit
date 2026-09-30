import type { CSSProperties, ReactNode } from 'react';

const HEAT = ['var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'];

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

/** Заставка: светлый терминал, `git commit -m "новый день"`, строка карты заполняется. */
export function Splash({ lang }: { lang: 'ru' | 'en' }): ReactNode {
  const row = [1, 2, 0, 3, 2, 4, 1, 3, 4, 2, 3, 4, 3, 4];
  return (
    <main className="app-shell center splash" aria-busy="true">
      <div className="brand">
        <Logo />
        <span>
          Life<b>Commit</b>
        </span>
      </div>
      <div className="term" aria-hidden>
        <div className="term-bar">~/life · main</div>
        <div className="term-cmd">$ git commit -m "{lang === 'ru' ? 'новый день' : 'new day'}"</div>
        <div className="term-out">[main 4c1e2a7] {lang === 'ru' ? 'новый день' : 'new day'}</div>
        <div className="term-row">
          {row.map((l, i) => (
            <i
              key={i}
              className={i === row.length - 1 ? 'today' : undefined}
              style={{ '--c': l ? HEAT[l - 1] : 'var(--heat-0)', animationDelay: `${0.95 + i * 0.04}s` } as CSSProperties}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
