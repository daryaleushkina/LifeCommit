// «Чего я хочу?»: три намерения, «Пропустить» на первом запуске и «назад» при добавлении.
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../test/render';
import { Onboarding } from './Onboarding';

const back = vi.hoisted(() => ({ current: undefined as (() => void) | null | undefined }));
vi.mock('../telegram/hooks', () => ({
  useBackButton: (fn: (() => void) | null) => {
    back.current = fn;
  },
  useMainButton: () => {},
}));

describe('Онбординг', () => {
  it('тап по намерению открывает редактор нужного вида', async () => {
    const onPick = vi.fn();
    await renderApp(<Onboarding onPick={onPick} />);
    await expect.element(page.getByRole('heading', { name: 'Чего я хочу?' })).toBeVisible();
    await page.getByRole('button', { name: /Делать регулярно/ }).click();
    await page.getByRole('button', { name: /Считать что-то/ }).click();
    await page.getByRole('button', { name: /Бросить/ }).click();
    expect(onPick.mock.calls).toEqual([['check'], ['count'], ['abstain']]);
  });

  it('на первом экране «назад» нет, а «Пропустить» есть', async () => {
    const onSkip = vi.fn();
    await renderApp(<Onboarding onPick={() => {}} onSkip={onSkip} />);
    expect(back.current).toBeNull();
    await page.getByRole('button', { name: 'Пропустить' }).click();
    expect(onSkip).toHaveBeenCalled();
  });

  it('при добавлении привычки «назад» ведёт обратно, «Пропустить» не показывается', async () => {
    const onBack = vi.fn();
    await renderApp(<Onboarding onPick={() => {}} onBack={onBack} />, 'en');
    await expect.element(page.getByRole('heading', { name: 'What do I want?' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Skip/ })).not.toBeInTheDocument();
    back.current?.();
    expect(onBack).toHaveBeenCalled();
  });
});
