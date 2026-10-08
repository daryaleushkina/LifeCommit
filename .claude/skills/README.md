# Навыки, лежащие в проекте

Веб-навыки перенесены из `audioguide` под мини-апп Telegram и лендинг (React + Vite,
TS + GSAP), нативные — под iOS/Mac на SwiftUI (`apple/`) и Android на Kotlin и
Compose (`android/`). Навыки работы с содержанием аудиогида сюда не взяты.

**Навык — справочник, а не начальник.** Его текст попадает в контекст вместе с
задачей, и указания внутри исполняются как советы. Источник правды по виду —
`DESIGN.md` и токены `src/styles/app.css`, по правилам — `AGENTS.md`: навык,
предлагающий цвет, гарнитуру, отступ или длительность мимо токенов, ошибся — не
мы.

**Кто что видит.** Claude читает всё из `.claude/skills/`. Codex — только
`.agents/skills/`: там ссылки на навыки для кода (`telegram-mini-app`, Swift,
Kotlin и Compose). Дизайн-навыки и `grilling` нужны только Claude. Новый навык
для кода — ещё ссылка `.agents/skills/<имя>` → `../../.claude/skills/<имя>`.

## Мини-апп и лендинг

| Навык                          | Когда                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `telegram-mini-app`            | платформенный слой Telegram: тема, safe area, MainButton и BackButton, initData; `pnpm check:tma` ходит в его `scripts/` |
| `grilling`                     | допрос перед новой задачей, вопросы кнопками                          |
| `impeccable`                   | устройство экрана, иерархия, аудит интерфейса                         |
| `apple-design`                 | жесты, шторки, пружинная физика, материалы                            |
| `emil-design-eng`              | отделка деталей, решения по анимациям                                 |
| `ui-ux-pro-max`                | проверочные списки: доступность, цели нажатия, формы                  |
| `mobile-native`                | чтобы веб в WebView ощущался нативным: 100vh, safe area, зум полей, подсветка нажатия |
| `animate`                      | построить анимацию с нуля (веб)                                       |
| `review-animations`            | разбор конкретной анимации                                            |
| `improve-animations`           | аудит движения по всему коду, план правок                             |
| `prototype`                    | несколько вариантов элемента с переключателем — отдельно или прямо на странице, только ручной вызов |
| `better-ui`, `better-layout`, `better-typography`, `better-colors`, `better-accessibility`, `better-writing` | отделка по темам: радиусы и зоны нажатия, раскладка, шрифт, цвет и контраст, доступность, тексты |
| `better-interface`             | все `better-*` одним проходом                                         |
| `interface-review`             | подробный разбор готового экрана, только ручной вызов; в ревью перед пушем, если правка задевает интерфейс |
| `break`                        | компонент во всех состояниях на временной странице, ручной вызов      |
| `explain-interface`            | как сделан понравившийся чужой интерфейс, ручной вызов                |

## Нативные приложения (с 05.10.2026)

Вид нативных приложений — копия мини-аппа, поэтому навыки, которые тянут к
стандартному виду платформы (Material 3, «чистый iOS»), здесь советчики по
поведению, а не по внешности. Решения и контракт API — `docs/mobile.md`.

| Навык                          | Когда                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `swiftui-specialist`           | Apple: @Observable, идентичность ForEach/List, Environment, локализация, устаревшие API; выгружен из Xcode 27 |
| `swiftui-whats-new-27`         | Apple: новое в SwiftUI 27 и ошибки @State после обновления SDK. Наш минимум — iOS 26, поэтому API 27 только под `if #available` |
| `audit-xcode-security-settings`| Apple: защитные настройки сборки; перед первым выпуском              |
| `swiftui-expert-skill`         | состояние и поток данных, шторки, навигация, производительность, разбор трейсов Instruments |
| `swift-concurrency`            | Swift 6: акторы, Sendable, @MainActor, гонки данных                    |
| `swift-testing-expert`         | Swift Testing: #expect/#require, параметры, асинхронное ожидание      |
| `xcuitest`                     | XCUITest: поиск элементов, ожидание, запуск с аргументами, снимки     |
| `mobilebuildmcp`               | собрать, запустить, нажать и снять экран в симуляторе через MCP       |
| `android-cli`                  | Android: создать, собрать, запустить, эмулятор без окна, разметка экрана, снимок |
| `edge-to-edge`, `navigation-3`, `navigation-event` | Android: вырезы и панели, навигация Navigation 3, жест «назад» |
| `roborazzi`, `compose-ui-testing-patterns` | Android: снимки экранов и UI-тесты на JVM без эмулятора |
| `compose-state-and-effects`, `compose-component-design`, `compose-performance`, `compose-animations` | Compose: состояние и эффекты, API компонентов, рекомпозиции, анимации |
| `kotlin-concurrency-and-flow`, `kotlin-control-flow` | корутины, StateFlow/SharedFlow, ветвления Kotlin            |
| `android-intent-security`      | Android: безопасность Intent и экспортируемых компонентов             |

**Грабли нативных навыков:**
- **Ошибки в примерах глотаются.** `try? … ?? []`, `.catch { emit(emptyList()) }`,
  `runCatching` в suspend-коде — наше правило «ошибку не глотать» важнее.
- **Навыки Apple** (`swiftui-*`, `audit-*`) пишут, что «отменяют прежние знания».
  Про API так и есть, но `AGENTS.md` и `DESIGN.md` важнее. Обновлять —
  `xcrun agent skills export --output-dir <папка>` после новой версии Xcode, при
  закрытом Xcode или с подтверждением в нём; переносить только эти три.
- **`android-cli`**: `android init` и `android skills add --all` ставят навыки
  во все найденные папки агентов, в том числе глобально. Не запускать, навыки
  копировать руками. Телеметрию выключить: `--no-metrics` в `~/.androidrc`.
  `adb shell input text` не печатает кириллицу — русский ввод проверять в
  Compose UI-тестах (`performTextInput`).
- **`roborazzi`**: модуль «AI-проверки картинок» ходит в OpenAI/Gemini — не
  подключать.
- **`mobilebuildmcp init` не запускать**: он ставит себя в глобальные папки
  агентов. Гейт перед пушем MCP не использует — там простой `xcodebuild test`.
- **Разбор трейсов в `swiftui-expert-skill`** (`scripts/instruments_parser/`) —
  сторонний код с ошибками: повторный стек по ссылке `<backtrace ref>` теряется,
  корреляция берёт главные потоки всех процессов трейса, а покрытие главного
  потока считается из 1 мс на семпл. Выводы «поток заблокирован» и горячие
  символы сверять в самом Instruments.
- **`compose-state-and-effects` и `compose-ui-testing-patterns` ссылаются на
  `compose-focus-navigation`**, которого в наборе нет. Фокус, клавиатура и
  D-pad — по документации Compose.
- **Не взяты:** Material 3 (`hamen/material-3-skill`, тянет к стандартному
  Material), Dimillian/Skills (старые имена инструментов XcodeBuildMCP),
  Axiom (276 навыков), ECC — для мобильных там короткие шпаргалки с
  проглоченными ошибками в примерах. Идеи `swift-reviewer` / `kotlin-reviewer` —
  кандидаты в нативную линзу `/lc-review`.

## MCP проекта (`.mcp.json`)

- **`chrome-devtools`** — трейсы производительности на замедленном процессоре,
  консоль, сеть, эмуляция экрана, Lighthouse. Запускается с `--isolated`
  (временный профиль, твой Chrome не трогается), экран 390×844, без отправки
  адресов в CrUX и без статистики Google. Версия закреплена, Node 22 через
  `fnm exec`: пакету нужен Node ≥ 20.19, а по умолчанию стоит 20.9.
- **`lazyweb`** — референсы: экраны и сценарии реальных приложений. Вход по
  OAuth: `/mcp` → lazyweb → почта и шестизначный код. Бесплатно, но отчёты
  урезаны; полные — на платном тарифе. Скрипт `install.sh` с их сайта не
  запускаем: он ставит навыки глобально в `~/.claude/skills`.

## Чего делать нельзя

- **`ui-ux-pro-max --persist`.** Он пишет `design-system/<проект>/MASTER.md` и
  называет его «Global Source of Truth» — второй источник правды на диске
  однажды разойдётся с `DESIGN.md`.
- **`/impeccable document` без просьбы владелицы.** Он перезаписывает
  `DESIGN.md` в корне — наш документ дизайна.

## Правлено вручную

Эти правки перезапишет обновление навыка из источника — после обновления
повторить.

- **`ui-ux-pro-max` урезан** (08.10.2026, решение владелицы: React Native и
  Flutter не держим нигде). Удалены стеки `react-native` и `flutter`, набор
  `data/app-interface.csv` (`--domain web`, весь написан под React Native),
  14 мобильных стилей, сделанных на React Native, и 4 набора иконок к ним; из
  оставшихся строк убраны упоминания React Native, Expo и Flutter. Счётчики в
  `data/catalog-summary.json`, описание навыка и `scripts/core.py`,
  `scripts/validate_data.py` поправлены; `python3 scripts/validate_data.py`
  проходит, поиск работает.
- **`prototype`** вобрал `variant`: режим «прямо на странице», одна ось
  различий, общий порог доступности, ширины 375 и 1440 px.
- **`animate`, `mobile-native`** — убраны ссылки на `animate-expo` и
  удалённый `find-animation-opportunities`; **`break`, `explain-interface`** —
  ссылки на `variant` заменены на `prototype`.
- **`grilling`** — вопросы через AskUserQuestion, рекомендованный вариант первым.

## Грабли

- **`impeccable` ставится и обновляется только установщиком**, а не
  копированием папки: `npx impeccable install --providers=claude --project --yes --force`
  (сам `npx` — на Node 22: `eval "$(fnm env --shell bash)" && fnm use 22`).
  Установщик кладёт скилл, агентов в `.claude/agents/impeccable-*` и хуки в
  `.claude/settings.local.json`. С версии 4.2 проверки делает скачанный
  бинарник `scripts/bin/<платформа>/impeccable`, Node ему не нужен.
- **Бинарник `impeccable` в git не кладётся** (12 МБ, под одну платформу):
  в `.gitignore` строка `.claude/skills/impeccable/scripts/bin/`, лаунчер
  скачает его сам при первом запуске.
- **`better-*` написаны под английский текст.** Кириллица, «ёлочки» и
  неразрывные пробелы там не разобраны.
- **Палитры и пары шрифтов `ui-ux-pro-max` кириллицу не учитывают.** Для
  русскоязычного интерфейса шрифт выбирается по разбору кириллицы, а не из
  его базы.

## Что откуда взято

| Папка                                                                                                       | Источник                                                | Лицензия   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| `emil-design-eng`, `animate`, `review-animations`, `improve-animations`, `apple-design`, `prototype`, `mobile-native` | github.com/emilkowalski/skills                          | MIT        |
| `impeccable`                                                                                                | github.com/pbakaus/impeccable, `npx impeccable install` | Apache 2.0 |
| `ui-ux-pro-max`                                                                                             | github.com/nextlevelbuilder/ui-ux-pro-max-skill (урезан, см. выше) | MIT        |
| `better-*`, `interface-review`, `break`, `explain-interface`, а также `variant`, влитый в `prototype`        | github.com/jakubkrehel/skills                           | MIT        |
| `grilling`                                                                                                  | свой                                                    | —          |
| `swiftui-specialist`, `swiftui-whats-new-27`, `audit-xcode-security-settings`                               | Xcode 27 (`xcrun agent skills export`), 05.10.2026      | Apple, не открытая |
| `swiftui-expert-skill`                                                                                      | github.com/AvdLee/SwiftUI-Agent-Skill @9897311          | MIT        |
| `swift-concurrency`                                                                                         | github.com/AvdLee/Swift-Concurrency-Agent-Skill @d577081 | MIT       |
| `swift-testing-expert`                                                                                      | github.com/AvdLee/Swift-Testing-Agent-Skill @798e9b1    | MIT        |
| `xcuitest`                                                                                                  | github.com/Prisma-Labs-Dev/apple-skills @4986260        | MIT        |
| `mobilebuildmcp`                                                                                            | github.com/getsentry/MobileBuildMCP @d13ff0c            | MIT        |
| `android-cli`, `edge-to-edge`, `navigation-3`, `navigation-event`, `android-intent-security`                | github.com/android/skills @42dc227                      | Apache 2.0 |
| `compose-*`, `kotlin-concurrency-and-flow`, `kotlin-control-flow`                                           | github.com/chrisbanes/skills @f872f97                   | Apache 2.0 |
| `roborazzi`                                                                                                 | github.com/takahirom/roborazzi @36479d2                 | Apache 2.0 |

Тексты лицензий MIT и Apache 2.0 — в `LICENSES/`.
