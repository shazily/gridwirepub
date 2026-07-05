#!/usr/bin/env bash
# Gridwire database restore from a pg_dump custom-format snapshot.
#
# Usage:
#   DATABASE_URL="postgresql://postgres:PW@HOST:5432/postgres" \
#     ./deploy/scripts/restore.sh /path/to/gridwire-YYYY-MM-DD_HHMM.dump
#
# WARNING: --clean --if-exists DROPS existing objects in the target database
# before recreating them. Stop the portal/worker first, and make sure
# FIELD_ENCRYPTION_KEY matches the value in use when the dump was taken, or
# encrypted field values will be unreadable.
set -Eeuo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the target Postgres connection string}"
dump="${1:?Usage: restore.sh <dump-file>}"

if [ ! -f "$dump" ]; then
  echo "[restore] ERROR: dump not found: $dump" >&2
  exit 1
fi

echo "[restore] validating $dump"
pg_restore --list "$dump" >/dev/null

echo "[restore] restoring into target database (this is destructive)"
pg_restore \
  --clean --if-exists \
  --no-owner --no-privileges \
  --dbname="$DATABASE_URL" \
  "$dump"

echo "[restore] done — verify with: psql \"\$DATABASE_URL\" -c 'select count(*) from public.datasets;'"
echo "[restore] reminder: ensure FIELD_ENCRYPTION_KEY matches the dump, then start services."
