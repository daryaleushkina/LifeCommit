#!/bin/bash
# Проверка приложения для iPhone и Mac (apple/) — её же зовёт хук перед пушем, если в пуше есть правки apple/ или
# сервера (решение владелицы 05.10.2026). По порядку:
#   1. LifeCommitKit: логика, API, вход — `swift test` на Mac, без симулятора;
#   2. значки не разошлись с мини-аппом (apple/scripts/icons.mjs --check);
#   3. iPhone (свой симулятор «LifeCommit iPhone 17 Pro iOS 26.x», гаснет после прогона): снимки экранов и сценарии
#      XCUITest против локального стенда;
#   4. Mac: снимки экранов.
# Стенд — `pnpm dev` на APPLE_PORT (по умолчанию 5183) поверх локальной Supabase (`pnpm db:start`); уже запущен —
# используется он, если поднят из этой же папки (стенд другой копии репозитория — нет: берётся следующий порт); нет —
# поднимается и гасится в конце. Переснять эталоны снимков: LC_RECORD=1 apple/scripts/test.sh —
# только при намеренной правке вида, и написать об этом в коммите. Новый экран — LC_RECORD=missing: снимаются только
# эталоны, которых ещё нет.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd -P)
PORT=${APPLE_PORT:-5183}
LOG=$(mktemp -t lc-apple-stand)

step() { printf '\n▸ %s\n' "$1"; }

step "LifeCommitKit: swift test"
swift test --package-path Kit 2>&1 | tail -3

step "Значки совпадают с мини-аппом"
node scripts/icons.mjs --check

step "id интерфейса — в общем файле shared/ui-ids.json"
node scripts/ui-ids.mjs --check

step "Проект Xcode"
xcodegen generate --quiet

# Симулятор — 3–4 ГБ, а мак общий для всех проектов и сессий (общее правило Дарьи, ~/.codex/AGENTS.md): телефонов, Android и iOS вместе,
# включено не больше пяти, и своё гасится сразу после прогона, при любом исходе. Свой у проекта, а не общий
# «iPhone 17 Pro»: тем пользуются другие проекты, и чужой прогон посреди нашего ломает оба. Модель и система — те, под
# которые сняты эталоны снимков (iPhone 17 Pro, iOS 26.x). Включённый не нами — не гасим.
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
SIM=""
SIM_OURS=""
# Замок и пометка — в общей папке .git, их видят все копии репозитория (worktree).
SHARED=$(git rev-parse --path-format=absolute --git-common-dir)
LOCK="$SHARED/lifecommit-apple-test.lock"
# Пометка «симулятор включил прогон»: прогон, убитый без уборки (kill -9), не оставит его включённым навсегда —
# следующий узнает его по пометке и погасит.
BOOTED_MARK="$SHARED/lifecommit-apple-test.booted"
LOCKED=""
STARTED=""
shutdown_sim() {
  if [ -n "$SIM_OURS" ]; then
    xcrun simctl shutdown "$SIM" 2>/dev/null || true
    rm -f "$BOOTED_MARK"
    SIM_OURS=""
  fi
}
cleanup() {
  shutdown_sim
  if [ -n "$STARTED" ]; then kill "$STARTED" 2>/dev/null || true; fi
  if [ -n "$LOCKED" ]; then rm -rf "$LOCK"; fi
  rm -f "$LOG"
}
# Сигнал — выход, выход — уборка (один раз). Ловить INT и TERM самим cleanup нельзя: bash после него продолжил бы
# скрипт дальше — уже без замка и симулятора.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

phones() {
  i=$(xcrun simctl list devices booted | grep -c '(Booted)' || true)
  a=$("$ADB" devices 2>/dev/null | grep -c '^emulator-' || true)
  echo $((i + a))
}

RUNTIME=$(xcrun simctl list runtimes available | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-26-[0-9-]+' | sort -V | tail -1)
if [ -z "$RUNTIME" ]; then echo "нет iOS 26 для симулятора (Xcode → Settings → Components)"; exit 1; fi
NAME="LifeCommit iPhone 17 Pro iOS $(echo "${RUNTIME#*iOS-}" | tr - .)"
SIM=$(xcrun simctl list devices available | grep -F "$NAME (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
if [ -z "$SIM" ]; then SIM=$(xcrun simctl create "$NAME" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro "$RUNTIME"); fi

# Один прогон за раз на все копии репозитория (рабочие деревья): симулятор у них общий, и два xcodebuild на нём ломают
# друг другу сценарии. Замок умершего прогона снимает следующий.
waited=0
until mkdir "$LOCK" 2>/dev/null; do
  owner=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then rm -rf "$LOCK"; continue; fi
  if [ $waited -ge 1800 ]; then echo "полчаса симулятором занят другой прогон (pid ${owner:-?})"; exit 1; fi
  if [ $((waited % 60)) -eq 0 ]; then echo "симулятором занят другой прогон (pid ${owner:-?}) — жду"; fi
  sleep 10
  waited=$((waited + 10))
done
LOCKED=1
echo $$ >"$LOCK/pid"

if xcrun simctl list devices booted | grep -q "$SIM"; then
  if [ -f "$BOOTED_MARK" ]; then
    echo "$NAME включил прошлый прогон и не успел погасить — погасим после сценариев iPhone"
    SIM_OURS=1
  else
    echo "$NAME уже включён не этим скриптом — пользуемся, но не гасим"
  fi
else
  waited=0
  while [ "$(phones)" -ge 5 ]; do
    if [ $waited -ge 900 ]; then
      echo "пятнадцать минут включено $(phones) телефонов из 5 — шестой не включаю. Включены:"
      xcrun simctl list devices booted | grep '(Booted)' || true
      "$ADB" devices 2>/dev/null | grep '^emulator-' || true
      exit 1
    fi
    if [ $((waited % 60)) -eq 0 ]; then echo "включено $(phones) телефонов из 5 — жду свободного места"; fi
    sleep 10
    waited=$((waited + 10))
  done
  SIM_OURS=1
  touch "$BOOTED_MARK"
  xcrun simctl boot "$SIM"
  xcrun simctl bootstatus "$SIM" -b >/dev/null
fi

# Стенд — только из этой папки. Порт может держать стенд соседней копии репозитория или забытый `pnpm dev`: проверять
# против него — значит проверять приложение этой ветки против чужого сервера. Такой порт пропускаем, берём следующий.
stand_dir() { # папка процесса, который слушает порт; пусто — порт свободен
  local pid dir
  pid=$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1) || true
  if [ -z "$pid" ]; then return 0; fi
  dir=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p') || true
  echo "${dir:-неизвестно чей (pid $pid)}"
}
owner_dir=""
for _ in $(seq 1 20); do
  owner_dir=$(stand_dir "$PORT")
  if [ -z "$owner_dir" ] || [ "$owner_dir" = "$ROOT" ]; then break; fi
  echo "порт $PORT держит стенд из $owner_dir — не этой папки, пробуем $((PORT + 1))"
  PORT=$((PORT + 1))
done
if [ -n "$owner_dir" ] && [ "$owner_dir" != "$ROOT" ]; then echo "нет свободного порта для стенда до $PORT"; exit 1; fi
API="http://localhost:$PORT/api"

if [ -z "$owner_dir" ]; then
  step "Стенд на порту $PORT"
  (cd "$ROOT" && exec pnpm dev --port "$PORT" --strictPort >"$LOG" 2>&1) &
  STARTED=$!
  for _ in $(seq 1 90); do
    curl -s -o /dev/null "http://localhost:$PORT/" && break
    if ! kill -0 "$STARTED" 2>/dev/null; then cat "$LOG"; echo "стенд не поднялся"; exit 1; fi
    sleep 1
  done
fi
# Стенд отвечает API, а не только страницей: без подписи — 401.
status=$(curl -s -o /dev/null -w '%{http_code}' "$API/today")
if [ "$status" != "401" ]; then echo "стенд на $API отвечает $status вместо 401"; exit 1; fi

step "iPhone: снимки экранов и сценарии (симулятор $SIM)"
TEST_RUNNER_LC_API_BASE="$API" TEST_RUNNER_LC_RECORD="${LC_RECORD:-}" xcodebuild test \
  -project LifeCommit.xcodeproj -scheme LifeCommit \
  -destination "platform=iOS Simulator,id=$SIM" -parallel-testing-enabled NO \
  -derivedDataPath build/test-ios CODE_SIGNING_ALLOWED=NO \
  -resultBundlePath "build/test-ios-$(date +%s).xcresult" 2>&1 | xcbeautify --quieter
# Симулятор больше не нужен — гасим сразу, а не после снимков Mac.
shutdown_sim

step "Mac: снимки экранов"
TEST_RUNNER_LC_RECORD="${LC_RECORD:-}" xcodebuild test \
  -project LifeCommit.xcodeproj -scheme LifeCommitSnapshots \
  -destination "platform=macOS" -parallel-testing-enabled NO \
  -derivedDataPath build/test-mac CODE_SIGNING_ALLOWED=NO 2>&1 | xcbeautify --quieter

if [ -n "${LC_RECORD:-}" ]; then
  step "Пережать новые эталоны без потерь"
  python3 scripts/pack-snapshots.py
fi

step "apple/: всё зелёное"
