---
name: telegram-mini-app
description: Платформенный слой мини-аппа Telegram на @tma.js/sdk-react — запуск SDK, тема и цвета из themeParams, safe area и высота видимой области, MainButton/SecondaryButton/BackButton, свайпы и подтверждение закрытия, хаптика, CloudStorage/DeviceStorage/SecureStorage, initData, отличия iOS/Android/Desktop, подмена окружения для разработки и скриншотов Playwright вне Telegram. Использовать при любой правке мини-аппа, которая касается Telegram, а не только вёрстки. Триггеры — «мини-апп», «Telegram WebApp», «Mini App», «tma.js», «themeParams», «тема Telegram», «safe area», «вырез», «viewportStableHeight», «MainButton», «главная кнопка», «BackButton», «кнопка назад», «SecondaryButton», «хаптика», «disableVerticalSwipes», «initData», «CloudStorage», «DeviceStorage», «открыть вне Telegram», «мок Telegram».
---

# Мини-апп Telegram: платформенный слой

Навык про то, чем WebView Telegram отличается от браузера, и про @tma.js/sdk.
Вёрстку, движение и общий «веб на телефоне» ведут другие навыки
(`mobile-native`, `impeccable`, `animate`); там, где они спорят с этим,
**в мини-аппе прав этот** — список расхождений в конце.

Сверено 29 сентября 2026: `@tma.js/sdk` 3.3.0, `@tma.js/sdk-react` 3.0.23
(типы и исходник пакета), core.telegram.org/bots/webapps (последнее изменение
мини-аппов — Bot API 10.1, сам Bot API — 10.3), docs.telegram-mini-apps.com.
Что проверено, что нет и где источники разошлись — `references/sources.md`.

## SDK: какой и как

- **Ставится один пакет — `@tma.js/sdk-react`.** Он целиком реэкспортирует
  `@tma.js/sdk`; документация прямо предупреждает не ставить оба: дубль
  пакета SDK ведёт к ошибкам поведения.
- **Не `@telegram-apps/sdk`.** Тот же проект под старым именем, заброшен
  (последняя 3.11.8, декабрь 2025), и API отличается: другие имена сигналов
  (`backgroundColor` → `bgColor`), `ifAvailable()` возвращал кортеж, а не
  `{ ok, data }`. Примеры из старых статей переписываются, а не копируются.
- **Не подключать `telegram-web-app.js` и не трогать `window.Telegram.WebApp`.**
  @tma.js/sdk им не пользуется (говорит с клиентом через мост
  `TelegramWebviewProxy.postEvent`), а CSS-переменные у них с разными именами —
  получится два источника правды.

## Порядок запуска

Готовая точка входа — `assets/bootstrap.tsx` (проверена сборкой и в браузере).
Суть:

1. В dev — подмена окружения динамическим импортом (`assets/mockEnv.ts`).
2. `init()` в `try`: вне Telegram он бросает — показываем «Откройте в Telegram».
3. `themeParams.mount()` **до** `miniApp` и нижних кнопок: они берут из темы
   цвета по умолчанию.
4. `bindCssVars()` у темы, miniApp и viewport — **вне React**: повторный вызов
   бросает `CSSVarsBoundError`, а StrictMode зовёт эффекты дважды.
5. `initData.restore()` — без него сигналы `initData.*` пустые.
6. `await viewport.mount()` — он асинхронный: на iOS/Android размеры и отступы
   спрашиваются у клиента. Ошибку ловим и живём на запасных значениях CSS.
7. `miniApp.ready()` — в эффекте после первого кадра с содержимым или скелетом.
   Раньше — заглушка Telegram сменится пустым экраном; не вызвать — заглушка
   висит до полной загрузки страницы.

**Каждый вызов, который не просто читает сигнал, — через `isAvailable()` или
`ifAvailable()`.** Проверка включает всё сразу: это Telegram, SDK
инициализирован, компонент смонтирован, версия клиента метод знает. Старые
клиенты живут у людей годами.

## Цвета — только из темы Telegram

- В CSS — `var(--tg-theme-*)`; ни одного hex в компонентах. Полный список
  ключей (15 штук) и что куда — `references/theme-and-colors.md`.
- **Все ключи темы необязательные.** Клиент может не прислать, например,
  `section_separator_color` (Bot API 7.6+) — у каждой переменной запасное
  значение, и запасное тоже из темы или системное (`Canvas`, `CanvasText`),
  а не выдуманный hex.
- **`--tg-color-scheme` @tma.js/sdk не создаёт** (её ставит только
  telegram-web-app.js). Тёмность темы — `miniApp.isDark`; по ней ставим
  `color-scheme` на `<html>`, иначе полосы прокрутки и нативные поля пойдут за
  темой телефона, а она с темой Telegram не обязана совпадать.
- Шапку, фон и нижнюю панель красим **ключами темы, а не hex**:
  `miniApp.setHeaderColor('bg_color')`, `setBgColor('secondary_bg_color')`.
  Для фона tma.js в документации прямо обещает: ключ привязывает цвет к теме,
  и при её смене он обновится сам. Для шапки то же не подтверждено — проверять
  сменой темы на устройстве. `setBottomBarColor` — Bot API 7.10+, на Android
  красит ещё и системную панель навигации.
- Canvas, графики, Lottie сами тему не видят: цвета читаются из
  `useSignal(themeParams.state)` в момент отрисовки.

## Высота и отступы

Подробно — `references/safe-area-and-viewport.md`, готовый CSS —
`assets/telegram.css`.

- **Высота — `--tg-viewport-stable-height`, не `100vh` и не `100dvh`.** В
  половинном режиме WebView выше видимой части: прижатое к низу уезжает за
  край. `height` меняется на лету во время жеста, `stableHeight` — только когда
  всё остановилось; документация Telegram прямо советует крепить к нему.
- **Имена переменных у @tma.js/sdk свои:** `--tg-viewport-safe-area-inset-*` и
  `--tg-viewport-content-safe-area-inset-*`. Имена из документации Telegram
  (`--tg-safe-area-inset-*`) создаёт только telegram-web-app.js; с @tma.js/sdk
  они пустые, и `var()` молча отдаёт запасной 0. Проверено в браузере.
- **`env(safe-area-inset-*)` внутри мини-аппа не опора:** в iOS-клиенте, по
  сообщениям в открытом issue TelegramMessenger/Telegram-iOS#1377, он всегда 0.
  Официально не подтверждено, но и не нужно: Telegram отдаёт отступы сам.
- Два вида отступов: **safe area** — вырез и системные панели; **content safe
  area** — интерфейс самого Telegram поверх содержимого (кнопки шапки в
  полноэкранном режиме). Складывать их сверху — практика сообщества;
  документация явно этого не говорит — проверять на устройстве.

## Кнопки и навигация

Подробно и с хуками — `references/buttons-and-navigation.md`,
`assets/hooks.ts`.

- **MainButton — конечный автомат, а не кнопка «по месту»:** idle (включена),
  submitting (выключена + лоадер), blocked (выключена; почему — сказать текстом
  на экране). Текст задаём всегда: по умолчанию клиент пишет «Continue».
- **`onClick` возвращает отписку — возвращаем её из эффекта.** Обработчики
  копятся: без отписки второй рендер экрана — два сохранения по одному нажатию.
- **SecondaryButton — Bot API 7.10+**, `isSupported` обязателен. По умолчанию
  стоит **слева** от главной (не над ней). Для второстепенного действия
  («Пропустить»), а не для второго равноправного.
- **BackButton — от маршрута, а не от истории:** на корневом экране скрыта, на
  вложенном ведёт к родителю. Мини-апп часто открывают глубокой ссылкой
  (`startapp`), и `history.back()` тогда уводит в никуда.
- MainButton при запуске из меню вложений скрыта, пока человек не
  взаимодействовал с интерфейсом (документация) — не строить первый экран на
  том, что она видна сразу.
- **Подтверждение закрытия — только пока есть несохранённое:** включили при
  первой правке, выключили после сохранения. Всегда включённое — диалог на
  каждом выходе.
- **`swipeBehavior.disableVertical()` — только с причиной** (свой вертикальный
  жест у верхнего края). Telegram рекомендует свайпы не выключать; шапкой
  свернуть и закрыть всё равно можно.
- **Хаптика — на итог действия** (`notificationOccurred('success' | 'error')`),
  не на каждое касание. `selectionChanged()` — только когда выбор *меняется*
  (так в документации), не на подтверждение выбора.
- `openLink` — только из обработчика жеста человека (так в документации). Из
  таймера или после `await` сети это уже не ответ на жест — не рассчитывать,
  что сработает.
- Нативные попапы: заголовок до 64 символов, текст 1–256, кнопок 1–3. Русский
  текст длиннее английского — проверять лимит. Кнопки `ok`/`cancel`/`close`
  подписывает клиент на языке *клиента*, а не приложения.

## Данные: initData и хранилища

Подробно — `references/storage-and-init-data.md`.

- **initData на клиенте — для показа, не для прав.** На сервер уходит сырая
  строка (`retrieveRawInitData()`, заголовок `Authorization: tma <строка>` —
  соглашение tma.js), сервер проверяет подпись и срок `auth_date`.
- **При запуске с reply-клавиатуры или из инлайн-режима initData пустая**
  (документация) — такой вход не годится для авторизации. Входы мини-аппа —
  кнопка меню, главный мини-апп бота, прямая ссылка.
- CloudStorage (6.9+) — до 1024 ключей, значение до 4096 символов, ключ
  1–128 символов `A-Za-z0-9_-`. `getItem` в @tma.js/sdk 3.3.0 для
  отсутствующего ключа возвращает `''` (видно в исходнике): пустое значение и
  «нет ключа» неотличимы.
- DeviceStorage (9.0+) — до 5 МБ, только это устройство. SecureStorage (9.0+) —
  до 10 значений, Keychain/Keystore; для токенов, а не для данных.

## Вне Telegram: разработка и скриншоты

Подробно — `references/outside-telegram.md`.

- `assets/mockEnv.ts` → `src/telegram/mockEnv.ts`. Официальный способ tma.js
  (`mockTelegramEnv` + ответы на запросы через `emitEvent`), плюс заглушки
  нативных кнопок в DOM, чтобы они попали на скриншот, и хранилища поверх
  `localStorage`. Параметры — в адресе: `?tgTheme=light&tgInsets=59,34,46,0`.
- В сборку не попадает: импорт только в ветке `import.meta.env.DEV`. Проверено
  `vite build` — ни кода подмены, ни её цветов в бандле.
- Скриншоты обеих тем: `node .claude/skills/telegram-mini-app/scripts/screenshot.mjs --url http://localhost:5173/`.
- Это проверка вёрстки и темы в Chromium, не WebView Telegram. Итог — на
  устройстве; как открыть инспектор на каждой платформе —
  `references/platforms.md`.

## Чего не делать

- Hex, `rgb()` или палитра из навыка вместо `var(--tg-theme-*)`.
- `100vh`/`100dvh` для оболочки; `env(safe-area-inset-*)`;
  `--tg-safe-area-inset-*` с @tma.js/sdk.
- Вызов метода без `isAvailable()`/`ifAvailable()`.
- `onClick` без отписки; `bindCssVars()` в эффекте.
- `miniApp.ready()` до первого кадра с содержимым.
- Права по `initData.user()` на клиенте; секреты в CloudStorage.
- `mockTelegramEnv` вне dev-ветки; статический импорт `mockEnv.ts`.
- Чтение `location.hash` руками: после первой навигации роутера параметров
  запуска там нет. `retrieveLaunchParams()` берёт их из `sessionStorage`.
- Ветвление по `platform` там, где можно проверить возможность
  (`isAvailable()`, `supports()`).
- Подтверждение закрытия и отключение свайпов «на всякий случай».

## Проверка

```bash
bash .claude/skills/telegram-mini-app/scripts/check.sh src   # запреты выше по исходникам
node .claude/skills/telegram-mini-app/scripts/screenshot.mjs --url http://localhost:5173/
```

`check.sh` падает на нарушениях и отдельно перечисляет места «посмотреть
глазами» (обработчики кнопок, хаптика, `disableVertical`).

## Где этот навык спорит с `mobile-native`

| `mobile-native` советует | В мини-аппе | Почему |
| --- | --- | --- |
| `100dvh` для оболочки | `--tg-viewport-stable-height` | WebView выше видимой части |
| `env(safe-area-inset-*)` | `--tg-viewport-*safe-area-inset-*` | в iOS-клиенте env() — 0 |
| `theme-color` по `prefers-color-scheme` | `miniApp.setHeaderColor('bg_color')` | шапку рисует Telegram |
| `<meta name="color-scheme" content="light dark">` | `color-scheme` из `miniApp.isDark` | тема Telegram ≠ тема ОС |

## Откуда взято

Часть правил — по мотивам навыков `z-ts-telegram-mini-app`
(victorzhuk/skills, Apache-2.0) и `telegram-webapps` (yaniv-golan, MIT); основа
подмены — шаблон tma.js (MIT). Что именно и откуда — `LICENSES.md`.
Каждое утверждение перепроверено по первоисточникам; расхождения с исходными
навыками — `references/sources.md`.
