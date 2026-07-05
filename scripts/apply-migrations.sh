#!/usr/bin/env bash
# Idempotent Gridwire SQL migrations — skips files already in schema_migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${ROOT}/supabase/migrations"

if [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)
else
  : "${PGHOST:?Set DATABASE_URL or PGHOST}"
  : "${PGUSER:?Set DATABASE_URL or PGUSER}"
  : "${PGDATABASE:?Set DATABASE_URL or PGDATABASE}"
  PSQL=(psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1)
fi

psql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "Migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

shopt -s nullglob
mapfile -t files < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort)

BOOTSTRAP="${MIGRATIONS_DIR}/00000000000000_schema_migrations.sql"
if [[ -f "$BOOTSTRAP" ]]; then
  "${PSQL[@]}" -f "$BOOTSTRAP" >/dev/null 2>&1 || true
fi

applied=0
skipped=0

for name in "${files[@]}"; do
  f="${MIGRATIONS_DIR}/${name}"
  esc="$(psql_escape "$name")"
  exists="$("${PSQL[@]}" -tAc "SELECT 1 FROM public.gridwire_schema_migrations WHERE filename = '$esc' LIMIT 1" 2>/dev/null || echo "")"
  if [[ "$(echo "$exists" | tr -d '[:space:]')" == "1" ]]; then
    echo "Skip (already applied): $name"
    skipped=$((skipped + 1))
    continue
  fi
  echo "Applying $name..."
  "${PSQL[@]}" -f "$f"
  "${PSQL[@]}" -c "INSERT INTO public.gridwire_schema_migrations (filename) VALUES ('$esc') ON CONFLICT (filename) DO NOTHING;"
  applied=$((applied + 1))
done

echo "Migrations complete. Applied: $applied, skipped: $skipped."

assert_psql_true() {
  local label="$1" sql="$2"
  local result
  result="$("${PSQL[@]}" -tAc "$sql" | tr -d '[:space:]')"
  if [[ "$result" != "t" ]]; then
    echo "Migration security check failed: $label (got '$result')"
    exit 1
  fi
  echo "OK   $label"
}

echo "Verifying migration security invariants..."
assert_psql_true "is_org_member EXECUTE for authenticated (RLS)" \
  "SELECT has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'EXECUTE');"
assert_psql_true "has_org_role EXECUTE for authenticated (RLS)" \
  "SELECT has_function_privilege('authenticated', 'public.has_org_role(uuid,public.app_org_role[])', 'EXECUTE');"
assert_psql_true "org_members UPDATE revoked from authenticated" \
  "SELECT NOT has_table_privilege('authenticated', 'public.org_members', 'UPDATE');"
assert_psql_true "update_org_member_role callable by authenticated" \
  "SELECT has_function_privilege('authenticated', 'public.update_org_member_role(uuid,public.app_org_role)', 'EXECUTE');"
echo "Migration security invariants passed."
