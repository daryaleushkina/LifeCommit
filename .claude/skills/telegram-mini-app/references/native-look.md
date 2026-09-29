# Откуда брать нативный вид

Сверено 29.09.2026: лицензии — по GitHub и telegram.org/apps, пути и имена
функций — по текущим веткам репозиториев. Figma — по данным поиска, не сверено.

## Клиенты Telegram: открыты, но GPL

| Клиент | Репозиторий | Лицензия |
| --- | --- | --- |
| Web A (React) | github.com/Ajaxy/telegram-tt | GPL-3.0 |
| Web K | github.com/morethanwords/tweb | GPL-3.0 |
| iOS | github.com/TelegramMessenger/Telegram-iOS | GPL v2 или новее (telegram.org/apps; файла лицензии в корне репозитория нет) |
| Android | github.com/DrKLO/Telegram | GPL-2.0 (GitHub), «v2 или новее» на telegram.org/apps |

**Правило: из клиентов берутся только значения** — цвета, размеры, радиусы,
длительности, `cubic-bezier`, поведение (что происходит при нажатии, свайпе,
ошибке). Компонент пишется с нуля. **Код, SVG, иконки и прочие ассеты не
копируются**: GPL распространяется на производное, и один скопированный
файл обязывает открыть мини-апп под GPL.

Где смотреть:

- **Как тема клиента превращается в `themeParams`** — это отвечает на вопрос
  «какой нативный цвет прячется за `section_bg_color` на iOS»:
  - iOS: `submodules/WebUI/Sources/WebAppController.swift` → `generateWebAppThemeParams`;
  - Android: `TMessagesProj/src/main/java/org/telegram/ui/bots/BotWebViewSheet.java` → `makeThemeParams`;
  - Web A: `src/util/themeStyle.ts` → `FALLBACK_THEME_PARAMS`.
- **Токены движения и размеров:** Web A — `src/styles/_variables.scss`,
  Web K — `src/scss/base.scss`.

Значения оттуда — ориентир, а не замена `var(--tg-theme-*)`: цвета всё равно
приходят из темы (см. `theme-and-colors.md`).

## MIT: можно брать код

- **TelegramUI** — github.com/telegram-mini-apps-dev/TelegramUI, витрина
  tgui.xelene.me. Образец `Cell`/`Section`/`List` и шкалы типографики
  (`src/components/Service/AppRoot/AppRoot.module.css`). Оговорки:
  версия 2.1.13 требует `react ^18.2.0` (с React 19 — только с проверкой);
  платформы только `ios` и `base`; открытые issues #114 и #116 — в тёмной
  теме часть поверхностей зашита серым мимо темы Telegram; #115 — ripple в
  `Cell` перехватывает события у вложенного `<input>`. Последний push —
  октябрь 2025. Разумнее брать как образец и переписывать, чем ставить
  зависимостью.
- **Официальный шаблон** — github.com/Telegram-Mini-Apps/reactjs-template
  (React + Vite + @tma.js/sdk-react). Отсюда основа `assets/mockEnv.ts`.
- **Живой открытый мини-апп** — github.com/kubk/memo-card (React): списки и
  шторки в `packages/frontend/src/ui/`.

При копировании кода из MIT — сохранить заголовок с авторством и добавить
строку в `LICENSES.md` навыка или проекта.

## Figma Community

«Telegram Mini Apps · UI Kit», «Telegram iOS UI Kit», «Telegram Android UI
Kit». Бесплатные файлы Figma Community по умолчанию идут под CC BY 4.0 —
использовать можно с указанием автора. **По данным поиска 29.09.2026, не
сверено**: лицензию конкретного файла смотреть на его странице.
