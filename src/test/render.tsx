// Отрисовать компонент так, как в приложении: с языком (по умолчанию русский).
import type { ReactNode } from 'react';
import { render } from 'vitest-browser-react';
import { LangContext, type Lang } from '../i18n';

export function renderApp(ui: ReactNode, lang: Lang = 'ru') {
  return render(<LangContext.Provider value={lang}>{ui}</LangContext.Provider>);
}
