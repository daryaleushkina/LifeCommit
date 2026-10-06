#!/bin/bash
# Проверка приложения для iPhone и Mac (apple/) — её же зовёт хук перед пушем, если в пуше есть правки apple/ или
# сервера (решение владелицы 05.10.2026). По порядку:
#   1. LifeCommitKit: логика, API, вход — `swift test` на Mac, без симулятора;
#   2. значки не разошлись с мини-аппом (apple/scripts/icons.mjs --check);
#   3. iPhone (свой симулятор «LifeCommit iPhone 17 Pro», iOS 26.x): снимки и сценарии XCUITest на локальном стенде;
#   4. Mac: снимки экранов.
# Стенд — `pnpm dev` на APPLE_PORT (5183) поверх локальной Supabase (`pnpm db:start`); уже запущен из этой папки —
# используется он, нет — поднимается и гасится в конце. Переснять эталоны снимков: LC_RECORD=1 apple/scripts/test.sh —
# только при намеренной правке вида, и написать об этом в коммите.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd -P)
PORT=${APPLE_PORT:-5183}
LOG=$(mktemp -t lc-apple-stand)
# Общая папка .git всех копий репозитория (worktree): замок и пометка симулятора должны быть видны из любой копии.
SHARED=$(git rev-parse --path-format=absolute --git-common-dir)
LOCK="$SHARED/lc-apple-test.lock"
BOOTED_MARK="$SHARED/lc-apple-test.booted"

step() { printf '\n▸ %s\n' "$1"; }

STARTED=""
SIM=""
SIM_OURS=""
LOCKED=""
# Симулятор гасим, только если его включил этот скрипт: включённый до нас — чей-то (человек в Xcode), и его работу
# не обрываем. Пометка в .git — чтобы прогон, убитый без уборки (kill -9), не оставил симулятор включённым навсегда:
# следующий узнает его по пометке и погасит.
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
# EXIT срабатывает и при ошибке (set -e), и при Ctrl-C или kill: симулятор — 2–4 ГБ из 36 общих на все проекты Мака.
trap cleanup EXIT

step "LifeCommitKit: swift test"
swift test --package-path Kit 2>&1 | tail -3

step "Значки совпадают с мини-аппом"
node scripts/icons.mjs --check

step "Проект Xcode"
xcodegen generate --quiet

# Дальше — по одному прогону на Мак: симулятор проекта один на все копии репозитория, и два xcodebuild на одном
# симуляторе ломают друг другу сценарии — красное будет не от кода. mkdir атомарен; хозяин замка записан в pid, и замок
# прогона, убитого без уборки, следующий снимает сам.
waited=0
until mkdir "$LOCK" 2>/dev/null; do
  owner=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$owner" ] && ! ps -p "$owner" >/dev/null 2>&1; then rm -rf "$LOCK"; continue; fi
  if [ "$waited" -ge 1800 ]; then
    echo "полчаса симулятором проекта занят другой прогон (pid ${owner:-?}; замок $LOCK) — не дождались"
    exit 1
  fi
  if [ $((waited % 60)) -eq 0 ]; then echo "ждём: симулятором проекта занят другой прогон (pid ${owner:-?})…"; fi
  sleep 10
  waited=$((waited + 10))
done
LOCKED=1
echo $$ >"$LOCK/pid"

# Стенд — только из этой папки. Порт может держать стенд соседней копии репозитория или забытый `pnpm dev`: проверять
# против него — значит проверять приложение этой ветки против чужого сервера, и зелёный прогон ничего не значит. Такой
# порт пропускаем и берём следующий.
stand_dir() { # папка процесса, который слушает порт; пусто — порт свободен
  local pid dir
  pid=$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1) || true
  if [ -z "$pid" ]; then return 0; fi
  dir=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p') || true
  echo "${dir:-неизвестно чей (pid $pid)}"
}
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

# Свой симулятор, а не стандартный «iPhone 17 Pro»: тем пользуются и другие проекты на этом Маке, и чужой прогон посреди
# нашего (или наш посреди чужого) ломает оба. Модель и система — те, под которые сняты эталоны: iPhone 17 Pro, последняя
# iOS 26.x. Нет его — создаём; созданный не включён и памяти не занимает.
RUNTIME=$(xcrun simctl list runtimes available -j | node -e '
  const rt = JSON.parse(require("fs").readFileSync(0, "utf8")).runtimes
    .filter((r) => r.platform === "iOS" && /^26\./.test(r.version))
    .sort((a, b) => a.version.localeCompare(b.version, "en", { numeric: true }))
    .pop();
  if (!rt) { console.error("нет iOS 26 для симулятора (Xcode → Settings → Components)"); process.exit(1); }
  console.log(rt.identifier, rt.version);
')
RUNTIME_ID=${RUNTIME% *}
SIM_NAME="LifeCommit iPhone 17 Pro iOS ${RUNTIME#* }"
SIM=$(xcrun simctl list devices available -j | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices[process.argv[1]] ?? [];
  console.log(d.find((x) => x.name === process.argv[2])?.udid ?? "");
' "$RUNTIME_ID" "$SIM_NAME")
if [ -z "$SIM" ]; then
  step "Создаём симулятор проекта: $SIM_NAME"
  SIM=$(xcrun simctl create "$SIM_NAME" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro "$RUNTIME_ID")
fi

# Не больше пяти включённых телефонов на весь Мак — Android и iOS вместе, все проекты (правило ~/.claude/CLAUDE.md):
# каждый — 2–4 ГБ из 36. Свободного места ждём, а не включаем шестой; 15 минут без места — значит, что-то брошено, и
# разбираться человеку.
phones_on() {
  local ios android=0
  ios=$(xcrun simctl list devices booted | grep -c '(Booted)') || true
  if command -v adb >/dev/null 2>&1; then android=$(adb devices 2>/dev/null | grep -c '^emulator-') || true; fi
  echo $((ios + android))
}
if xcrun simctl list devices booted | grep -q "$SIM"; then
  if [ -f "$BOOTED_MARK" ]; then
    echo "$SIM_NAME включил прошлый прогон и не успел погасить — погасим в конце"
    SIM_OURS=1
  else
    echo "$SIM_NAME уже включён не этим скриптом — пользуемся, но не гасим"
  fi
else
  waited=0
  while [ "$(phones_on)" -ge 5 ]; do
    if [ "$waited" -ge 900 ]; then
      echo "15 минут на Маке включено 5 и больше симуляторов и эмуляторов — шестой не включаем:"
      xcrun simctl list devices booted | grep '(Booted)' || true
      if command -v adb >/dev/null 2>&1; then adb devices | grep '^emulator-' || true; fi
      echo "Погасить свои (xcrun simctl shutdown <udid>, adb -s <serial> emu kill) и повторить; чужие не трогать."
      exit 1
    fi
    if [ $((waited % 60)) -eq 0 ]; then echo "включено $(phones_on) телефонов из 5 — ждём свободного места…"; fi
    sleep 10
    waited=$((waited + 10))
  done
  SIM_OURS=1
  touch "$BOOTED_MARK"
  xcrun simctl bootstatus "$SIM" -b >/dev/null
fi

# Без параллельных прогонов: иначе Xcode клонирует симулятор, и каждый клон — ещё 2–4 ГБ.
step "iPhone: снимки экранов и сценарии ($SIM_NAME, $SIM)"
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
