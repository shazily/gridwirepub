#!/usr/bin/env bash
# Post-migration security checks — RPC revoke, org_members UPDATE revoke.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"

fail=0

check_false() {
  local label="$1" sql="$2"
  local result
  result="$(psql "$DATABASE_URL" -tAc "$sql" | tr -d '[:space:]')"
  if [[ "$result" != "f" && "$result" != "false" ]]; then
    echo "FAIL $label — expected no privilege, got: $result"
    fail=$((fail + 1))
  else
    echo "OK   $label"
  fi
}

# RLS policies invoke these helpers as authenticated — EXECUTE must be granted.
check_true() {
  local label="$1" sql="$2"
  local result
  result="$(psql "$DATABASE_URL" -tAc "$sql" | tr -d '[:space:]')"
  if [[ "$result" != "t" && "$result" != "true" ]]; then
    echo "FAIL $label — expected privilege, got: $result"
    fail=$((fail + 1))
  else
    echo "OK   $label"
  fi
}

check_false "log_audit_event revoked" \
  "SELECT has_function_privilege('authenticated', 'public.log_audit_event(uuid,text,text,text,uuid,jsonb)', 'EXECUTE');"

check_false "invite_member_by_email revoked" \
  "SELECT has_function_privilege('authenticated', 'public.invite_member_by_email(uuid,text,public.app_org_role)', 'EXECUTE');"

check_true "is_org_member granted for RLS" \
  "SELECT has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'EXECUTE');"

check_true "has_org_role granted for RLS" \
  "SELECT has_function_privilege('authenticated', 'public.has_org_role(uuid,public.app_org_role[])', 'EXECUTE');"

# org_members direct UPDATE revoked from authenticated
revoked="$(psql "$DATABASE_URL" -tAc "SELECT NOT has_table_privilege('authenticated', 'public.org_members', 'UPDATE');" | tr -d '[:space:]')"
if [[ "$revoked" != "t" ]]; then
  echo "FAIL org_members UPDATE revoked from authenticated"
  fail=$((fail + 1))
else
  echo "OK   org_members UPDATE revoked"
fi

# update_org_member_role must remain callable
callable="$(psql "$DATABASE_URL" -tAc "SELECT has_function_privilege('authenticated', 'public.update_org_member_role(uuid,public.app_org_role)', 'EXECUTE');" | tr -d '[:space:]')"
if [[ "$callable" != "t" ]]; then
  echo "FAIL update_org_member_role must be executable by authenticated"
  fail=$((fail + 1))
else
  echo "OK   update_org_member_role callable"
fi

if [[ $fail -gt 0 ]]; then
  echo "Security validation failed ($fail checks)"
  exit 1
fi
echo "Security validation passed."
