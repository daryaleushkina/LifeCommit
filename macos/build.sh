#!/usr/bin/env bash
# Собирает LifeCommit.app — приложение для Mac (Swift + WKWebView с мини-аппом lifecommit.app, вход через Telegram).
#   pnpm mac:build    — собрать в macos/build/LifeCommit.app
#   pnpm mac:install  — собрать и положить в /Applications (старая версия заменяется; закройте приложение перед этим)
# Подпись — своя для этого Мака (ad-hoc): сертификата разработчика Apple нет. Поэтому приложение запускается на этом
# Маке без вопросов, а после каждой пересборки macOS ещё раз спросит доступ к микрофону. Раздавать другим людям —
# только с Developer ID и нотаризацией.
set -euo pipefail
cd "$(dirname "$0")"

# Сначала тесты логики оболочки (macos/Tests): красное — приложение не собирается.
swift test
swift build -c release
APP=build/LifeCommit.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/LifeCommit "$APP/Contents/MacOS/LifeCommit"
sed "s/__BUILD__/$(git rev-list --count HEAD)/" Resources/Info.plist > "$APP/Contents/Info.plist"
cp -R Resources/ru.lproj Resources/en.lproj "$APP/Contents/Resources/"

# Значок: macos/icon/AppIcon.png (1024) → все размеры → AppIcon.icns.
iconset="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$iconset"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" icon/AppIcon.png --out "$iconset/icon_${s}x${s}.png" >/dev/null
  sips -z "$((s * 2))" "$((s * 2))" icon/AppIcon.png --out "$iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$APP/Contents/Resources/AppIcon.icns"

codesign --force --sign - --identifier app.lifecommit.mac "$APP"
codesign --verify --strict "$APP"
echo "Собрано: macos/$APP"

if [[ "${1:-}" == "--install" ]]; then
  if pgrep -xq LifeCommit; then
    echo "LifeCommit запущен — закройте его (⌘Q) и повторите." >&2
    exit 1
  fi
  rm -rf /Applications/LifeCommit.app
  cp -R "$APP" /Applications/LifeCommit.app
  echo "Установлено: /Applications/LifeCommit.app"
fi
