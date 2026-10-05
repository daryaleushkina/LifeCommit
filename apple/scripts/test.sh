#!/bin/bash
# Проверка приложения для iPhone и Mac (apple/) — её же зовёт хук перед пушем, если в пуше есть правки apple/ или
# сервера (решение владелицы 05.10.2026). По порядку:
#   1. LifeCommitKit: логика, API, вход — `swift test` на Mac, без симулятора;
#   2. значки не разошлись с мини-аппом (apple/scripts/icons.mjs --check);
#   3. iPhone (симулятор iPhone 17 Pro, iOS 26.5): снимки экранов и сценарии XCUITest против локального стенда;
#   4. Mac: снимки экранов.
# Стенд — `pnpm dev` на APPLE_PORT (по умолчанию 5183) поверх локальной Supabase (`pnpm db:start`); уже запущен —
# используется он, нет — поднимается и гасится в конце. Переснять эталоны снимков: LC_RECORD=1 apple/scripts/test.sh —
# только при намеренной правке вида, и написать об этом в коммите.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd)
PORT=${APPLE_PORT:-5183}
API="http://localhost:$PORT/api"
LOG=$(mktemp -t lc-apple-stand)

step() { printf '\n▸ %s\n' "$1"; }

step "LifeCommitKit: swift test"
swift test --package-path Kit 2>&1 | tail -3

step "Значки совпадают с мини-аппом"
node scripts/icons.mjs --check

step "Проект Xcode"
xcodegen generate --quiet

# Симулятор: iPhone 17 Pro на iOS 26.x — под него сняты эталоны.
SIM=$(xcrun simctl list devices available -j | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
  const rt = Object.keys(d).filter((k) => /iOS-26/.test(k)).sort().pop();
  const dev = rt && d[rt].find((x) => x.name === "iPhone 17 Pro");
  if (!dev) { console.error("нет симулятора iPhone 17 Pro с iOS 26 (Xcode → Settings → Components)"); process.exit(1); }
  console.log(dev.udid);
')

STARTED=""
cleanup() {
  if [ -n "$STARTED" ]; then kill "$STARTED" 2>/dev/null || true; fi
  rm -f "$LOG"
}
trap cleanup EXIT

if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
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
  -destination "platform=iOS Simulator,id=$SIM" \
  -derivedDataPath build/test-ios CODE_SIGNING_ALLOWED=NO \
  -resultBundlePath "build/test-ios-$(date +%s).xcresult" 2>&1 | xcbeautify --quieter

step "Mac: снимки экранов"
TEST_RUNNER_LC_RECORD="${LC_RECORD:-}" xcodebuild test \
  -project LifeCommit.xcodeproj -scheme LifeCommitSnapshots \
  -destination "platform=macOS" \
  -derivedDataPath build/test-mac CODE_SIGNING_ALLOWED=NO 2>&1 | xcbeautify --quieter

if [ -n "${LC_RECORD:-}" ]; then
  step "Пережать новые эталоны без потерь"
  python3 scripts/pack-snapshots.py
fi

step "apple/: всё зелёное"
