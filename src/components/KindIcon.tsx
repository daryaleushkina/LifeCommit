import type { ReactNode } from 'react';
import type { TaskKind } from '../../shared/types';

/** Рисунок вида привычки: календарь с галочкой, столбики, перечёркнутый круг. Цвета — из переменных плитки. */
function KindIcon({ kind, size }: { kind: TaskKind; size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      {kind === 'check' && (
        <>
          <rect x="8" y="10" width="32" height="30" rx="8" fill="var(--k-mid)" />
          <path d="M8 20h32" stroke="var(--k-ink)" strokeWidth="2.5" />
          <path d="M17 6v8M31 6v8" stroke="var(--k-ink)" strokeWidth="2.5" strokeLinecap="round" />
          <rect x="8" y="10" width="32" height="30" rx="8" stroke="var(--k-ink)" strokeWidth="2.5" />
          <path d="M17 30l5 5 9-10" stroke="var(--k-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === 'count' && (
        <>
          <rect x="8" y="26" width="8" height="14" rx="3" fill="var(--k-mid)" />
          <rect x="20" y="18" width="8" height="22" rx="3" fill="var(--k-mid)" />
          <rect x="32" y="9" width="8" height="31" rx="3" fill="var(--k-ink)" />
          <path d="M6 42h36" stroke="var(--k-ink)" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
      {kind === 'abstain' && (
        <>
          <circle cx="24" cy="24" r="15" fill="var(--k-mid)" />
          <circle cx="24" cy="24" r="15" stroke="var(--k-ink)" strokeWidth="2.5" />
          <path d="M13.5 34.5l21-21" stroke="var(--k-ink)" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

const ICON = { sm: 22, md: 26, lg: 30 } as const;

/** Цветная плитка с рисунком: по ней вид привычки узнаётся и при создании, и в списке. */
export function KindTile({ kind, size = 'md' }: { kind: TaskKind; size?: keyof typeof ICON }): ReactNode {
  return (
    <span className={`kind-tile ${size} k-${kind}`} aria-hidden>
      <KindIcon kind={kind} size={ICON[size]} />
    </span>
  );
}
