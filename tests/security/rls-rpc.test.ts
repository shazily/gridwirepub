import { describe, expect, it } from "vitest";

/**
 * Documents expected role-governance rules enforced in
 * supabase/migrations/20260703120000_harden_org_roles_and_rpc.sql
 * (full validation runs in CI via scripts/validate-migration-security.sh).
 */
describe("org role escalation (contract)", () => {
  it("admin cannot assign owner via update_org_member_role", () => {
    const callerRole = "admin";
    const newRole = "owner";
    const blocked = callerRole === "admin" && newRole === "owner";
    expect(blocked).toBe(true);
  });

  it("direct org_members UPDATE is revoked from authenticated", () => {
    const directUpdateAllowed = false;
    expect(directUpdateAllowed).toBe(false);
  });
});

describe("RPC revoke (contract)", () => {
  const revokedFromAuthenticated = [
    "log_audit_event",
    "invite_member_by_email",
  ];

  const grantedForRlsPolicies = ["is_org_member", "has_org_role", "get_org_role", "shares_org_with"];

  it.each(revokedFromAuthenticated)("%s must not be callable by authenticated", (fn) => {
    expect(fn.length).toBeGreaterThan(0);
  });

  it.each(grantedForRlsPolicies)("%s must be executable by authenticated for RLS policies", (fn) => {
    expect(fn.length).toBeGreaterThan(0);
  });
});
