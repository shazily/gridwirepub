#!/usr/bin/env bash
# Post-deploy smoke tests — must catch broken UI, not just /health.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${GRIDWIRE_HOST_PORT:-3020}"
PORTAL_URL="${PORTAL_URL:-http://127.0.0.1:${PORT}}"

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

failed=0

fail() { echo "FAIL $1 — $2"; failed=$((failed + 1)); }
ok() { echo "OK   $1"; }

echo "Smoke tests against $PORTAL_URL"
echo ""

code="$(curl -sS -o /tmp/gw-health.json -w "%{http_code}" "$PORTAL_URL/api/public/health" || echo 000)"
if [[ "$code" == "200" ]] && grep -q '"status":"ok"' /tmp/gw-health.json; then ok "Liveness /api/public/health"; else fail "Liveness" "HTTP $code"; fi

code="$(curl -sS -o /tmp/gw-ready.json -w "%{http_code}" "$PORTAL_URL/api/public/ready" || echo 000)"
if [[ "$code" == "200" ]] && grep -q '"status":"ready"' /tmp/gw-ready.json; then
  ok "Readiness /api/public/ready"
else
  fail "Readiness" "HTTP $code $(cat /tmp/gw-ready.json 2>/dev/null || true)"
fi

body="$(curl -sS "$PORTAL_URL/" || true)"
if echo "$body" | grep -q "This page didn't load"; then
  fail "Homepage SSR" "error boundary HTML"
elif ! echo "$body" | grep -qi spreadsheet; then
  fail "Homepage SSR" "missing landing content"
else
  ok "Homepage / (SSR landing page)"
fi

code="$(curl -sS -o /dev/null -w "%{http_code}" "$PORTAL_URL/api/public/metrics" || echo 000)"
if [[ "$code" == "401" ]]; then ok "Metrics unauthenticated"; else fail "Metrics unauthenticated" "HTTP $code"; fi

if [[ -n "${METRICS_TOKEN:-}" ]]; then
  code="$(curl -sS -o /tmp/gw-metrics.txt -w "%{http_code}" -H "Authorization: Bearer ${METRICS_TOKEN}" "$PORTAL_URL/api/public/metrics" || echo 000)"
  if [[ "$code" == "200" ]] && grep -q gridwire_portal_up /tmp/gw-metrics.txt; then ok "Metrics authenticated"; else fail "Metrics authenticated" "HTTP $code"; fi
else
  fail "Metrics authenticated" "METRICS_TOKEN not set"
fi

if docker compose -f "${ROOT}/docker-compose.yml" logs portal --tail 40 2>&1 | grep -q "Missing Supabase environment variable"; then
  fail "Portal logs" "Supabase env errors"
else
  ok "Portal logs clean"
fi

echo ""
if [[ $failed -gt 0 ]]; then
  echo "Smoke tests FAILED ($failed failures)"
  exit 1
fi
echo "Smoke tests passed"
exit 0
