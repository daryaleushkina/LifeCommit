#!/usr/bin/env bash
# Проверки платформенного слоя мини-аппа по исходникам. Запуск из корня проекта:
#   bash .claude/skills/telegram-mini-app/scripts/check.sh [src]
# Идея «проверять навык через rg» — по мотивам z-ts-telegram-mini-app
# (victorzhuk/skills, Apache-2.0); сами проверки свои.
# Код выхода 1 — есть нарушения из раздела «Ошибка». «Посмотреть глазами» не валит.
set -u
SRC="${1:-src}"
fail=0

section() { printf '\n== %s\n' "$1"; }
bad() { # $1 — описание, дальше — аргументы rg
  local title="$1"; shift
  local out
  # Файлы, скопированные из assets навыка, сами описывают запрещённое — их не судим
  out=$(rg -n --no-heading "$@" -g '!**/mockEnv.ts' -g '!**/telegram.css' "$SRC" 2>/dev/null)
  if [ -n "$out" ]; then
    printf '✗ %s\n%s\n' "$title" "$out"
    fail=1
  else
    printf '✓ %s\n' "$title"
  fi
}
look() {
  local title="$1"; shift
  local out
  out=$(rg -n --no-heading "$@" "$SRC" 2>/dev/null)
  [ -n "$out" ] && printf '… %s\n%s\n' "$title" "$out"
  return 0
}

section 'Ошибка'
bad 'hex-цвета мимо темы (подмена окружения — исключение)' \
  -g '*.{css,scss,ts,tsx}' --pcre2 -e '(?<![&\w])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b'
bad 'имена telegram-web-app.js: у @tma.js/sdk отступы зовутся --tg-viewport-*' \
  -e '--tg-(content-)?safe-area-inset-'
bad '--tg-color-scheme: @tma.js/sdk её не создаёт' -e '--tg-color-scheme'
bad 'env(safe-area-inset-*): в iOS-клиенте, по сообщениям, всегда 0' -e 'env\(safe-area-inset'
bad 'старый пакет @telegram-apps/sdk или скрипт telegram-web-app.js' \
  -e '@telegram-apps/sdk' -e 'telegram-web-app\.js'
bad 'window.Telegram.WebApp рядом с @tma.js/sdk — два источника правды' -e 'window\.Telegram'
bad 'mockTelegramEnv вне файла подмены' -e 'mockTelegramEnv\b'
bad 'ручной разбор location.hash: после навигации роутера параметров там нет' \
  -e 'location\.hash.*tgWebApp' -e 'tgWebAppData.*location'

section 'Посмотреть глазами'
look 'onClick без сохранённой отписки копит обработчики — проверить cleanup' \
  -e '(mainButton|secondaryButton|backButton|settingsButton)\.onClick'
look 'высота от 100vh/100dvh вместо --tg-viewport-stable-height' \
  -g '!**/telegram.css' -e '100d?vh'
look 'initData на клиенте — только для показа, права решает сервер' \
  -e 'initData\.(user|state)\(' -e 'initDataUnsafe'
look 'подтверждение закрытия — включается только при несохранённом' \
  -e 'enableConfirmation'
look 'отключение вертикальных свайпов — нужна причина в комментарии' \
  -e 'disableVertical'
look 'хаптика — на итог действия, не на каждое касание' \
  -e 'hapticFeedback\.'

exit $fail
