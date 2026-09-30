# LifeCommit

Telegram Mini App ([@LifeCommit_bot](https://t.me/LifeCommit_bot)): ежедневные дела без стыда, тепловая карта активности как в GitHub и сообщество.

- Прод: https://lifecommit.daryaleushkina.workers.dev (открывать из Telegram)
- База: Supabase `lifecommit` (eu-central-1)

## Стек

| Часть | Что | Где |
| --- | --- | --- |
| Мини-апп | React + Vite + TypeScript + `@tma.js/sdk-react` | `src/` |
| Сервер | Cloudflare Worker на Hono: API, проверка подписи Telegram, webhook бота, cron напоминаний | `worker/` |
| База | Supabase Postgres (RLS закрыт для всех, доступ только у Worker'а по секретному ключу) | `supabase/migrations/` |
| Общие типы | TaskKind, TodayTask, heatLevel… | `shared/` |

Мини-апп никогда не ходит на `*.supabase.co` напрямую — только на свой Worker (защита от блокировок в РФ).

## Разработка

```bash
pnpm install
pnpm dev          # http://localhost:5173 — мини-апп + Worker, подменённый Telegram
pnpm typecheck
pnpm test         # vitest
pnpm check:tma    # проверки платформенного слоя Telegram
```

Локальные секреты — в `.dev.vars` (не в git):

```
TELEGRAM_BOT_TOKEN=...
SUPABASE_SECRET_KEY=...
TELEGRAM_WEBHOOK_SECRET=dev
DEV_AUTH_BYPASS=1        # принимать подделанную initData из src/telegram/mockEnv.ts
APP_URL=http://localhost:5173
```

⚠️ Локальная разработка работает с боевой базой. Тестовый пользователь из mockEnv — `id = 1`.

## Деплой

При пуше в `main` → Cloudflare (аккаунт darya.leushkina@gmail.com). С машины, где включён хук (`pnpm hooks:install`), деплой идёт локально перед пушем, а GitHub Actions его пропускает; без хука (облачная разработка) деплоит GitHub Actions. Подробнее — `docs/HANDOFF.md`. Вручную:

```bash
pnpm run deploy   # сборка + wrangler deploy
pnpm bot:setup    # webhook, кнопка меню, команды и описания бота (из .env.local)
```

Секреты Worker'а: `TELEGRAM_BOT_TOKEN`, `SUPABASE_SECRET_KEY`, `TELEGRAM_WEBHOOK_SECRET` (`wrangler secret put`).

## Этапы

- **v0.1** — личное ядро: дела 4 типов (Количество / Да или нет / Лимит / Отказ), цели с историей, тепловая карта (год и месяцы), «Отложить» дело, напоминания ← сейчас
- **v0.2** — друзья: профиль, подписки, видимость задач, реакции, «пнуть», «я сейчас делаю»
- **v0.3** — команды, бот в групповом чате, челленджи
- **v0.4** — парные квесты, сторис, фото

## Дизайн

Стиль A «Мягкий» (своя палитра, светлая и тёмная; шрифт Onest). Правило экрана: одно главное действие, 3–4 блока, без легенд и пояснений. Макеты: https://claude.ai/artifact/EM9KRiZmFLTKJh46dSHr1f (круг 3 — актуальный).
Поддержка проекта — страница донатов в Tribute (`SUPPORT_URL` в `src/screens/Profile.tsx`).
