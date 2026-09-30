import type { ReactNode } from 'react';
import { KIND_EMOJI, type TaskKind } from '../../shared/types';
import { useT } from '../i18n';

/** Три намерения = три типа цели; тап открывает редактор с уже выбранным типом. */
const INTENTS: TaskKind[] = ['check', 'count', 'abstain'];

export function Onboarding({ onPick }: { onPick: (kind: TaskKind) => void }): ReactNode {
  const t = useT();
  return (
    <main className="app-shell">
      <header className="page-head">
        <h1>{t.onboardingTitle}</h1>
      </header>
      <div className="intents">
        {INTENTS.map((kind) => (
          <button key={kind} className="intent" onClick={() => onPick(kind)}>
            <span className="emoji" aria-hidden>
              {KIND_EMOJI[kind]}
            </span>
            <span className="text">
              <b>{t.intents[kind].title}</b>
              <span>{t.intents[kind].examples}</span>
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
