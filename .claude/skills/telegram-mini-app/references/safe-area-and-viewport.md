# Высота видимой области и безопасные отступы

Источники: core.telegram.org/bots/webapps (поля `viewportHeight`,
`viewportStableHeight`, `safeAreaInset`, `contentSafeAreaInset`; события
`viewportChanged`, `safeAreaChanged`, `contentSafeAreaChanged`), исходник
@tma.js/sdk 3.3.0 (`Viewport`), issue TelegramMessenger/Telegram-iOS#1377.

## Как устроено окно мини-аппа

На iOS и Android мини-апп живёт в нижней шторке. Она бывает половинной и
развёрнутой, и человек тянет её пальцем. Пока шторка не развёрнута, **нижняя
часть WebView за краем экрана** — поэтому `100vh`/`100dvh` меряют не то, что
видно. Telegram сообщает видимую часть сам:

| Сигнал @tma.js/sdk | Переменная после `viewport.bindCssVars()` | Смысл |
| --- | --- | --- |
| `viewport.height` | `--tg-viewport-height` | видимая высота прямо сейчас, меняется во время жеста |
| `viewport.stableHeight` | `--tg-viewport-stable-height` | высота в последнем устойчивом состоянии |
| `viewport.width` | `--tg-viewport-width` | ширина |
| `viewport.isExpanded` | — | шторка развёрнута до конца |
| `viewport.isFullscreen` | — | полноэкранный режим (8.0+) |

Документация Telegram: частоты обновления `height` не хватает, чтобы плавно
следить за нижним краем, **прижимать элементы к низу надо по
`stableHeight`**. Отсюда `--app-height` в `assets/telegram.css`.

`viewport.expand()` разворачивает шторку. На десктопе и в вебе мини-апп
открывается сразу развёрнутым, `expand` там ничего не делает. Главный мини-апп
бота и прямые ссылки с Bot API 7.6 по умолчанию открываются во всю высоту,
если в ссылке нет `mode=compact`.

### Что делает `viewport.mount()` (исходник 3.3.0)

- На `macos`, `tdesktop`, `unigram`, `weba`, `webk`, `web` размеры берутся из
  `window.innerHeight/innerWidth` — у этих клиентов нет шторки.
- На `ios`/`android` SDK шлёт `web_app_request_viewport` и ждёт ответа.
  Поэтому `mount()` асинхронный и может упасть по таймауту — ловим.
- Если первый ответ пришёл посреди анимации (`is_state_stable: false`),
  `stableHeight` на старте — **0**, пока не придёт устойчивое состояние. В
  `telegram.css` оболочка берёт `--tg-viewport-stable-height` — при нуле она
  на мгновение схлопнется. На устройстве не наблюдалось (не проверялось);
  если всплывёт — брать `max(var(--tg-viewport-stable-height), var(--tg-viewport-height))`
  до первого устойчивого значения.
- Запросы отступов шлются, только если версия клиента их знает (8.0+); иначе
  отступы — нули.

## Два вида отступов (Bot API 8.0+)

| | Что закрывает | Сигналы | Переменные @tma.js/sdk |
| --- | --- | --- | --- |
| **safe area** | вырез, строка состояния, полоска «домой», системные панели | `viewport.safeAreaInsets()`, `safeAreaInsetTop()` … | `--tg-viewport-safe-area-inset-{top,bottom,left,right}` |
| **content safe area** | интерфейс Telegram поверх содержимого (кнопки шапки в полноэкранном режиме) | `viewport.contentSafeAreaInsets()`, `contentSafeAreaInsetTop()` … | `--tg-viewport-content-safe-area-inset-{…}` |

⚠️ **Имена.** Документация Telegram пишет `--tg-safe-area-inset-*` и
`--tg-content-safe-area-inset-*` — так их называет telegram-web-app.js. У
@tma.js/sdk префикс `viewport-`. Проверено в браузере: с @tma.js/sdk
`--tg-safe-area-inset-top` пустая, `--tg-viewport-safe-area-inset-top` есть.
Чужое имя в `var()` молча даёт запасное значение, то есть 0 — ошибка не
видна, пока не открыть на iPhone.

**Складывать ли.** В `telegram.css` верхний отступ = safe + content. Так
делают сообщество и шаблоны (в том числе yaniv-golan/telegram-webapps-skill),
логика в том, что content safe area — интерфейс Telegram *внутри* безопасной
зоны. **Документация Telegram этого явно не говорит** — проверить на
устройстве в полноэкранном режиме: кнопки «закрыть»/«меню» не должны налезать
на заголовок, и отступ не должен быть двойным.

Смена отступов (поворот, вход в полноэкранный режим) приходит событиями
`safe_area_changed`/`content_safe_area_changed`; привязанные переменные
обновляются сами.

## Почему не `env(safe-area-inset-*)`

- Issue TelegramMessenger/Telegram-iOS#1377 (открыт с марта 2024, на 29.09.2026
  всё ещё открыт): внутри мини-аппа в iOS-клиенте `env(safe-area-inset-bottom)`
  равен 0, хотя полоска «домой» закрывает содержимое. Несколько человек
  подтверждают в обсуждении. Официального ответа Telegram нет — поэтому
  **«по сообщениям», а не «подтверждено»**.
- Для нас это неважно: Telegram отдаёт отступы через API ровно для этого.
  `env()` оставляем только как запасное значение там, где страницу открывают
  и вне Telegram.
- `viewport-fit=cover` в `<meta name="viewport">` ставим: на переменные
  Telegram он не влияет (их считает JS), но без него `env()` в обычных
  браузерах — 0. Влияет ли он на что-то внутри клиентов Telegram —
  не подтверждено.

## Полноэкранный режим (8.0+)

```ts
import { miniApp, viewport } from '@tma.js/sdk-react';

async function goFullscreen(): Promise<void> {
  // Шапка в полноэкранном режиме прозрачна, но её цвет клиент использует,
  // чтобы подобрать контрастную строку состояния.
  miniApp.setHeaderColor.ifAvailable('bg_color');
  if (viewport.requestFullscreen.isAvailable()) {
    await viewport.requestFullscreen(); // бросает FullscreenFailedError: UNSUPPORTED / ALREADY_FULLSCREEN
  }
}
```

Для приложения-трекера полноэкранный режим обычно не нужен: он прячет шапку
Telegram, и человек теряет привычное «назад/закрыть». Включать по причине.

## Клавиатура

Надёжного события «открылась клавиатура» в Mini Apps API нет. Высота
видимой области при этом меняется, но насколько и на каких клиентах —
не подтверждено; эвристики из чужих навыков («сжалось на 15%») — не
проверены. Что есть точно: `hideKeyboard()` — Bot API 9.1+ — прячет
клавиатуру (например, после отправки формы нативной кнопкой).
