---
description: Проход «по каждой кнопке» — ищет, где обработчики отменяют друг друга, ответы приходят не в том порядке и ошибки глотаются; сначала карта общего состояния, потом агенты lc-click-path по экранам параллельно, находки — только с падающим сценарием
argument-hint: "[all | экран | файл | state — после правки caches/useTodos/useTaskLog]"
---

Проведи аудит путей нажатий в LifeCommit (основа — click-path-audit из github.com/affaan-m/ecc). Аргументы: `$ARGUMENTS`.

Дорого: запускать перед релизом, после большого рефакторинга, после правки общего состояния или когда кнопка «ничего не делает».

## 1. Объём

- `all` (по умолчанию) — все части ниже.
- Экран или файл — только та часть, куда он входит.
- `state` — после правки `src/caches.ts`, `src/useTodos.ts`, `src/useTaskLog.ts`, `src/removal.tsx` или `src/telegram/hooks.ts`: найди всех, кто пользуется изменёнными функциями (`grep`), и проверь только эти экраны.

Части (сверь со `src/screens` и `src/components` — могли появиться новые):
1. **Сегодня** — `Today.tsx`, `TodoList.tsx`, `TaskCard.tsx`, `TodoSheet.tsx`, `SwipeRow.tsx`, `removal.tsx`.
2. **Привычка** — `TaskDetail.tsx`, `TaskEditor.tsx`, `Archive.tsx`, `Picker.tsx`.
3. **Календарь** — `Calendar.tsx`, `CalendarsSheet.tsx`.
4. **Вместе** — `Groups.tsx`, `Group.tsx`, `GroupBlocks.tsx`, `GroupItemSheet.tsx`, `groupUi.tsx`, `Friends.tsx`, `Join.tsx`.
5. **Я, голос и каркас** — `Profile.tsx`, `VoiceSheet.tsx`, `Onboarding.tsx`, `App.tsx` (маршруты, нижняя панель, `refresh`).

## 2. Карта общего состояния — сначала, сама

Построй её до запуска агентов (это общий вход для всех) и запиши в `e2e/_explore/click-path/map.md` (папка в `.gitignore`):

```
МОДУЛЬ: src/caches.ts
  load.range(from,to) → пишет caches.days[from:to]; перезапрашивает, если currentChange() сменился (до 4 раз)
  load.groupList()    → пишет caches.groupList; НЕ сверяет currentChange
  once(key)           → повторный вызов с тем же ключом получает тот же промис (inflight)
  warm(p)             → глотает ошибку
  ...
ОПАСНЫЕ МЕСТА: кто сбрасывает или затирает чужое состояние; кто глотает ошибки; какие ответы не сверяют currentChange
```

Пройди: `src/caches.ts`, `src/useTaskLog.ts`, `src/useTodos.ts`, `src/removal.tsx`, `src/telegram/hooks.ts`, состояние `src/App.tsx` (`route`, `cache`, `refresh`, `voiceOpen`, `voicePreview`, `groupRev`), ключи `localStorage`. Для каждого действия: что ставит, что сбрасывает попутно, сверяет ли `currentChange()`, что делает с ошибкой.

## 3. Стенд

Находки подтверждаются сценариями, поэтому стенд нужен:
1. `pnpm exec supabase status >/dev/null 2>&1 || pnpm db:start`.
2. `curl -sf http://localhost:5173 >/dev/null` — не отвечает: `pnpm dev --port 5173 --strictPort` в фоне, дождаться ответа. Агенты сервер не поднимают (порт один).

## 4. Агенты по частям — параллельно

Одним сообщением запусти агентов `lc-click-path` (`.claude/agents/lc-click-path.md`) — по одному на часть. Каждому: экраны и файлы части, путь к карте, префикс (`today`, `habit`, `calendar`, `groups`, `me`). Напомни: стенд поднят, писать только в `e2e/_explore/click-path/`, код не править.

## 5. Сведение

1. Склей одинаковые находки (одна причина в общем модуле — одна находка, со списком затронутых кнопок).
2. Каждую находку перепроверь сама: `E2E_EXPLORE=1 pnpm e2e <спек> --project=<проект> --retries=0 --output=e2e/_explore/out/check`. Не падает на симптоме — выкинь.
3. Покажи сводку: сколько точек пройдено, таблица подтверждённых находок (ID, важность, кнопка, шаблон, коротко), отдельно «не подтверждено» и что агенты дописали к карте.

## 6. Решение — кнопками

По каждой подтверждённой находке — AskUserQuestion, **по 4 вопроса за вызов**: «Чинить» / «Отложить» (строка в «Что дальше» HANDOFF) / «Не баг» (запишу в «Решения, которые нельзя терять»).

«Чинить» — по CLAUDE.md: сценарий переезжает из `e2e/_explore/click-path/` в настоящий `e2e/<раздел>.spec.ts` (или в dom-тест `src/**/*.test.tsx`, если так проще и точнее), убедиться, что падает, исправить, позеленеть. Причина в общем модуле — чинить там, а не в каждом экране. В конце — `pnpm typecheck && pnpm lint && pnpm coverage && pnpm e2e`.
