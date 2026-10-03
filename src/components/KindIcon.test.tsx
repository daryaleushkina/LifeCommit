// Плитка вида привычки: цвет — по виду, рисунок — по названию (если узнали), размер — по месту.
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render';
import { KindTile } from './KindIcon';

describe('плитка вида привычки', () => {
  it('без названия — рисунок вида, средний размер', async () => {
    const { container } = await renderApp(<KindTile kind="check" />);
    const tile = container.querySelector('.kind-tile')!;
    expect(tile.className).toBe('kind-tile md k-check');
    expect(tile.querySelector('svg')!.getAttribute('width')).toBe('26');
    // календарь с галочкой: рамка, шапка и галочка
    expect(tile.querySelectorAll('rect, path')).toHaveLength(3);
  });

  it('узнанное название меняет рисунок, но не цвет', async () => {
    const plain = await renderApp(<KindTile kind="count" title="Что-то своё" size="sm" />);
    const plainSvg = plain.container.querySelector('svg')!.innerHTML;
    expect(plain.container.querySelector('svg')!.getAttribute('width')).toBe('22');
    const water = await renderApp(<KindTile kind="count" title="Пить воду" size="lg" />);
    const tile = water.container.querySelector('.kind-tile')!;
    expect(tile.className).toBe('kind-tile lg k-count');
    expect(tile.querySelector('svg')!.getAttribute('width')).toBe('30');
    expect(tile.querySelector('svg')!.innerHTML).not.toBe(plainSvg);
  });

  it('у каждого вида свой рисунок и все узнаваемые темы рисуются', async () => {
    const kinds = ['check', 'count', 'abstain'] as const;
    const drawn = new Set<string>();
    for (const kind of kinds) {
      const { container } = await renderApp(<KindTile kind={kind} title="" />);
      drawn.add(container.querySelector('svg')!.innerHTML);
    }
    expect(drawn.size).toBe(3);
    const titles = ['Спортзал', 'Бег', 'Прогулка', 'Йога', 'Зарядка', 'Бассейн', 'Велосипед', 'Вода', 'Читать', 'Английский', 'Дневник', 'Сон', 'Витамины', 'Завтрак', 'Сладкое', 'Курить', 'Алкоголь', 'Кофе', 'Телефон', 'Уборка', 'Бюджет', 'Работа', 'Гитара', 'Рисовать', 'Зубы', 'Собака', 'Позвонить маме'];
    const icons = new Set<string>();
    for (const title of titles) {
      const { container } = await renderApp(<KindTile kind="check" title={title} />);
      icons.add(container.querySelector('svg')!.innerHTML);
    }
    expect(icons.size).toBe(titles.length);
  });
});
