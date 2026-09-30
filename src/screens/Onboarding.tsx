import type { ReactNode } from 'react';
import type { TaskKind } from '../../shared/types';
import { KindTile } from '../components/KindIcon';
import { useT } from '../i18n';
import { useBackButton } from '../telegram/hooks';

/** Три намерения = три вида привычки; тап открывает редактор уже нужного вида. */
const INTENTS: TaskKind[] = ['check', 'count', 'abstain'];

/**
 * «Чего я хочу?» — первый экран и он же первый шаг при добавлении привычки.
 * onBack есть только при добавлении: с первого экрана уходить некуда.
 */
export function Onboarding({ onPick, onBack }: { onPick: (kind: TaskKind) => void; onBack?: () => void }): ReactNode {
  const t = useT();
  useBackButton(onBack ?? null);
  return (
    <main className="app-shell">
      <header className="page-head">
        <h1>{t.onboardingTitle}</h1>
        <p>{t.onboardingHint}</p>
      </header>
      <div className="intents">
        {INTENTS.map((kind) => (
          <button key={kind} className="intent" onClick={() => onPick(kind)}>
            <KindTile kind={kind} size="lg" />
            <span className="text">
              <b>{t.intents[kind].title}</b>
              <span>{t.intents[kind].examples}</span>
            </span>
            <svg className="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9.5 6l6 6-6 6" />
            </svg>
          </button>
        ))}
      </div>
    </main>
  );
}
