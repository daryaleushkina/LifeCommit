// Строка со свайпом: короткий свайп открывает кнопки, до конца — срабатывает крайняя, вертикальное — прокрутка.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../test/render';
import { SwipeRow, type SwipeAction } from './SwipeRow';

const tg = vi.hoisted(() => ({ disable: vi.fn(), enable: vi.fn(), impact: vi.fn() }));
vi.mock('@tma.js/sdk-react', async (orig) => ({
  ...(await orig<typeof import('@tma.js/sdk-react')>()),
  swipeBehavior: { disableVertical: { ifAvailable: tg.disable }, enableVertical: { ifAvailable: tg.enable } },
  hapticFeedback: { impactOccurred: { ifAvailable: tg.impact } },
}));

beforeEach(() => vi.clearAllMocks());

/** Палец: события указателя на теле строки. */
function finger(el: Element, pointerId = 1, pointerType = 'touch') {
  const fire = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType, clientX: x, clientY: y, button: 0, ...extra }));
  return {
    down: (x: number, y = 20, extra?: PointerEventInit) => fire('pointerdown', x, y, extra),
    move: (x: number, y = 20, extra?: PointerEventInit) => fire('pointermove', x, y, extra),
    up: (x: number, y = 20) => fire('pointerup', x, y),
    cancel: (x: number, y = 20) => fire('pointercancel', x, y),
  };
}

const shift = (body: HTMLElement) => {
  const m = /translateX\((-?[\d.]+)px\)/.exec(body.style.transform);
  return m ? Number(m[1]) : 0;
};

function actions(): { remove: SwipeAction; hide: SwipeAction } {
  return {
    remove: { label: 'Удалить', tone: 'danger', icon: 'trash', run: vi.fn() },
    hide: { label: 'Скрыть', tone: 'muted', icon: 'hide', run: vi.fn() },
  };
}

async function row(list: SwipeAction[], onOpen = vi.fn(), variant?: 'row' | 'card') {
  const r = await renderApp(
    <ul className="card todo-list">
      <SwipeRow actions={list} className="extra" variant={variant}>
        <button className="todo-main" onClick={onOpen}>
          Купить молоко
        </button>
      </SwipeRow>
    </ul>,
  );
  const body = r.container.querySelector<HTMLElement>('.swipe-body')!;
  return { ...r, body, onOpen };
}

describe('без действий', () => {
  it('строка — обычный пункт списка, карточка — просто содержимое', async () => {
    const { container } = await renderApp(
      <ul>
        <SwipeRow actions={[]} className="plain">
          <span>Строка</span>
        </SwipeRow>
      </ul>,
    );
    expect(container.querySelector('li.plain')!.textContent).toBe('Строка');
    expect(container.querySelector('.swipe-body')).toBeNull();
    const card = await renderApp(
      <SwipeRow actions={[]} variant="card">
        <article>Карточка</article>
      </SwipeRow>,
    );
    expect(card.container.firstElementChild!.tagName).toBe('ARTICLE');
  });
});

describe('свайп влево', () => {
  it('короткий свайп открывает кнопки, тап по строке закрывает, не открывая дело', async () => {
    const { remove, hide } = actions();
    const { body, onOpen, container } = await row([remove, hide]);
    expect(container.querySelector('li')!.className).toBe('swipe extra');
    expect(container.querySelector('.swipe-actions')!.getAttribute('aria-hidden')).toBe('true');
    const f = finger(body);
    f.down(300);
    f.move(295); // ещё не понятно, куда ведут
    expect(tg.disable).not.toHaveBeenCalled();
    f.move(280);
    expect(tg.disable).toHaveBeenCalledOnce();
    await expect.poll(() => container.querySelector('li')!.classList.contains('dragging')).toBe(true);
    f.move(170);
    await expect.poll(() => shift(body)).toBe(-130);
    f.up(170);
    expect(tg.enable).toHaveBeenCalledOnce();
    // Больше половины открытой части — строка встаёт открытой на две кнопки.
    await expect.poll(() => shift(body)).toBe(-168);
    await expect.element(page.getByRole('button', { name: 'Удалить' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Скрыть' })).toBeVisible();
    expect(container.querySelector('.swipe-actions')!.getAttribute('aria-hidden')).toBe('false');
    expect(container.querySelector('li')!.classList.contains('dragging')).toBe(false);

    // Клик, который браузер шлёт сразу после отпускания, — часть жеста: проглатывается, строка остаётся открытой.
    body.querySelector('button')!.click();
    expect(onOpen).not.toHaveBeenCalled();
    expect(shift(body)).toBe(-168);
    // Следующий тап по открытой строке только закрывает её.
    await page.getByRole('button', { name: 'Купить молоко' }).click();
    expect(onOpen).not.toHaveBeenCalled();
    await expect.poll(() => shift(body)).toBe(0);
    // Закрытая строка открывает дело как обычно.
    await page.getByRole('button', { name: 'Купить молоко' }).click();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(remove.run).not.toHaveBeenCalled();
    expect(hide.run).not.toHaveBeenCalled();
  });

  it('недотянул до половины — строка возвращается на место', async () => {
    const { remove } = actions();
    const { body } = await row([remove]);
    const f = finger(body);
    f.down(300);
    f.move(285);
    f.move(270);
    await expect.poll(() => shift(body)).toBe(-30);
    f.up(270);
    await expect.poll(() => shift(body)).toBe(0);
    expect(remove.run).not.toHaveBeenCalled();
  });

  it('кнопка под строкой срабатывает и закрывает строку', async () => {
    const { remove, hide } = actions();
    const { body } = await row([remove, hide]);
    const f = finger(body);
    f.down(300);
    f.move(280);
    f.move(150);
    await expect.poll(() => shift(body)).toBe(-150);
    f.up(150);
    await page.getByRole('button', { name: 'Скрыть' }).click();
    expect(hide.run).toHaveBeenCalledOnce();
    expect(remove.run).not.toHaveBeenCalled();
    await expect.poll(() => shift(body)).toBe(0);
  });

  it('до конца — срабатывает крайнее действие, на пороге дрожит телефон', async () => {
    const { remove, hide } = actions();
    const { body, container } = await row([remove, hide]);
    const width = container.querySelector('li')!.offsetWidth;
    const f = finger(body);
    f.down(width - 10);
    f.move(width - 30);
    f.move(10);
    await expect.poll(() => shift(body)).toBe(-(width - 20));
    expect(tg.impact).toHaveBeenCalledWith('light');
    // На длинном свайпе видна только крайняя кнопка во всю ширину.
    await expect.poll(() => container.querySelectorAll('.swipe-btn').length).toBe(1);
    expect(container.querySelector('.swipe-btn')!.textContent).toBe('Скрыть');
    // Вернул палец назад — порог пройден обратно, ещё одна отдача.
    f.move(width - 100);
    await expect.poll(() => shift(body)).toBe(-90);
    expect(tg.impact).toHaveBeenCalledTimes(2);
    f.move(-50); // дальше ширины строка не уезжает
    await expect.poll(() => shift(body)).toBe(-width);
    f.up(-50);
    expect(hide.run).toHaveBeenCalledOnce();
    expect(remove.run).not.toHaveBeenCalled();
    await expect.poll(() => shift(body)).toBe(-width);
  });

  it('вправо строка не уезжает', async () => {
    const { remove } = actions();
    const { body } = await row([remove]);
    const f = finger(body);
    f.down(100);
    f.move(120);
    f.move(200);
    f.up(200);
    await expect.poll(() => body.style.transform).toBe('');
    expect(remove.run).not.toHaveBeenCalled();
  });

  it('отмена касания системой — как отпустили', async () => {
    const { remove } = actions();
    const { body } = await row([remove]);
    const f = finger(body);
    f.down(300);
    f.move(280);
    f.move(200);
    await expect.poll(() => shift(body)).toBe(-100);
    f.cancel(200);
    expect(tg.enable).toHaveBeenCalledOnce();
    await expect.poll(() => shift(body)).toBe(-84);
  });
});

describe('что строка не ловит', () => {
  it('вертикальное движение — прокрутка: строка не двигается, Telegram не трогаем', async () => {
    const { remove } = actions();
    const { body, onOpen } = await row([remove]);
    const f = finger(body);
    f.down(300, 20);
    f.move(295, 40);
    f.move(150, 60); // уже решено, что это прокрутка
    f.up(150, 60);
    expect(tg.disable).not.toHaveBeenCalled();
    expect(tg.enable).not.toHaveBeenCalled();
    expect(body.style.transform).toBe('');
    await page.getByRole('button', { name: 'Купить молоко' }).click();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('правая кнопка мыши и чужой палец не считаются', async () => {
    const { remove } = actions();
    const { body } = await row([remove]);
    finger(body, 1, 'mouse').down(300, 20, { button: 2 });
    finger(body, 1, 'mouse').move(150);
    finger(body).up(150);
    expect(tg.disable).not.toHaveBeenCalled();
    const f = finger(body, 1);
    f.down(300);
    finger(body, 7).move(100); // второй палец
    expect(tg.disable).not.toHaveBeenCalled();
    finger(body, 7).up(100);
    f.move(150);
    f.up(150);
    // Отпустили до решения о направлении: ничего не произошло.
    expect(body.style.transform).toBe('');
  });

  it('мышь левой кнопкой смахивает так же', async () => {
    const { remove } = actions();
    const { body } = await row([remove]);
    const f = finger(body, 1, 'mouse');
    f.down(300);
    f.move(280);
    f.move(200);
    await expect.poll(() => shift(body)).toBe(-100);
    f.up(200);
    await expect.poll(() => shift(body)).toBe(-84);
  });
});

describe('открытой бывает одна строка', () => {
  it('открыли другую — первая закрывается; карточка — div', async () => {
    const a = actions();
    const b = actions();
    const { container, unmount } = await renderApp(
      <>
        <ul className="card todo-list">
          <SwipeRow actions={[a.remove]}>
            <span>Первая</span>
          </SwipeRow>
        </ul>
        <SwipeRow actions={[b.remove]} variant="card">
          <article className="task">Вторая</article>
        </SwipeRow>
      </>,
    );
    const [first, second] = [...container.querySelectorAll<HTMLElement>('.swipe-body')] as [HTMLElement, HTMLElement];
    expect(second.parentElement!.tagName).toBe('DIV');
    expect(second.parentElement!.className).toBe('swipe swipe-card');
    const f1 = finger(first);
    f1.down(300);
    f1.move(280);
    f1.move(200);
    await expect.poll(() => shift(first)).toBe(-100);
    f1.up(200);
    await expect.poll(() => shift(first)).toBe(-84);
    const f2 = finger(second);
    f2.down(300);
    f2.move(280);
    await expect.poll(() => shift(first)).toBe(0);
    f2.move(200);
    await expect.poll(() => shift(second)).toBe(-100);
    f2.up(200);
    await expect.poll(() => shift(second)).toBe(-84);
    await unmount();
  });
});

describe('повторный свайп', () => {
  it('открытую строку можно дотянуть дальше — она не захлопывается на полпути', async () => {
    const { remove, hide } = actions();
    const { body } = await row([remove, hide]);
    const f = finger(body);
    f.down(300);
    f.move(280);
    f.move(150);
    await expect.poll(() => shift(body)).toBe(-150);
    f.up(150);
    await expect.poll(() => shift(body)).toBe(-168);
    // Снова ведём ту же строку: как только понятно, что вбок, она не должна прыгать в 0.
    f.down(300);
    f.move(280);
    // «Ведём вбок» и сдвиг приходят одной отрисовкой: дождались класса — сдвиг уже тот, что увидит человек.
    await expect.poll(() => body.parentElement!.classList.contains('dragging')).toBe(true);
    expect(shift(body)).toBe(-168);
    f.move(270);
    await expect.poll(() => shift(body)).toBe(-198);
  });

  it('закрытая строка забывается: свайп другой не трогает удалённую', async () => {
    const a = actions();
    const b = actions();
    const first = await renderApp(
      <ul className="card todo-list">
        <SwipeRow actions={[a.remove]}>
          <span>Первая</span>
        </SwipeRow>
      </ul>,
    );
    const body = first.container.querySelector<HTMLElement>('.swipe-body')!;
    const f = finger(body);
    f.down(300);
    f.move(280);
    f.move(200);
    await expect.poll(() => shift(body)).toBe(-100);
    f.up(200);
    await expect.poll(() => shift(body)).toBe(-84);
    await first.unmount();
    const second = await renderApp(
      <ul className="card todo-list">
        <SwipeRow actions={[b.remove]}>
          <span>Вторая</span>
        </SwipeRow>
      </ul>,
    );
    const body2 = second.container.querySelector<HTMLElement>('.swipe-body')!;
    const g = finger(body2);
    g.down(300);
    g.move(280);
    g.move(200);
    await expect.poll(() => shift(body2)).toBe(-100);
  });
});
