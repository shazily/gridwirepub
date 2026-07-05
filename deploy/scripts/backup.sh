#!/usr/bin/env bash
# Gridwire database backup — logical pg_dump snapshot with retention.
#
# Usage:
#   DATABASE_URL="postgresql://postgres:PW@HOST:5432/postgres" \
#     BACKUP_DIR=/var/backups/gridwire \
#     RETENTION_DAYS=14 \
#     ./deploy/scripts/backup.sh
#
# Exits non-zero on any failure so schedulers (cron/systemd/k8s) can alert.
set -Eeuo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the backend Postgres connection string}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gridwire}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%F_%H%M)"
out="$BACKUP_DIR/gridwire-$stamp.dump"

echo "[backup] dumping to $out"
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --file="$out"

# Sanity check: the dump must be listable and non-empty.
if ! pg_restore --list "$out" >/dev/null 2>&1; then
  echo "[backup] ERROR: dump failed validation ($out)" >&2
  rm -f "$out"
  exit 1
fi
if [ ! -s "$out" ]; then
  echo "[backup] ERROR: dump is empty ($out)" >&2
  exit 1
fi

size="$(du -h "$out" | cut -f1)"
echo "[backup] OK — $out ($size)"

# Prune old dumps.
echo "[backup] pruning dumps older than ${RETENTION_DAYS} day(s)"
find "$BACKUP_DIR" -name 'gridwire-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete || true

echo "[backup] done"
