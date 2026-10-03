// Шторки выбора: варианты, дата календарём, время барабанами.
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../test/render';
import { DateRow, SelectRow, Sheet, TimeRow } from './Picker';

const backdrop = () => document.querySelector<HTMLElement>('.sheet-backdrop')!;
const dialog = (name: string) => page.getByRole('dialog', { name });

describe('шторка', () => {
  it('закрывается по Escape и тапу мимо, но не тапом внутри', async () => {
    const onClose = vi.fn();
    await renderApp(
      <Sheet title="Тема" onClose={onClose}>
        <p>Внутри</p>
      </Sheet>,
    );
    await expect.element(dialog('Тема')).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Тема' })).toBeVisible();
    await page.getByText('Внутри').click();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    backdrop().click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('выбор из списка', () => {
  const options = [
    { value: 'light', label: 'Светлая' },
    { value: 'dark', label: 'Тёмная' },
  ];

  it('показывает выбранное, другой вариант уходит наверх и закрывает шторку', async () => {
    const onChange = vi.fn();
    await renderApp(<SelectRow label="Тема" value="light" options={options} onChange={onChange} />);
    const row = page.getByRole('button', { name: /Тема/ });
    await expect.element(row).toHaveTextContent('ТемаСветлая');
    await row.click();
    await expect.element(page.getByRole('option', { name: 'Светлая' })).toHaveAttribute('aria-selected', 'true');
    await expect.element(page.getByRole('option', { name: 'Тёмная' })).toHaveAttribute('aria-selected', 'false');
    await page.getByRole('option', { name: 'Тёмная' }).click();
    expect(onChange).toHaveBeenCalledWith('dark');
    await expect.element(dialog('Тема')).not.toBeInTheDocument();
  });

  it('тот же вариант просто закрывает; незнакомое значение — пусто', async () => {
    const onChange = vi.fn();
    const { rerender } = await renderApp(<SelectRow label="Тема" value="light" options={options} onChange={onChange} />);
    await page.getByRole('button', { name: /Тема/ }).click();
    await page.getByRole('option', { name: 'Светлая' }).click();
    expect(onChange).not.toHaveBeenCalled();
    await expect.element(dialog('Тема')).not.toBeInTheDocument();
    await page.getByRole('button', { name: /Тема/ }).click();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog('Тема')).not.toBeInTheDocument();
    await rerender(<SelectRow label="Тема" value="sepia" options={options} onChange={onChange} />);
    await expect.element(page.getByRole('button', { name: /Тема/ })).toMatchTextContent(/^Тема$/);
  });
});

describe('дата', () => {
  it('«Последний раз»: не позже сегодня, листается по месяцам и годам, можно сбросить', async () => {
    const onChange = vi.fn();
    await renderApp(<DateRow label="Последний раз" value="2026-10-03" max="2026-10-03" onChange={onChange} />);
    await expect.element(page.getByRole('button', { name: /Последний раз/ })).toMatchTextContent(/3 октября/);
    await page.getByRole('button', { name: /Последний раз/ }).click();
    const sheet = dialog('Последний раз');
    await expect.element(sheet.getByText('октябрь 2026')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Следующий год' })).toBeDisabled();
    await expect.element(sheet.getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(sheet.getByRole('button', { name: '4', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect.element(sheet.getByText('сентябрь 2026')).toBeVisible();
    await page.getByRole('button', { name: 'Предыдущий год' }).click();
    await expect.element(sheet.getByText('сентябрь 2025')).toBeVisible();
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await expect.element(sheet.getByText('октябрь 2025')).toBeVisible();
    // Год вперёд не перескакивает за последний доступный месяц.
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await page.getByRole('button', { name: 'Следующий год' }).click();
    await expect.element(sheet.getByText('сентябрь 2026')).toBeVisible();
    await page.getByRole('button', { name: 'Следующий год' }).click();
    await expect.element(sheet.getByText('октябрь 2026')).toBeVisible();
    await sheet.getByRole('button', { name: '1', exact: true }).click();
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01');
    await expect.element(sheet).not.toBeInTheDocument();
    // Открыли снова — на месяце выбранной даты; «Сбросить дату» стирает.
    await page.getByRole('button', { name: /Последний раз/ }).click();
    await expect.element(dialog('Последний раз').getByText('октябрь 2026')).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить дату' }).click();
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('дело: не раньше нижней границы, год назад упирается в неё', async () => {
    const onChange = vi.fn();
    await renderApp(<DateRow label="Другой день" value="" min="2026-10-05" clearable={false} placeholder="Выбрать" onChange={onChange} />);
    await expect.element(page.getByRole('button', { name: /Другой день/ })).toMatchTextContent(/Выбрать/);
    await page.getByRole('button', { name: /Другой день/ }).click();
    const sheet = dialog('Другой день');
    await expect.element(sheet.getByText('октябрь 2026')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Предыдущий месяц' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Предыдущий год' })).toBeDisabled();
    await expect.element(sheet.getByRole('button', { name: '4', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Следующий год' }).click();
    await expect.element(sheet.getByText('октябрь 2027')).toBeVisible();
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await page.getByRole('button', { name: 'Предыдущий год' }).click();
    await expect.element(sheet.getByText('октябрь 2026')).toBeVisible();
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await page.getByRole('button', { name: 'Предыдущий год' }).click();
    await expect.element(sheet.getByText('октябрь 2026')).toBeVisible();
    await page.getByRole('button', { name: 'Следующий год' }).click();
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await page.getByRole('button', { name: 'Предыдущий год' }).click();
    await expect.element(sheet.getByText('ноябрь 2026')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Сбросить дату' })).not.toBeInTheDocument();
    await sheet.getByRole('button', { name: '20', exact: true }).click();
    expect(onChange).toHaveBeenCalledWith('2026-11-20');
    // Передумали — Escape закрывает без выбора.
    await page.getByRole('button', { name: /Другой день/ }).click();
    await userEvent.keyboard('{Escape}');
    await expect.element(sheet).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('год пишется, только если он не тот же, что у границы; без даты — «Не указано»', async () => {
    const { rerender } = await renderApp(<DateRow label="Когда" value="2025-12-31" max="2026-10-03" onChange={() => {}} />);
    await expect.element(page.getByRole('button', { name: /Когда/ })).toMatchTextContent(/31 декабря 2025/);
    await rerender(<DateRow label="Когда" value="2026-03-08" min="2026-01-01" onChange={() => {}} />);
    await expect.element(page.getByRole('button', { name: /Когда/ })).toMatchTextContent(/^Когда8 марта$/);
    await rerender(<DateRow label="Когда" value="2024-03-08" onChange={() => {}} />);
    await expect.element(page.getByRole('button', { name: /Когда/ })).toMatchTextContent(/^Когда8 марта$/);
    await rerender(<DateRow label="Когда" value="" onChange={() => {}} />);
    await expect.element(page.getByRole('button', { name: /Когда/ })).toMatchTextContent(/Не указано/);
    // Без даты, но с верхней границей — календарь открывается на её месяце.
    await rerender(<DateRow label="Когда" value="" max="2026-02-10" onChange={() => {}} />);
    await page.getByRole('button', { name: /Когда/ }).click();
    await expect.element(dialog('Когда').getByText('февраль 2026')).toBeVisible();
  });

  it('без даты и границ открывается на текущем месяце; по-английски — английские названия', async () => {
    await renderApp(<DateRow label="Date" value="" onChange={() => {}} />, 'en');
    await page.getByRole('button', { name: /Date/ }).click();
    const now = new Date();
    const label = `${now.toLocaleDateString('en-US', { month: 'long' })} ${now.getFullYear()}`;
    await expect.element(dialog('Date').getByText(label)).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Previous month' })).toBeEnabled();
    await expect.element(page.getByRole('button', { name: 'Next year' })).toBeEnabled();
  });
});

describe('время', () => {
  const selected = (wheel: string) => page.getByRole('listbox', { name: wheel }).getByRole('option', { selected: true });

  it('барабаны открываются на текущем времени, прокрутка меняет выбор, «Готово» отдаёт «ЧЧ:ММ»', async () => {
    const onChange = vi.fn();
    await renderApp(<TimeRow label="Напоминание" value="07:30" onChange={onChange} />);
    await expect.element(page.getByRole('button', { name: /Напоминание/ })).toMatchTextContent(/07:30/);
    await page.getByRole('button', { name: /Напоминание/ }).click();
    await expect.element(selected('Часы')).toHaveTextContent('07');
    await expect.element(selected('Минуты')).toHaveTextContent('30');
    // Ничего не меняли — «Готово» ничего не отправляет.
    await page.getByRole('button', { name: 'Готово' }).click();
    expect(onChange).not.toHaveBeenCalled();
    await expect.element(dialog('Напоминание')).not.toBeInTheDocument();

    await page.getByRole('button', { name: /Напоминание/ }).click();
    const hours = page.getByRole('listbox', { name: 'Часы' }).element() as HTMLElement;
    hours.scrollTop = 9 * 44;
    await expect.element(selected('Часы')).toHaveTextContent('09');
    // Тап по строке барабана докручивает до неё.
    await page.getByRole('listbox', { name: 'Минуты' }).getByRole('option', { name: '45' }).click();
    await expect.element(selected('Минуты')).toHaveTextContent('45');
    // Докрутили и вернули на то же место — выбор не меняется.
    hours.scrollTop = 9 * 44 + 10;
    hours.dispatchEvent(new Event('scroll'));
    await page.getByRole('button', { name: 'Готово' }).click();
    expect(onChange).toHaveBeenCalledWith('09:45');
    // Без allowOff кнопки «Выключить» нет.
    await page.getByRole('button', { name: /Напоминание/ }).click();
    await expect.element(page.getByRole('button', { name: 'Выключить' })).not.toBeInTheDocument();
  });

  it('выключенное время: подпись «Выкл» или своя, открывается с initial, «Выключить» только у включённого', async () => {
    const onChange = vi.fn();
    const Box = () => {
      const [v, setV] = useState<string | null>('10:00');
      return (
        <TimeRow
          label="Время"
          value={v}
          onChange={(next) => {
            onChange(next);
            setV(next);
          }}
          allowOff
          offLabel="Весь день"
          offAction="Без времени"
          initial="12:00"
        />
      );
    };
    await renderApp(<Box />);
    await page.getByRole('button', { name: /Время/ }).click();
    await page.getByRole('button', { name: 'Без времени' }).click();
    expect(onChange).toHaveBeenCalledWith(null);
    await expect.element(page.getByRole('button', { name: /Время/ })).toMatchTextContent(/Весь день/);
    await page.getByRole('button', { name: /Время/ }).click();
    await expect.element(selected('Часы')).toHaveTextContent('12');
    await expect.element(page.getByRole('button', { name: 'Без времени' })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Готово' }).click();
    expect(onChange).toHaveBeenLastCalledWith('12:00');
  });

  it('только часы до предела: минуты не выбираются, время за пределом прижимается', async () => {
    const onChange = vi.fn();
    const { rerender } = await renderApp(<TimeRow label="День заканчивается" value={null} onChange={onChange} minuteStep={60} maxHour={5} allowOff />);
    await expect.element(page.getByRole('button', { name: /День заканчивается/ })).toMatchTextContent(/Выкл/);
    await page.getByRole('button', { name: /День заканчивается/ }).click();
    await expect.element(page.getByRole('listbox', { name: 'Минуты' })).not.toBeInTheDocument();
    expect(document.querySelector('.wheels .fixed')!.textContent).toBe('00');
    expect(page.getByRole('listbox', { name: 'Часы' }).getByRole('option').elements()).toHaveLength(6);
    await expect.element(selected('Часы')).toHaveTextContent('05');
    await page.getByRole('button', { name: 'Готово' }).click();
    expect(onChange).toHaveBeenCalledWith('05:00');
    // Минуты округляются до шага и не выходят за последний; «Выключить» — подпись по умолчанию.
    await rerender(<TimeRow label="Будильник" value="07:58" onChange={onChange} allowOff />);
    await page.getByRole('button', { name: /Будильник/ }).click();
    await expect.element(selected('Минуты')).toHaveTextContent('55');
    await expect.element(page.getByRole('button', { name: 'Выключить' })).toBeVisible();
    // Тап мимо шторки — закрыть без изменений.
    backdrop().click();
    await expect.element(dialog('Будильник')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledOnce();
  });
});
