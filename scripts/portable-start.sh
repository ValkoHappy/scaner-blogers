#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

ENV_PATH="${1:-.env}"
NO_START="${NO_START:-}"

secret() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr '+/' '-_' | tr -d '='
  else
    LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c $((bytes * 2))
  fi
}

read_env_value() {
  local key="$1"
  local default_value="${2:-}"
  if [[ ! -f "$ENV_PATH" ]]; then
    printf "%s" "$default_value"
    return
  fi
  local line
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_PATH" | head -n 1 || true)"
  if [[ -z "$line" ]]; then
    printf "%s" "$default_value"
    return
  fi
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  printf "%s" "$line"
}

if [[ ! -f "$ENV_PATH" ]]; then
  AUTH_SECRET="$(secret 64)"
  ADMIN_PASSWORD="ScanerAdmin_$(secret 24)"

  cat >"$ENV_PATH" <<EOF
WEB_PORT=3200
DATABASE_URL=file:./data/scaner.db

AUTH_SECRET=$AUTH_SECRET
AUTH_COOKIE_SECURE=false
ADMIN_EMAIL=admin@scaner.local
ADMIN_PASSWORD=$ADMIN_PASSWORD

INSTAGRAM_USERNAME=
INSTAGRAM_PASSWORD=
INSTAGRAM_SESSION_FILE=.instagram/session.json
INSTAGRAM_PROXY_URL=

VK_ACCESS_TOKEN=
YOUTUBE_API_KEY=

COLLECTION_CRON=0 3 * * *
WORKER_CONCURRENCY=2
WORKER_POLL_INTERVAL_MS=15000
SOCIAL_KNOWN_PROFILE_SKIP_LIMIT=5000
SOCIAL_PLATFORM_CONCURRENCY_INSTAGRAM=1
SOCIAL_PLATFORM_CONCURRENCY_VK=1
SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE=1
NEXT_PUBLIC_APP_NAME=ScanerBlogers
EOF

  echo "Created $ENV_PATH"
  echo "Admin login: admin@scaner.local"
  echo "Admin password: $ADMIN_PASSWORD"
else
  echo "Using existing $ENV_PATH"
  echo "Admin login/password are in this env file: ADMIN_EMAIL and ADMIN_PASSWORD"
fi

WEB_PORT="$(read_env_value WEB_PORT 3200)"
if [[ -z "$WEB_PORT" ]]; then
  WEB_PORT="3200"
fi

if [[ "$NO_START" == "1" || "${2:-}" == "--no-start" ]]; then
  echo "No-start mode. Env file was prepared, Docker was not started."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker was not found. Install Docker Desktop or Docker Engine, start it, then run this script again." >&2
  exit 1
fi

docker compose --env-file "$ENV_PATH" up --build -d
docker compose --env-file "$ENV_PATH" ps

echo
echo "ScanerBlogers is starting."
echo "Open: http://127.0.0.1:$WEB_PORT"
echo "If the page is still loading, wait 20-60 seconds while migrations and the first start finish."
