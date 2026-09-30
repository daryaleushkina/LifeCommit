import { describe, expect, it } from 'vitest';
import { monthOf, shiftMonth } from './Heatmap';

describe('месяцы календаря', () => {
  it('monthOf берёт год и месяц из дня', () => {
    expect(monthOf('2026-09-30')).toBe('2026-09');
  });
  it('shiftMonth листает через границу года', () => {
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-09', -11)).toBe('2025-10');
  });
});
