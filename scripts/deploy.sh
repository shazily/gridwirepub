#!/usr/bin/env bash
# Gridwire touchless deploy — Linux / CI parity.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CMD="${1:-up}"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-0}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"

if [[ -f .env ]] && grep -q '^GRIDWIRE_DEPLOYMENT=onprem' .env 2>/dev/null; then
  COMPOSE_FILES=(-f docker-compose.onprem.yml)
else
  COMPOSE_FILES=(-f docker-compose.yml)
  if [[ "${GRIDWIRE_INCLUDE_BACKEND:-0}" == "1" && -f docker-compose.backend.yml ]]; then
    COMPOSE_FILES+=(-f docker-compose.backend.yml)
  fi
fi

if [[ ! -f .env ]]; then
  echo "No .env — running on-prem bootstrap..."
  ./scripts/bootstrap-onprem.sh
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

HOST_PORT="${GRIDWIRE_HOST_PORT:-3020}"

case "$CMD" in
  bootstrap)
    ./scripts/bootstrap-onprem.sh "${2:-}"
    ;;
  migrate)
    if grep -q '^GRIDWIRE_DEPLOYMENT=onprem' .env; then
      docker compose "${COMPOSE_FILES[@]}" up -d db auth rest kong --wait
    fi
    ./scripts/apply-migrations.sh
    ;;
  down)
    docker compose "${COMPOSE_FILES[@]}" down
    ;;
  status)
    docker compose "${COMPOSE_FILES[@]}" ps
    PORTAL_URL="http://127.0.0.1:${HOST_PORT}" ./scripts/smoke-test.sh
    ;;
  smoke)
    PORTAL_URL="http://127.0.0.1:${HOST_PORT}" ./scripts/smoke-test.sh
    ;;
  up)
    if ! grep -q '^GRIDWIRE_DEPLOYMENT=onprem' .env 2>/dev/null; then
      echo "WARN: not on-prem .env — run ./scripts/bootstrap-onprem.sh"
    fi
    if [[ "$SKIP_MIGRATIONS" != "1" ]] && grep -q '^GRIDWIRE_DEPLOYMENT=onprem' .env; then
      docker compose "${COMPOSE_FILES[@]}" up -d db auth rest kong --wait
      ./scripts/apply-migrations.sh
    elif [[ "$SKIP_MIGRATIONS" != "1" ]] && [[ -n "${DATABASE_URL:-}" || -n "${PGHOST:-}" ]]; then
      ./scripts/apply-migrations.sh || echo "WARN migrations failed"
    fi
    if git rev-parse --short HEAD >/dev/null 2>&1; then
      export GRIDWIRE_IMAGE_TAG="git-$(git rev-parse --short HEAD)"
      echo "GRIDWIRE_IMAGE_TAG=$GRIDWIRE_IMAGE_TAG" > .deploy-state
    fi
    if grep -q '^GRIDWIRE_DEPLOYMENT=onprem' .env; then
      docker compose "${COMPOSE_FILES[@]}" up -d --build portal worker --wait
    else
      docker compose "${COMPOSE_FILES[@]}" up -d --build --wait
    fi
    if [[ "$SKIP_SMOKE" != "1" ]]; then
      PORTAL_URL="http://127.0.0.1:${HOST_PORT}" ./scripts/smoke-test.sh
    fi
    echo "Deploy complete. Portal: http://127.0.0.1:${HOST_PORT}"
    ;;
  *)
    echo "Usage: $0 {up|down|status|smoke|migrate|bootstrap}"
    exit 1
    ;;
esac
