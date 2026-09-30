import { useState, type ReactNode } from 'react';
import { hapticFeedback } from '@tma.js/sdk-react';
import type { TaskTemplate } from '../../shared/types';
import { api } from '../api';
import { useT } from '../i18n';
import { useMainButton, type SubmitState } from '../telegram/hooks';

const MAX_PICK = 3;
/** Восемь плиток покрывают все 4 типа дел. */
const SHOWN = ['pushups', 'tidy', 'no_smoke', 'social', 'words', 'water', 'walk', 'read'];

export function Onboarding({ templates: all, onDone, onCustom }: { templates: TaskTemplate[]; onDone: () => Promise<void>; onCustom: () => void }): ReactNode {
  const t = useT();
  const templates = SHOWN.map((slug) => all.find((x) => x.slug === slug)).filter((x): x is TaskTemplate => !!x);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const toggle = (slug: string) =>
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : p.length < MAX_PICK ? [...p, slug] : p));

  const state: SubmitState = busy ? 'submitting' : picked.length ? 'idle' : 'blocked';
  useMainButton(t.start, state, async () => {
    setBusy(true);
    try {
      await api.fromTemplates(picked);
      hapticFeedback.notificationOccurred.ifAvailable('success');
      await onDone();
    } catch {
      setError(true);
      setBusy(false);
    }
  });

  return (
    <main className="app-shell">
      <header className="page-head">
        <h1>{t.onboardingTitle}</h1>
      </header>
      {error && <p className="error">{t.error}</p>}
      <div className="tiles">
        {templates.map((tpl) => {
          const on = picked.includes(tpl.slug);
          return (
            <button
              key={tpl.slug}
              className={`tile${on ? ' on' : ''}`}
              aria-pressed={on}
              disabled={!on && picked.length >= MAX_PICK}
              onClick={() => toggle(tpl.slug)}
            >
              <span className="emoji" aria-hidden>
                {tpl.emoji}
              </span>
              {tpl.title}
            </button>
          );
        })}
        <button className="tile wide" onClick={onCustom}>
          + {t.custom}
        </button>
      </div>
    </main>
  );
}
