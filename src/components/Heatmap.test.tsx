// Карта дней: месяц сеткой и год лентой; даты считаются без часовых поясов.
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import { addDays, MonthCalendar, monthCells, monthOf, shiftMonth, YEAR_WEEKS, YearMap, yearStart } from './Heatmap';

describe('даты', () => {
  it('addDays переходит через месяц, год и високосный февраль', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('monthOf и shiftMonth', () => {
    expect(monthOf('2026-09-30')).toBe('2026-09');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 14)).toBe('2028-01');
  });

  it('monthCells: пустые клетки до понедельника и все дни месяца', () => {
    // 1 октября 2026 — четверг: перед ним три пустые клетки.
    const oct = monthCells('2026-10');
    expect(oct.lead).toBe(3);
    expect(oct.days).toHaveLength(31);
    expect(oct.days[0]).toBe('2026-10-01');
    expect(monthCells('2028-02').days).toHaveLength(29);
    // 1 июня 2026 — понедельник.
    expect(monthCells('2026-06').lead).toBe(0);
  });

  it('yearStart — понедельник 52 недели назад', () => {
    const start = yearStart('2026-10-03');
    expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(addDays(start, (YEAR_WEEKS - 1) * 7 + 5)).toBe('2026-10-03');
  });
});

describe('месяц', () => {
  it('уровни дней, сегодня обведено, будущее пустое', async () => {
    const days = [
      { day: '2026-10-01', score: 0.5 },
      { day: '2026-10-02', score: 6 },
      { day: '2026-10-03', score: 2 },
    ];
    const { container } = await renderApp(<MonthCalendar days={days} today="2026-10-03" month="2026-10" />);
    const cells = [...container.querySelectorAll('.cal i')];
    expect(cells.filter((c) => c.classList.contains('blank'))).toHaveLength(3);
    const real = cells.filter((c) => !c.classList.contains('blank'));
    expect(real).toHaveLength(31);
    expect(real[0]!.className).toBe('l1');
    expect(real[1]!.className).toBe('l4');
    expect(real[2]!.className).toBe('l2 today');
    expect(real[3]!.className).toBe('future');
    expect(real[30]!.className).toBe('future');
  });

  it('прошлый месяц без отметок — все клетки нулевые', async () => {
    const { container } = await renderApp(<MonthCalendar days={[]} today="2026-10-03" month="2026-06" />);
    const cells = [...container.querySelectorAll('.cal i')];
    expect(cells).toHaveLength(30);
    expect(cells.every((c) => c.className === 'l0')).toBe(true);
  });
});

describe('год', () => {
  it('53 недели, подписи месяцев, лента открыта на текущей неделе', async () => {
    const monthName = vi.fn((m: string) => m);
    const { container } = await renderApp(<YearMap days={[{ day: '2026-10-02', score: 3 }]} today="2026-10-03" monthName={monthName} />);
    const weeks = [...container.querySelectorAll('.year-week')];
    expect(weeks).toHaveLength(YEAR_WEEKS);
    const labels = weeks.map((w) => w.querySelector('span')!.textContent);
    // У первой колонки подпись есть всегда; дальше — только у недель, где начался месяц.
    expect(labels[0]).toBe('2025-10');
    expect(labels.filter(Boolean)).toHaveLength(13);
    expect(labels.at(-1)).toBe('2026-10');
    const last = [...weeks.at(-1)!.querySelectorAll('i')].map((i) => i.className);
    // Неделя пн 28.09 — вс 04.10: пятница уровня 3, суббота — сегодня, воскресенье — будущее.
    expect(last.slice(4)).toEqual(['l3', 'l0 today', 'future']);
    const map = container.querySelector<HTMLElement>('.year-map')!;
    expect(map.scrollWidth).toBeGreaterThan(map.clientWidth);
    expect(map.scrollLeft + map.clientWidth).toBeGreaterThanOrEqual(map.scrollWidth - 1);
  });

  it('первая колонка без начала месяца тоже подписана', async () => {
    // 2026-10-14: первая неделя карты — пн 13.10.2025, в ней 1-го числа нет.
    const { container } = await renderApp(<YearMap days={[]} today="2026-10-14" monthName={(m) => m} />);
    expect(container.querySelector('.year-week span')!.textContent).toBe('2025-10');
  });
});
