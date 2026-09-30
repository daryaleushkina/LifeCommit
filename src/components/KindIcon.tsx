import type { ReactNode } from 'react';
import { habitIcon, type HabitIcon } from '../../shared/habitIcon';
import type { TaskKind } from '../../shared/types';

// Все рисунки — в одном стиле: заливка var(--k-mid), линии var(--k-ink) (цвета даёт плитка).
const INK = { stroke: 'var(--k-ink)', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const MID = 'var(--k-mid)';

/** Рисунки вида привычки: календарь с галочкой, столбики, перечёркнутый круг. */
const KIND: Record<TaskKind, ReactNode> = {
  check: (
    <>
      <rect x="8" y="10" width="32" height="30" rx="8" fill={MID} {...INK} />
      <path d="M8 20h32M17 6v8M31 6v8" {...INK} />
      <path d="M17 30l5 5 9-10" {...INK} strokeWidth={3} />
    </>
  ),
  count: (
    <>
      <rect x="8" y="26" width="8" height="14" rx="3" fill={MID} />
      <rect x="20" y="18" width="8" height="22" rx="3" fill={MID} />
      <rect x="32" y="9" width="8" height="31" rx="3" fill="var(--k-ink)" />
      <path d="M6 42h36" {...INK} />
    </>
  ),
  abstain: (
    <>
      <circle cx="24" cy="24" r="15" fill={MID} {...INK} />
      <path d="M13.5 34.5l21-21" {...INK} strokeWidth={3} />
    </>
  ),
};

/** Рисунки по названию привычки (см. shared/habitIcon.ts). */
const HABIT: Record<HabitIcon, ReactNode> = {
  gym: (
    <>
      <rect x="5" y="18" width="6" height="12" rx="2" fill={MID} {...INK} />
      <rect x="37" y="18" width="6" height="12" rx="2" fill={MID} {...INK} />
      <rect x="11" y="13" width="6" height="22" rx="2.5" fill={MID} {...INK} />
      <rect x="31" y="13" width="6" height="22" rx="2.5" fill={MID} {...INK} />
      <path d="M17 24h14" {...INK} strokeWidth={3.5} />
    </>
  ),
  run: (
    <>
      <path d="M6 33c0-3 1-7 3-10l7 4c3 2 7 3 11 4 7 1 13 2 15 6v2H6z" fill={MID} {...INK} />
      <path d="M17 23l-3 4M22 25l-3 4M6 33h36" {...INK} />
      <path d="M9 15h8M5 20h6" {...INK} />
    </>
  ),
  walk: (
    <>
      <path d="M13 22c0-5 2-9 5-9s5 4 5 9-2 8-5 8-5-3-5-8z" fill={MID} {...INK} />
      <path d="M26 30c0-5 2-9 5-9s5 4 5 9-2 8-5 8-5-3-5-8z" fill={MID} {...INK} />
      <path d="M15 34h6M28 42h6" {...INK} />
    </>
  ),
  yoga: (
    <>
      <circle cx="24" cy="11" r="4.5" fill={MID} {...INK} />
      <path d="M24 17v10M10 22c5 3 9 4 14 4s9-1 14-4" {...INK} />
      <path d="M8 38c5-7 10-10 16-10s11 3 16 10z" fill={MID} {...INK} />
    </>
  ),
  exercise: (
    <>
      <circle cx="24" cy="10" r="4.5" fill={MID} {...INK} />
      <path d="M24 16v14M24 21L12 12M24 21l12-9M24 30l-8 11M24 30l8 11" {...INK} strokeWidth={3} />
    </>
  ),
  swim: (
    <>
      <circle cx="33" cy="14" r="4.5" fill={MID} {...INK} />
      <path d="M10 24l10-7 8 6" {...INK} strokeWidth={3} />
      <path d="M5 31c4-3 7-3 10 0s7 3 10 0 7-3 10 0 5 2 8 0M5 39c4-3 7-3 10 0s7 3 10 0 7-3 10 0 5 2 8 0" {...INK} />
    </>
  ),
  bike: (
    <>
      <circle cx="12" cy="31" r="8" fill={MID} {...INK} />
      <circle cx="36" cy="31" r="8" fill={MID} {...INK} />
      <path d="M12 31l8-14h10l6 14M20 17l7 14M17 12h6M30 17l-2-5h5" {...INK} />
    </>
  ),
  water: (
    <>
      <path d="M24 5c8 10 12 16 12 23a12 12 0 0 1-24 0c0-7 4-13 12-23z" fill={MID} {...INK} />
      <path d="M18 29a6 6 0 0 0 5 6" {...INK} />
    </>
  ),
  read: (
    <>
      <path d="M24 13c-4-3-9-4-16-4v27c7 0 12 1 16 4 4-3 9-4 16-4V9c-7 0-12 1-16 4z" fill={MID} {...INK} />
      <path d="M24 13v27M13 17h5M13 23h5M30 17h5M30 23h5" {...INK} />
    </>
  ),
  study: (
    <>
      <path d="M4 19l20-9 20 9-20 9z" fill={MID} {...INK} />
      <path d="M12 23v9c5 5 19 5 24 0v-9M40 21v10" {...INK} />
    </>
  ),
  write: (
    <>
      <path d="M9 39l3-10L31 10l7 7-19 19z" fill={MID} {...INK} />
      <path d="M27 14l7 7M9 39l10-3M26 40h14" {...INK} />
    </>
  ),
  sleep: (
    <>
      <path d="M38 28A15 15 0 1 1 20 10a12 12 0 0 0 18 18z" fill={MID} {...INK} />
      <path d="M29 8h8l-8 9h8" {...INK} />
    </>
  ),
  meds: (
    <>
      <rect x="6" y="17" width="36" height="14" rx="7" transform="rotate(-35 24 24)" fill={MID} {...INK} />
      <path d="M18 16l12 16" {...INK} />
    </>
  ),
  food: (
    <>
      <path d="M24 15c-3-3-8-3-11 0-4 4-3 12 0 18 2 5 6 7 11 5 5 2 9 0 11-5 3-6 4-14 0-18-3-3-8-3-11 0z" fill={MID} {...INK} />
      <path d="M24 15c0-4 1-7 4-9M27 9c3-2 6-1 8 1-2 3-5 4-8 2" {...INK} />
    </>
  ),
  sweets: (
    <>
      <circle cx="24" cy="24" r="9" fill={MID} {...INK} />
      <path d="M15 24L6 17v14zM33 24l9-7v14z" fill={MID} {...INK} />
      <path d="M20 21c3-2 6-2 8 1" {...INK} />
    </>
  ),
  smoke: (
    <>
      <rect x="5" y="28" width="30" height="8" rx="2.5" fill={MID} {...INK} />
      <path d="M27 28v8M39 28v8M43 28v8" {...INK} />
      <path d="M38 22c0-4-5-4-5-8s4-4 4-7" {...INK} />
    </>
  ),
  alcohol: (
    <>
      <path d="M13 7h22c0 11-4 18-11 18S13 18 13 7z" fill={MID} {...INK} />
      <path d="M24 25v15M16 41h16M14 14h20" {...INK} />
    </>
  ),
  coffee: (
    <>
      <path d="M8 19h26v10a11 11 0 0 1-11 11h-4A11 11 0 0 1 8 29z" fill={MID} {...INK} />
      <path d="M34 22h3a5 5 0 0 1 0 10h-3M16 13c0-3 3-3 3-6M25 13c0-3 3-3 3-6" {...INK} />
    </>
  ),
  phone: (
    <>
      <rect x="13" y="5" width="22" height="38" rx="6" fill={MID} {...INK} />
      <path d="M21 11h6M21 37h6" {...INK} />
    </>
  ),
  clean: (
    <>
      <path d="M20 8l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill={MID} {...INK} />
      <path d="M35 25l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill={MID} {...INK} />
    </>
  ),
  money: (
    <>
      <circle cx="24" cy="24" r="16" fill={MID} {...INK} />
      <path d="M20 33V15h6a5 5 0 0 1 0 10h-9M17 30h10" {...INK} />
    </>
  ),
  work: (
    <>
      <rect x="9" y="10" width="30" height="21" rx="4" fill={MID} {...INK} />
      <path d="M4 38h40M16 18h10M16 24h16" {...INK} />
    </>
  ),
  music: (
    <>
      <circle cx="14" cy="34" r="6" fill={MID} {...INK} />
      <circle cx="34" cy="30" r="6" fill={MID} {...INK} />
      <path d="M20 34V11l20-4v23M20 18l20-4" {...INK} />
    </>
  ),
  art: (
    <>
      <path d="M24 7C13 7 6 14 6 24s7 17 16 17c4 0 5-3 3-6-2-4 1-6 5-6h5c5 0 7-4 7-8 0-8-8-14-18-14z" fill={MID} {...INK} />
      <circle cx="15" cy="22" r="2.2" fill="var(--k-ink)" />
      <circle cx="22" cy="15" r="2.2" fill="var(--k-ink)" />
      <circle cx="31" cy="17" r="2.2" fill="var(--k-ink)" />
    </>
  ),
  care: (
    <>
      <path d="M14 11c4-3 7 0 10 0s6-3 10 0c5 4 2 13 0 19-1 4-2 9-4 9s-2-9-6-9-4 9-6 9-3-5-4-9c-2-6-5-15 0-19z" fill={MID} {...INK} />
      <path d="M19 17c2-1 4-1 5 0" {...INK} />
    </>
  ),
  pet: (
    <>
      <path d="M24 24c-6 0-11 6-11 11 0 4 4 5 11 5s11-1 11-5c0-5-5-11-11-11z" fill={MID} {...INK} />
      <circle cx="11" cy="21" r="4" fill={MID} {...INK} />
      <circle cx="19" cy="12" r="4" fill={MID} {...INK} />
      <circle cx="29" cy="12" r="4" fill={MID} {...INK} />
      <circle cx="37" cy="21" r="4" fill={MID} {...INK} />
    </>
  ),
  people: <path d="M24 41S6 30 6 18a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 12-18 23-18 23z" fill={MID} {...INK} />,
};

const ICON = { sm: 22, md: 26, lg: 30 } as const;

interface Props {
  kind: TaskKind;
  /** Название привычки: если по нему узнаётся тема (спортзал, вода, чтение…), рисуем её значок. */
  title?: string;
  size?: keyof typeof ICON;
}

/** Цветная плитка с рисунком. Цвет — по виду привычки, рисунок — по названию, а если не узнали — по виду. */
export function KindTile({ kind, title, size = 'md' }: Props): ReactNode {
  const icon = title ? habitIcon(title) : null;
  return (
    <span className={`kind-tile ${size} k-${kind}`} aria-hidden>
      <svg width={ICON[size]} height={ICON[size]} viewBox="0 0 48 48" fill="none" aria-hidden>
        {icon ? HABIT[icon] : KIND[kind]}
      </svg>
    </span>
  );
}
