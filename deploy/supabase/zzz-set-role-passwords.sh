#!/bin/bash
# Runs after supabase/postgres migrate.sh — sets login passwords for internal roles.
set -euo pipefail

export PGPASSWORD="${POSTGRES_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username supabase_admin --dbname "${POSTGRES_DB:-postgres}" <<-EOSQL
  ALTER USER supabase_auth_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER USER supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER USER authenticator WITH PASSWORD '${POSTGRES_PASSWORD}';
EOSQL
