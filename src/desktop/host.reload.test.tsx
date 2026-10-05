// Перезагрузка страницы на компьютере (⌘R, F5, повтор после падения, выход по 401): @tma.js после «reload» поднимает
// состояние кнопок из sessionStorage и не шлёт событие, если новое состояние совпало со старым, — а мост стартует с нуля.
// Без сброса «Назад» и «Сохранить» не появлялись (в разработке это прятал двойной запуск эффектов StrictMode,
// в боевой сборке его нет — нашло ревью интерфейса 05.10.2026). Здесь — как в боевой сборке: без StrictMode.
import { backButton, init, mainButton } from '@tma.js/sdk-react';
import { describe, expect, it, vi } from 'vitest';

// Прошлая страница оставила «Назад» и «Сохранить» видимыми, и это перезагрузка.
sessionStorage.setItem('tapps/backButton', JSON.stringify({ isVisible: true }));
sessionStorage.setItem('tapps/mainButton', JSON.stringify({ isVisible: true, isEnabled: true, isLoaderVisible: false, text: 'Сохранить', hasShineEffect: false }));
const { installDesktopHost } = await import('./host');
document.documentElement.lang = 'ru';
// «Это перезагрузка» — только на время запуска: по этому признаку SDK поднимает сохранённое состояние.
const reload = vi.spyOn(performance, 'getEntriesByType').mockImplementation((type: string) =>
  type === 'navigation' ? ([{ type: 'reload', name: window.location.href }] as unknown as PerformanceEntryList) : [],
);
installDesktopHost();
init();
backButton.mount();
mainButton.mount();
reload.mockRestore();

describe('перезагрузка страницы', () => {
  it('экран с «Назад» и редактор после перезагрузки показывают свои кнопки', () => {
    backButton.show();
    expect(document.querySelector<HTMLElement>('.host-top')!.hidden).toBe(false);
    mainButton.setParams({ text: 'Сохранить', isVisible: true, isEnabled: true, isLoaderVisible: false });
    expect(document.querySelector<HTMLElement>('.host-bar')!.hidden).toBe(false);
  });
});
