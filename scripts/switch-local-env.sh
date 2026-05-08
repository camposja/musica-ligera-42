#!/bin/sh
set -e

mode="${1:-auto}"

detect_branch() {
  current="$(git branch --show-current 2>/dev/null || true)"
  if [ -n "$current" ]; then
    echo "$current"
    return
  fi
  git rev-parse --abbrev-ref HEAD
}

if [ "$mode" = "auto" ]; then
  branch="$(detect_branch)"
else
  branch="$mode"
fi

case "$branch" in
  postgres-version)
    new_url='postgresql://postgres:postgres@localhost:5433/music_app'
    label="Postgres"
    ;;
  *)
    new_url='file:./dev.db'
    label="SQLite"
    ;;
esac

if [ ! -f .env ]; then
  echo ".env missing — create it first."
  exit 1
fi

prev_url="$(
  awk -F= '
    /^DATABASE_URL=/ {
      value = substr($0, index($0, "=") + 1)
      gsub(/^"|"$/, "", value)
      print value
      exit
    }
  ' .env
)"

awk -v new_line="DATABASE_URL=\"$new_url\"" '
  /^DATABASE_URL=/ {
    print new_line
    replaced = 1
    next
  }
  { print }
  END {
    if (!replaced) print new_line
  }
' .env > .env.tmp
mv .env.tmp .env

echo "Switched .env to $label for branch: $branch"

if [ -n "${DATABASE_URL:-}" ]; then
  echo
  echo "Shell DATABASE_URL is set and overrides .env."
  echo "Run: unset DATABASE_URL"
fi

prev_provider=""
case "$prev_url" in
  postgresql://*) prev_provider="Postgres" ;;
  file:*) prev_provider="SQLite" ;;
esac

if [ -n "$prev_provider" ] && [ "$prev_provider" != "$label" ]; then
  echo
  echo "Provider changed — run:"
  echo "pnpm install && pnpm prisma generate"
fi
