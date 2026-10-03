// Знак и заставка.
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../test/render';
import { Logo, Splash } from './Logo';

describe('знак', () => {
  it('сетка 3×3: тёмные клетки складываются в галочку', async () => {
    const { container } = await renderApp(<Logo />);
    const cells = [...container.querySelectorAll('.logo i')].map((i) => i.className);
    expect(cells).toEqual(['', 'l1', 'l4', 'l1', 'l4', 'l2', 'l4', 'l2', '']);
    expect(container.querySelector('.logo')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('заставка — знак и название, экран помечен как загружающийся', async () => {
    const { container } = await renderApp(<Splash />);
    await expect.element(page.getByText('LifeCommit')).toBeVisible();
    expect(container.querySelector('main')!.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('.splash .logo i')).toHaveLength(9);
  });
});
