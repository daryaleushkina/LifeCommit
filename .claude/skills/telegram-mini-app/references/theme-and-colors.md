# Тема и цвета

Источник: core.telegram.org/bots/webapps, раздел ThemeParams; имена
переменных и сигналов — исходник @tma.js/sdk 3.3.0.

## Ключи темы и переменные

`themeParams.bindCssVars()` превращает каждый присланный ключ в
`--tg-theme-<ключ через дефис>`. Переменная появляется, только если клиент
ключ прислал: **все 15 ключей необязательные**.

| Ключ | Переменная | С версии | Для чего |
| --- | --- | --- | --- |
| `bg_color` | `--tg-theme-bg-color` | — | основной фон |
| `text_color` | `--tg-theme-text-color` | — | основной текст |
| `hint_color` | `--tg-theme-hint-color` | — | подсказки, вторичный текст |
| `link_color` | `--tg-theme-link-color` | — | ссылки |
| `button_color` | `--tg-theme-button-color` | — | фон кнопки |
| `button_text_color` | `--tg-theme-button-text-color` | — | текст на кнопке |
| `secondary_bg_color` | `--tg-theme-secondary-bg-color` | 6.1 | второй фон (подложка под секциями) |
| `header_bg_color` | `--tg-theme-header-bg-color` | 7.0 | фон шапки |
| `bottom_bar_bg_color` | `--tg-theme-bottom-bar-bg-color` | 7.10 | фон нижней панели |
| `accent_text_color` | `--tg-theme-accent-text-color` | 7.0 | акцентный текст |
| `section_bg_color` | `--tg-theme-section-bg-color` | 7.0 | фон секции; в паре с `secondary_bg_color` |
| `section_header_text_color` | `--tg-theme-section-header-text-color` | 7.0 | заголовок секции |
| `section_separator_color` | `--tg-theme-section-separator-color` | 7.6 | разделитель в секции |
| `subtitle_text_color` | `--tg-theme-subtitle-text-color` | 7.0 | подзаголовок |
| `destructive_text_color` | `--tg-theme-destructive-text-color` | 7.0 | разрушительное действие |

`miniApp.bindCssVars()` добавляет ещё три — текущие цвета, которые
приложение само выставило: `--tg-bg-color`, `--tg-header-color`,
`--tg-bottom-bar-color`.

Устройство «секций» в Telegram: подложка — `secondary_bg_color`, карточки на
ней — `section_bg_color`. Документация советует использовать их вместе.

## Запасные значения

Ключ может не прийти на старом клиенте или в чужой теме. Запасное значение
пишется **цепочкой по смыслу**, а в конце — системный цвет:

```css
.card {
  background: var(--tg-theme-section-bg-color, var(--tg-theme-bg-color, Canvas));
  border-bottom: 1px solid var(--tg-theme-section-separator-color, var(--tg-theme-hint-color, GrayText));
}
.card__title { color: var(--tg-theme-text-color, CanvasText); }
```

`Canvas`, `CanvasText`, `GrayText` — системные цвета CSS: они следуют
`color-scheme` и не выдумывают палитру. Hex как запасное — только с пометкой
в комментарии, что это запасное и почему системного не хватило.

## Схема цвета

- `--tg-color-scheme` **@tma.js/sdk не создаёт** — её ставит telegram-web-app.js
  (проверено: в браузере с @tma.js/sdk переменная пустая).
- Тёмность: `miniApp.isDark` (по текущему фону приложения) или
  `themeParams.isDark` (по `bg_color` темы). Оба — сигналы; в React —
  `useSignal(...)`.
- По ней ставим `color-scheme` на `<html>` (готово в `assets/telegram.css` +
  `assets/bootstrap.tsx`). Зачем: `color-scheme` решает, какими будут полосы
  прокрутки, `<input>`, `<select>`, автозаполнение. Тема Telegram и тема ОС
  независимы; `<meta name="color-scheme" content="light dark">` отдал бы это ОС,
  и в тёмном Telegram на светлом телефоне поля были бы белыми. (Вывод из
  устройства CSS, а не из документации Telegram.)

## Смена темы на лету

Событие `theme_changed` (в telegram-web-app.js — `themeChanged`) приходит, когда
человек меняет тему или включается ночной режим. У @tma.js/sdk
смонтированный `themeParams` обновляет сигналы и привязанные переменные сам.
Ручная работа нужна только там, где CSS не действует:

```tsx
import { themeParams, useSignal } from '@tma.js/sdk-react';

function Chart() {
  const theme = useSignal(themeParams.state); // перерисовка при смене темы
  // theme.button_color, theme.hint_color … — строки '#rrggbb' или undefined
  return <canvas ref={(c) => c && draw(c, theme)} />;
}
```

SVG-иконки — через `currentColor` и `var(--tg-theme-*)`, им подписка не нужна.

## Шапка, фон, нижняя панель

| Метод @tma.js/sdk | Bot API | Что принимает |
| --- | --- | --- |
| `miniApp.setHeaderColor` | 6.1; любой цвет — 6.9 | `'bg_color'`, `'secondary_bg_color'` или `#rrggbb` |
| `miniApp.setBgColor` | 6.1 | ключ темы или `#rrggbb` |
| `miniApp.setBottomBarColor` | 7.10 | `'bg_color'`, `'secondary_bg_color'`, `'bottom_bar_bg_color'` или `#rrggbb`; на Android — ещё и цвет системной панели навигации |

- Ключ лучше hex: он следует за темой. Для фона tma.js это прямо обещает в
  документации; для шапки и панели — проверять сменой темы.
- Произвольный hex в шапке — только после `setHeaderColor.supports('rgb')`:
  до 6.9 клиент принимал только два ключа.
- В полноэкранном режиме шапка прозрачна, но Telegram просит всё равно задать
  её цвет: по нему клиент выбирает контрастный цвет строки состояния и своих
  кнопок (документация `requestFullscreen`).

## Чего не делать

- Hex или палитру из дизайнерского навыка вместо переменных — сломается на
  первой смене темы. Палитры навыков годятся только для акцента, и акцент тоже
  проверяется в обеих темах.
- Писать в `--tg-theme-*` самому: `bindCssVars` перезапишет при следующем
  событии темы, и значение будет «плавать».
- Кэшировать цвет в состоянии при старте — после смены темы он устареет.
