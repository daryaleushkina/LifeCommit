import { useEffect, useState, type ReactNode } from 'react';
import { hapticFeedback } from '@tma.js/sdk-react';
import type { TaskTemplate } from '../../shared/types';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { useT } from '../i18n';
import { useMainButton, type SubmitState } from '../telegram/hooks';

const MAX_PICK = 3;

export function Onboarding({ onDone }: { onDone: () => void }): ReactNode {
  const t = useT();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [state, setState] = useState<SubmitState>('blocked');
  const [error, setError] = useState(false);

  useEffect(() => {
    api.templates().then(setTemplates, () => setError(true));
  }, []);

  useEffect(() => {
    setState((s) => (s === 'submitting' ? s : picked.length ? 'idle' : 'blocked'));
  }, [picked.length]);

  const toggle = (slug: string) =>
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : p.length < MAX_PICK ? [...p, slug] : p));

  useMainButton(t.start(picked.length), state, async () => {
    setState('submitting');
    try {
      await api.fromTemplates(picked);
      hapticFeedback.notificationOccurred.ifAvailable('success');
      onDone();
    } catch {
      setError(true);
      setState('idle');
    }
  });

  return (
    <main className="app-shell">
      <header className="page-head">
        <Logo size={40} />
        <h1>{t.onboardingTitle}</h1>
        <p className="muted">{t.onboardingHint}</p>
      </header>
      {error && <p className="error">{t.error}</p>}
      <div className="tiles">
        {templates.map((tpl) => {
          const on = picked.includes(tpl.slug);
          const full = !on && picked.length >= MAX_PICK;
          return (
            <button
              key={tpl.slug}
              className={`tile${on ? ' on' : ''}`}
              disabled={full}
              aria-pressed={on}
              onClick={() => toggle(tpl.slug)}
            >
              <span className="tile-emoji">{tpl.emoji}</span>
              <span className="tile-title">{tpl.title}</span>
              {tpl.kind === 'count' && (
                <span className="tile-sub">
                  {tpl.target} {tpl.unit}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </main>
  );
}
