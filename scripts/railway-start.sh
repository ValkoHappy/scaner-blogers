#!/bin/sh
set -eu

cleanup() {
  if [ -n "${WORKER_PID:-}" ]; then
    kill "$WORKER_PID" 2>/dev/null || true
    wait "$WORKER_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

npm run prisma:generate
npm run prisma:migrate:deploy

npm --workspace apps/worker run start &
WORKER_PID="$!"

npm --workspace apps/web run start -- -p "${PORT:-3000}"
