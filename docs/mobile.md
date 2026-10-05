# Нативные приложения: iOS, Mac, Android

Обновлено 05.10.2026. Это общий документ для сессий, которые пишут нативные клиенты. В нём решения владелицы, устройство,
вход и контракт API. Кто что уже умеет, лежит в `docs/parity.md`, правило «фича — сразу во всех клиентах» — в `CLAUDE.md`
(раздел «Платформы»).

## Решения (допрос 05.10.2026)

| Что | Решение |
| --- | --- |
| Технология | Нативно, без React Native и Expo. **iOS и Mac** — одно приложение на SwiftUI (`apple/`). **Android** — Kotlin и Jetpack Compose (`android/`), его ведёт отдельная сессия |
| Версии | **iOS 26+ и macOS 26+**. Правило «текущая версия и одна до неё»: в июне 2026 iOS 26 стояла у 79% айфонов. У кого старый айфон, остаётся мини-апп. Android — по выбору Android-сессии, записать сюда |
| Вид | **Копия мини-аппа**: палитра «Мягкий», шрифт Onest, матовое стекло на карточках, своя нижняя панель с микрофоном посередине, шторки снизу. Источник правды — `DESIGN.md` и токены `src/styles/app.css` |
| Поведение | **Родное для платформы**: свайп от края — назад, шторку тянут вниз, системная хаптика, размер текста из настроек (Dynamic Type / font scale), VoiceOver и TalkBack, на Mac — меню и ⌘-сочетания, на Android — системный «назад» и edge-to-edge |
| Вход | **Официальный вход Telegram (OpenID Connect)** — сервер выдаёт тот же ключ сессии, что компьютеру. **Sign in with Apple** и аккаунты без Telegram — отдельный этап до App Store: правило 4.8 требует второй способ входа, 4.2.3 запрещает требовать установленный Telegram |
| Аккаунт Apple Developer | Пока нет. Работаем на симуляторе, на свой iPhone — через бесплатный Personal Team (подпись на 7 дней). Покупаем перед TestFlight |
| Порядок | Ядро → «Календарь» (весь раздел: День/Месяц, дела со временем, шторка дела, Apple и Google) → «Вместе» (группы и друзья целиком) → «Я» → «Голос» → «Поделиться» и жалобы (уточнено владелицей 05.10.2026 через Android-сессию). Пушим по разделу — сразу iOS/Mac и Android, с ревью. Пока раздела нет, вкладка ведёт в мини-апп |
| Напоминания | Пока шлёт бот. Уведомления телефона — вместе со входом через Apple: тогда появятся люди без Telegram |
| «Поддержать проект» (Tribute) | **В нативных приложениях не показываем**: App Store (3.1.1) отклоняет ссылки на донаты мимо своей оплаты, у Google Play похожее правило. Tribute остаётся в мини-аппе, боте и на сайте |
| Сторис и «Отправить в чат» | Только Telegram. В нативных — «Сохранить» и системное «Поделиться» |
| Проверка перед пушем | Хук гоняет нативные тесты, если в пуше есть правки `apple/`, `android/` или сервера. Пуш из облака проверяет GitHub Actions (macOS) |
| Старое приложение для Mac | `macos/` — оболочка с мини-аппом, живёт, пока Mac из `apple/` её не догонит. Своих фич туда не добавлять |

## Устройство

### iOS и Mac (`apple/`)

- **Проект Xcode — XcodeGen** (`apple/project.yml`). `.xcodeproj` генерируется (`xcodegen` в `apple/`) и в git не
  кладётся, поэтому параллельные правки не ломают проект при слиянии.
- **`LifeCommitKit`** — Swift-пакет без UI: модели (`Codable`, как `shared/types.ts`), клиент API, вход, ключ в
  Keychain, логика с `shared/` (логический день, уровни карты, статистика привычки, сортировка дел, иконка по
  названию). Тесты — Swift Testing, гоняются `swift test` без симулятора.
- **Приложение** `LifeCommit` — одна мультиплатформенная цель (iOS + macOS): SwiftUI, `@Observable`, Swift 6 со
  строгой проверкой потоков. Без сторонних зависимостей в приложении; в тестах — `swift-snapshot-testing`.
- **Bundle ID** — `app.lifecommit`. После публикации в App Store не меняется.
- **Команды** (из корня): `pnpm apple:open` — сгенерировать проект и открыть в Xcode; `pnpm apple:test` — вся проверка
  (`apple/scripts/test.sh`: `swift test` пакета, значки не разошлись с мини-аппом, снимки и сценарии XCUITest на
  симуляторе iPhone 17 Pro / iOS 26.5 против стенда на порту 5183, снимки Mac); `pnpm apple:icons` — пересобрать
  значки привычек из `src/components/KindIcon.tsx` (генератор `apple/scripts/icons.mjs`).
- **Запуск против стенда:** в Xcode → Edit Scheme → Arguments: `-LCAPIBase http://localhost:5173/api -LCDevUser <id>`
  (подменённый Telegram, только Debug). Без `-LCDevUser` — экран входа через Telegram (нужна настройка @BotFather,
  см. «Вход»).
- **Снимки экранов** (`apple/AppTests/ScreenSnapshotTests.swift`, эталоны — `apple/AppTests/__Snapshots__`): iPhone
  402×874 и окно Mac 420×860, светлая и тёмная. Сравнение попиксельное с допуском 0,1% площади. Переснять — только
  при намеренной правке вида: `LC_RECORD=1 pnpm apple:test`, и написать в коммите.
- **Сценарии** (`apple/AppUITests`): у каждого свой человек на стенде (`Stand.swift`, как фикстура `me`), проверка —
  на экране и в базе, без пауз (`eventually`). Правила вёрстки — `testLayoutRules`. Новый сценарий до коммита —
  `-test-iterations 3`.
- **Грабли.** Сборка для симулятора без подписи не пускает в Keychain (ошибка -34018): ключ входа в симуляторе
  сохраняется только в подписанной сборке (Xcode, Personal Team). `UserDefaults.integer` обрезает большие числа из
  аргументов запуска до 2 147 483 647 — id берём строкой. Подпись `accessibilityIdentifier` у составного вида
  достаётся всем детям — у карточек `.accessibilityElement(children: .contain)`.

### Android (`android/`)

Решения Android-сессии (05.10.2026):

- **Gradle**, Kotlin 2.4, AGP 9 (Kotlin встроен), compileSdk/targetSdk 37, **minSdk 29** (Android 10: у кого старее —
  мини-апп). Две части: **`core`** — чистый Kotlin без Android (модели `kotlinx.serialization` поле в поле как
  `shared/types.ts`, клиент API на OkHttp, вход Telegram, логика и тексты ru/en), тесты — JUnit на JVM с
  MockWebServer; **`app`** — Jetpack Compose.
- **Без DI-библиотеки**: зависимости собираются вручную (`MainViewModel`), модель экрана — `AppModel` (как
  `AppModel.swift`): состояние Compose, корутины `viewModelScope`.
- **Навигация** — Navigation 3 (`NavDisplay`, стек — список `Route`): системный «назад» и предиктивный жест; сверху —
  стеклянная плашка «‹ Назад», как кнопка Telegram над мини-аппом.
- **Ключ сессии** — Tink AEAD (AES-256-GCM), ключ шифрования в Android Keystore, шифротекст в DataStore.
  `allowBackup=false` и правила `data_extraction_rules.xml`: ключ не уезжает в копию и на другое устройство.
- **Вход**: есть Telegram (`org.telegram.messenger`) — `/crossapp`, иначе Custom Tab на `oauth.telegram.org/auth`.
  Возврат `lifecommit://tglogin` принимается, только пока ждём вход (`AppModel.handleCallback`), — ссылку извне без
  начатого входа приложение игнорирует.
- **Вид**: токены `src/styles/app.css` в `ui/Theme.kt`, шрифт Onest (переменный TTF, оси wght) в `sp` — растёт с
  размером шрифта системы. Размытия подложки (backdrop-filter) в Compose нет: стекло — заливка, кромка, тень;
  нижняя панель почти плотная, чтобы список под ней не читался. Значки привычек — `android/scripts/icons.mjs` из
  `src/components/KindIcon.tsx` (как `apple/scripts/icons.mjs`).
- **Подпись**: постоянный ключ `~/.android/lifecommit-upload.jks` (вне git), пароль — в Связке ключей macOS
  (служба `app.lifecommit.android.keystore`); SHA-256 `65:DA:AF:71:58:E8:3C:6C:99:43:EB:85:8C:00:AD:B8:C8:88:09:DC:95:55:76:78:68:37:43:14:CE:A2:FB:5B`
  — в `assetlinks.json` сайта и (позже) в @BotFather. Без ключа (облако) сборка подписывается отладочным.
- **Разработка**: `adb shell am start -n app.lifecommit/.MainActivity -e LCAPIBase http://10.0.2.2:5173/api --el LCDevUser <id>`
  — подменённый вход на локальном стенде, только сборка Debug (http разрешён только для 10.0.2.2/localhost в Debug).
- **Команды**: `pnpm android:test` (тесты `core` и `app`, сверка снимков), `pnpm android:record` (переснять снимки —
  только при намеренной правке вида), `pnpm android:build` (APK Debug), `pnpm android:icons`.

## Вход

### В проде: официальный вход Telegram

1. Приложение берёт `client_id`: `GET /api/auth/telegram/config` → `{ client_id }` (это id бота).
2. Приложение проходит `https://oauth.telegram.org` по PKCE (S256), без секрета — так работает официальный SDK
   (`TelegramMessenger/telegram-login-ios`, `…-android`, MIT). Сами шаги:
   - есть приложение Telegram: `GET https://oauth.telegram.org/crossapp?client_id=…&response_type=code&redirect_uri=…&scope=openid profile&code_challenge=…&code_challenge_method=S256`
     → `{ url }` → открыть его, Telegram вернёт в приложение `redirect_uri?code=…`;
   - Telegram нет: `ASWebAuthenticationSession` (Android — Custom Tab) на `https://oauth.telegram.org/auth?…` с теми
     же параметрами;
   - обмен: `POST https://oauth.telegram.org/token`, форма `client_id, code, grant_type=authorization_code, redirect_uri, code_verifier`
     → `{ id_token }`.
3. `POST /api/auth/telegram {id_token, device: 'ios'|'android'|'mac', language}` → `{ token, is_new }`.
   - Сервер (`worker/telegramLogin.ts`) проверяет подпись ключами `https://oauth.telegram.org/.well-known/jwks.json`
     (RS256 или ES256). Дальше проверяет `iss`, `aud` = id бота, срок жизни и что токену не больше 10 минут.
   - Пользователь берётся по `id` из токена (это id Telegram, тот же, что в initData). Если такого нет, он заводится
     из профиля Telegram, язык — `language` телефона (`ru…` → ru, иначе en).
   - Бот пишет человеку: «Вход в LifeCommit на iPhone / на Android / на Mac».
   - Один id_token — один вход: тот же токен второй раз — 409 `token_used` (войти заново).
   - Ошибки: 400 `bad_request` (не тот запрос, устройство не из списка); 401 `bad_token` (подпись, издатель,
     получатель, нет `id`); 401 `token_expired` (войти заново); 409 `token_used`; 502 `telegram_unreachable`
     (ключи Telegram не получить или незнакомый ключ сразу после промаха — повторить через минуту).
4. Дальше все запросы идут с заголовком `Authorization: Bearer <token>`.
   - Ключ хранить в Keychain (iOS/Mac) или в хранилище с ключом из Android Keystore (DataStore + Tink).
     `EncryptedSharedPreferences` устарело.
   - Первый запрос после входа и при каждом запуске — `POST /api/session {timezone}`, как у мини-аппа.
   - 401 с `bad_session` / `session_expired` / `no_session` → забыть ключ, экран входа. Любой другой 401 (например,
     `apple_auth` у календаря) — это ошибка дела, а не выход.
   - Выйти на этом устройстве: `DELETE /api/desktop/session`. Список устройств: `GET /api/desktop/sessions`
     (`device`: mac, web, ios, android).

**Адрес возврата и безопасность (ревью 05.10.2026).** Свою схему (`lifecommit://`) может объявить любое приложение на
телефоне или Mac. Приложение-подделка начнёт вход с нашим `client_id`, человек увидит в Telegram «LifeCommit» и
подтвердит — код уйдёт подделке, она обменяет его своим PKCE и получит наш ключ сессии (RFC 8252 §8.6; PKCE и nonce
от этого не спасают). Поэтому своя схема — **только пока приложение не раздаётся людям**; перед выпуском — только
https-адрес Telegram `https://app<id>-login.tg.dev` (universal link на iOS/Mac, проверенный App Link на Android:
Telegram привязывает его к Team ID / подписи пакета), а `lifecommit://tglogin` — убрать из Allowed URLs.

**Что нужно от владелицы** (без этого вход в проде не заработает):
- @BotFather → бот → **Login Widget**. В Allowed URLs добавить `lifecommit://tglogin`. Для iOS — Bundle ID
  `app.lifecommit` и Team ID (из Xcode → Settings → Accounts; у бесплатного Personal Team он тоже есть). Для Android —
  имя пакета и SHA-256 ключа подписи.
- С платным аккаунтом Apple вместо `lifecommit://tglogin` будет universal link `https://app<id>-login.tg.dev`
  (нужна возможность Associated Domains, её у Personal Team нет).

**Не проверено на живом аккаунте:** что `id` в id_token совпадает с id из initData (по документации — да) и что
Telegram принимает своё имя схемы в `redirect_uri` (SDK так делает на старых iOS).

### Удаление аккаунта

Сейчас `DELETE /api/account` с ключом устройства отвечает 403 `telegram_only` (решение для компьютеров: украденным
ключом аккаунт не удалить). **App Store (5.1.1(v)) и Google Play требуют удаления внутри приложения.** Решить на этапе
«Я». Предложение: телефон удаляет, только если в тот же запрос прислан свежий id_token Telegram (человек входит
заново).

### Для разработки и тестов: подменённый Telegram

Локальный стенд (`pnpm db:start`, `pnpm dev`; в `.dev.vars` стоит `DEV_AUTH_BYPASS=1`) принимает подделанную initData.
Заголовок `Authorization: tma <строка>`, строка — `URLSearchParams` из
`auth_date=<сейчас>&hash=mock-hash-not-valid-for-backend&signature=mock-signature&user={"id":N,"first_name":"…","language_code":"ru","username":"uN"}`.
У каждого UI-теста свой N (диапазон `9_000_000_000_000 + random`, как в `worker/test/harness.ts`). После теста — `DELETE /api/account`
этим же заголовком. В сборке для App Store / Play этой ветки нет: только `#if DEBUG` / `BuildConfig.DEBUG`, адрес —
не прод.

## Контракт API

Адрес — `https://lifecommit.app/api` (для разработки — `http://localhost:5173/api`, для тестов — порт стенда).
Ошибка всегда `{"error":"<код>"}` с HTTP-статусом. Не JSON в теле — 400 `bad_json`, падение сервера — 500
`internal`. Создание отвечает 201 `{id}` или `{ids}`, правки — `{ok:true}`. Типы — `shared/types.ts`, `shared/groups.ts`,
`shared/stats.ts`, `shared/summary.ts`, `src/api.ts`. Модели нативных клиентов повторяют их поле в поле.

Новый endpoint, поле или код ошибки добавляется сюда и в модели обоих нативных клиентов **в том же коммите** (`CLAUDE.md`).

### Сессия и профиль
| Метод и путь | Тело → ответ | Ошибки |
| --- | --- | --- |
| POST `/session` | `{timezone?}` → `{user: UserSettings, start_param, is_new}` | 401 `no_session` |
| PATCH `/settings` | частично `{language_code, timezone, day_start_hour 0–12, remind_morning, remind_evening ("HH:MM"\|null)}` → `UserSettings` | неверные поля молча пропускаются |
| DELETE `/account` | → `{ok}` | 403 `linked_account`, 403 `telegram_only` (ключ устройства, см. выше) |

### Привычки
| Метод и путь | Тело → ответ | Ошибки |
| --- | --- | --- |
| GET `/today` | → `TodayResponse` | |
| POST `/tasks` | `TaskInput` → 201 `{id}` | 400 `title_required` `bad_kind` `bad_target` `bad_schedule` `bad_visibility` `bad_date`; 402 `task_limit` (лимит сейчас выключен) |
| POST `/tasks/batch` | `{tasks: TaskInput[]}` (до 8) → 201 `{ids}` | + 400 `no_tasks` |
| PATCH `/tasks/:id` | `Partial<TaskInput>` → `{ok, goal_effective_from}` (цель стала меньше — действует с завтра) | 404, 400 как выше |
| POST `/tasks/:id/archive`, `/restore` | → `{ok}` | 404; restore — 402 `task_limit` |
| DELETE `/tasks/:id` | → `{ok}` (стирает и историю) | |
| PUT `/logs` | `{task_id, value?, status?: clean\|slip\|null, day?}` — `value` абсолютное; пусто — снять отметку | 404; 400 `bad_day` (будущее или старше 731 дня), `bad_status` |
| GET `/tasks/:id/history` | → `TaskHistory` (`start`, `goals`, `logs`); статистику считает клиент | 404 |
| GET `/heatmap?days=N` | N ≤ 371 → `{today, days: HeatDay[]}` | |
| GET `/summary?from&to` | до 366 дней → `SummaryItem[]` | 400 `bad_range` |

### Дела и календарь
| Метод и путь | Тело → ответ | Ошибки |
| --- | --- | --- |
| POST `/todos` | `TodoInput` → 201 `{id}` | 400 `title_required`, `bad_time` |
| POST `/todos/batch` | `{todos}` (до 12) → 201 `{ids}` | 400 `no_todos` |
| PATCH `/todos/:id` | `{title?, day?, time?, done?, on?, location?, hidden?}`; `on` — день у повторяющегося | 404; 400 `event_not_checkable` |
| DELETE `/todos/:id` | → `{ok}` (удаляет и событие в календаре) | |
| GET `/todos/later` | → `Todo[]` | |
| GET `/calendar?from&to` | до 62 дней → `{today, todos, groups: GroupDayBlock[]}`; повторы раскрыты сервером, **не отсортировано** (`sortTodos`) | 400 `bad_range` |
| GET `/calendars` | → `CalendarAccount[]` | |
| GET `/calendars/google/url?client=app` | → `{url}` — адрес входа Google; `client=app` метит state «вход из приложения» | 400 `bad_client` (любое другое значение `client`), 503 `calendar_unavailable` |
| POST `/calendars/google/finish` | `{pending}` → `{account_id, fresh}` — подключить Google кодом из возврата (ниже) | 400 `bad_pending`, 404 `pending_not_found`, 410 `pending_expired` |
| POST `/calendars/apple` | `{login, password}` → 201 | 400 `apple_bad_input`, 401 `apple_auth` (не выход!), 502, 503 |
| POST `/calendars/:id/confirm`; PATCH `/calendars/:id/collections` `{url, enabled}`; PATCH `/calendars/:id/default` `{url}`; DELETE `/calendars/:provider`; POST `/calendars/sync` | | 404, 400 `unknown_calendar`, `bad_provider` |

**Возврат после входа Google.** Приложение берёт адрес с `?client=app` и открывает его во внешнем окне входа
(iOS/Mac — `ASWebAuthenticationSession` со схемой `lifecommit`, Android — Custom Tab). Google возвращает браузер на
`/google/callback`; **календарь там не подключается**: сервер меняет код Google на токены и кладёт итог «в ожидание»
под одноразовым кодом (`google_pending`, живёт 15 минут). Для state с меткой app ответ — **302 на
`lifecommit://calendars?status=<итог>`**, при успехе — **`&pending=<код>`** (43 знака base64url):

| `status` | Что случилось | Что делать |
| --- | --- | --- |
| `ok` + `pending` | Google дал доступ | `POST /calendars/google/finish {pending}` своим ключом → `{account_id, fresh}`; `fresh: true` — шторка «Календари» с выбором календарей (`POST /calendars/:id/confirm`), `false` — подключён заново, перечитать дела |
| `denied` | отказ на экране Google или сняли галочку доступа к событиям | «Доступ не дали» |
| `expired` | ссылке больше 15 минут или аккаунта уже нет | «Ссылка устарела — нажмите «Подключить» ещё раз» |
| `failed` | Google или база не ответили (и `ok` без кода) | «Не получилось подключить, попробуйте позже» |

`POST /calendars/google/finish`: 400 `bad_pending` (не строка 43 знаков base64url), **404 `pending_not_found`** (чужой,
использованный или подобранный код — без подсказки, чей), 410 `pending_expired` (дольше 15 минут). Код одноразовый:
повтор — 404. Тексты итогов — как на странице возврата (`TEXT` в `worker/google.ts`) и `cal.googleLinkExpired`.

**Зачем ожидание (security-review 06.10.2026).** state подписан и привязан к человеку, но не к браузеру (cookie из
Telegram в браузер не переходят). Раньше чужая ссылка входа, которую жертва открыла и подтвердила на экране Google,
подключала её календарь к аккаунту автора ссылки. Теперь подключает только тот, кто начал вход, и только кодом, который
пришёл туда, где дали согласие: у автора чужой ссылки нет кода, у жертвы — его ключа. Ссылку `lifecommit://calendars`
может открыть кто угодно — приложение только перечитывает календари и шлёт код своим ключом, ничего не доверяя адресу.
На Android принимать её только пока ждём вход (как `tglogin`).

Метка app подписана вместе с id и сроком (`worker/secret.ts`, сравнение подписи — `crypto.subtle.verify`): приписать её
чужому state нельзя — такой state получает страницу 400 в браузере, а не переход в приложение. Без `client` — мини-апп:
страница «Почти готово» с кнопкой «Вернуться в LifeCommit» → `t.me/…?startapp=gcal_<код>`, мини-апп открывает
«Календари» и заканчивает подключение тем же `finish`. Тесты — `worker/google.int.test.ts`,
`worker/calsync.google.int.test.ts`, `worker/gcal.test.ts`, `src/components/CalendarsSheet.test.tsx`, `src/App.test.tsx`,
`e2e/calendar.spec.ts`.

### Группы
`GET /groups` → `GroupToday[]`; `POST /groups {title, kind?}`; `GET|PATCH|DELETE /groups/:id`; `POST /groups/:id/chat/check`;
`DELETE /groups/:id/chat`; `POST /groups/:id/leave`; `POST /groups/:id/invite` → `{code, link, expires_at}`;
`GET /invites/:code`, `POST /invites/:code/join`; `POST|PATCH|DELETE /groups/:id/items[/:item]`;
`POST /groups/:id/items/:item/skip {day}`; `PUT /groups/:id/items/:item/mark {done?, day?}` → `{ok, taken}`;
`POST /groups/:id/items/:item/entries {amount}`. Ошибки: 403 `forbidden` `admins_only` `not_yours`; 404; 410
`invite_expired`; 400 `no_title` `bad_mode` `bad_time` `bad_repeat` `bad_target` `no_target` `bad_day` `bad_amount`.
Кто делает сегодня (`for_me`, `can_mark`, `turn`, `done`) сервер присылает уже посчитанным.

### Друзья
`GET /friends` → `FriendsResponse`; `GET /friends/find?username=`; `GET /friends/link/:code` → `{person, status}`;
`POST /friends/requests {username}|{code}` → `{status: sent|friends}`; `POST /friends/requests/:id/accept`;
`DELETE /friends/requests/:id`; `DELETE /friends/:id`; `POST /friends/:id/block`; `GET /blocks`; `DELETE /blocks/:id`;
`PUT /friends/shown {task_ids}`; `POST /friends/prompted`; `GET /friends/:id` → `FriendProfile`.
Ошибки: 400 `bad_username` `self` `bad_tasks`; 409 `blocked`; 404.

### Голос, жалобы, картинки
- `POST /voice[?group=<id>]`: тело — сырое аудио (m4a/AAC на iOS годится — сервер берёт любой формат Whisper), больше 0 и не больше
  3 000 000 байт, запись от 0,8 до 90 с. Ответ 200 `application/x-ndjson`, по строке на событие: `{text}`, потом
  `{actions: VoiceAction[]}` или `{error: voice_limit|failed|too_long}`. 400 `no_audio`, 413 `too_long`, 429
  `voice_limit` (20 в день на человека). В базу ничего не пишется — потом `/tasks/batch`, `/todos/batch`,
  `POST /groups/:id/items`.
- `POST /feedback`: multipart — `text` (до 2000), `context` (JSON: `version, platform, lang, theme, viewport, tz, screen`), `files`
  (до 4 картинок по 5 МБ). 429 `feedback_limit` / `feedback_busy`. `POST /feedback/voice` — аудио → `{text}`.
- `POST /share` (JPEG/PNG, до 6 МБ → `{file_id, url}`) и `/share/chat` — только Telegram, в нативных не нужны.

### Только Telegram
`POST /desktop/approve` (подтвердить вход на компьютере — из мини-аппа), `POST /write-access`, `/share/chat`, сторис.

## Логика, которую повторяют клиенты

Сервер считает: логический день (`day`/`today` в ответах), раскрытие повторов, кто делает групповое дело сегодня,
итоги `/summary`. Клиент считает сам (переносить с тестами, теми же случаями, что в `shared/*.test.ts`):

| Что | Откуда |
| --- | --- |
| Уровень клетки карты 0–4 | `heatLevel` в `shared/types.ts` |
| Сегодняшняя клетка после отметки (без перезапроса карты) | `src/App.tsx` (`heatWithToday`) |
| Очки дела, «сделано», «N дней без» | `src/components/TaskCard.tsx` (`taskScore`, `isDone`, `cleanDaysOf`) |
| Статистика экрана привычки | `shared/stats.ts` (`targetOn`, `cleanRuns`, `lastDays`), `src/screens/TaskDetail.tsx` |
| Порядок дел | `sortTodos` в `shared/types.ts` |
| Иконка привычки по названию | `shared/habitIcon.ts` (словарь начал слов, ru/en) |
| Склонения | `plural` в `shared/groups.ts`, `src/i18n.ts` |
| Подписи повтора и дат дел | `src/repeat.ts`, `src/todoDates.ts` |
| Сетка месяца и года карты | `src/components/Heatmap.tsx` (`monthCells`, `yearStart`) |
| Цвета аватаров и групп по id | `src/components/groupUi.tsx` |

## Вид

- Токены: `src/styles/app.css` (светлая 8–62, тёмная 64–101, стекло 45–52 и 93–100, радиусы 20/14, цель нажатия
  48), плитки видов привычек — 218–229, нижняя панель — 307–322. Описание и компоненты — `DESIGN.md`.
- Шрифт Onest (OFL): в приложение кладётся файлом (TTF/OTF, переменный), с масштабированием под системный размер текста.
- Тексты ru/en — `src/i18n.ts`. Мини-апп — источник формулировок, нативные повторяют их дословно.
- Цифры пропорциональные, не моноширинные; разряды через пробел с 4 знаков (146, 1 146).

## Тесты нативных

| | iOS / Mac | Android |
| --- | --- | --- |
| Логика | Swift Testing в `LifeCommitKit` (`swift test`) | JUnit на JVM |
| Экраны | снимки `swift-snapshot-testing`: iPhone и Mac, светлая и тёмная; эталоны в git, переснимать только при намеренной правке вида | Roborazzi на JVM (Robolectric) |
| Сценарии | XCUITest против локального стенда, подменённый Telegram (см. «Вход») | Compose UI-тесты на Robolectric: всё приложение (`Root`) против подменённого сервера (`app/src/test/.../FakeServer.kt`), каждый тест — свой пользователь; эмулятор — ручная проверка |
| Отказы API | клиент на 400/401/403/404/409/410/429/5xx не молчит: экран возвращается как был и показывает ошибку | так же |

Правила вёрстки из `CLAUDE.md` действуют и здесь: ничего поверх нижней панели при любой прокрутке, ничего шире экрана,
последнее видно, список листается.
