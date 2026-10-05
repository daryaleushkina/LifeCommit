#!/bin/sh
# Нужна ли перед пушем проверка приложения для iPhone и Mac: в пуше есть apple/ или сервер, с которым оно говорит
# (worker/, shared/, supabase/). Зовёт хук pre-push: apple-changed.sh <sha на сервере> <пушим>. Код выхода 0 — нужна.
# Сервера ещё нет (новая ветка) или его коммита нет локально — проверяем: не знаем, что изменилось.
remote_sha="$1"
sha="$2"
case "$remote_sha" in
  "" | 0000000000000000000000000000000000000000) exit 0 ;;
esac
git cat-file -e "$remote_sha^{commit}" 2>/dev/null || exit 0
[ -n "$(git diff --name-only "$remote_sha" "$sha" -- apple worker shared supabase)" ]
