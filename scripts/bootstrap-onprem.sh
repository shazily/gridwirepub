#!/usr/bin/env bash
# Bootstrap a complete on-prem Gridwire .env (no cloud services).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
FORCE="${1:-}"

if [[ -f "$ENV_FILE" && "$FORCE" != "--force" ]]; then
  if grep -q '^GRIDWIRE_DEPLOYMENT=onprem' "$ENV_FILE" 2>/dev/null; then
    echo ".env already configured for on-prem. Pass --force to regenerate."
    exit 0
  fi
  cp "$ENV_FILE" "$ROOT/.env.cloud-backup"
  echo "Backed up existing .env to .env.cloud-backup"
fi

HOST_PORT=3020
API_PORT=3040
DB_PORT=54332
SITE_URL="http://127.0.0.1:${HOST_PORT}"
API_EXTERNAL="http://127.0.0.1:${API_PORT}"

hex() { openssl rand -hex "${1:-32}"; }
pass() { openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 32; }

POSTGRES_PASSWORD="$(pass)"
JWT_SECRET="$(hex 48)"
FIELD_KEY="$(hex 32)"
WORKER_TOKEN="$(hex 32)"
METRICS_TOKEN="$(hex 32)"

KEYS_JSON="$(node "$ROOT/scripts/generate-supabase-jwt-keys.mjs" "$JWT_SECRET")"
ANON_KEY="$(echo "$KEYS_JSON" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).anon_key))")"
SERVICE_KEY="$(echo "$KEYS_JSON" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).service_role_key))")"
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${DB_PORT}/postgres"

cat >"$ENV_FILE" <<EOF
GRIDWIRE_DEPLOYMENT=onprem
DEPLOYMENT_MODE=onprem

SUPABASE_URL=http://kong:8000
VITE_SUPABASE_URL=${API_EXTERNAL}
API_EXTERNAL_URL=${API_EXTERNAL}
SITE_URL=${SITE_URL}
PUBLIC_APP_URL=${SITE_URL}

SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
VITE_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}

POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
DATABASE_URL=${DATABASE_URL}

FIELD_ENCRYPTION_KEY=${FIELD_KEY}
WORKER_INGEST_TOKEN=${WORKER_TOKEN}
METRICS_TOKEN=${METRICS_TOKEN}

GRIDWIRE_HOST_PORT=${HOST_PORT}
GRIDWIRE_API_PORT=${API_PORT}
GRIDWIRE_DB_PORT=${DB_PORT}

GOTRUE_MAILER_AUTOCONFIRM=true
POLL_CRON=*/5 * * * *
SFTP_SECRETS={}

API_RATE_LIMIT_PER_MIN=60
API_RATE_LIMIT_BURST=20

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=alerts@gridwire.local
SMTP_SECURE=false
EOF

echo ""
echo "Created on-prem .env at $ENV_FILE"
echo "  Portal:  $SITE_URL"
echo "  API:     $API_EXTERNAL"
echo "Next: ./scripts/deploy.sh up"
