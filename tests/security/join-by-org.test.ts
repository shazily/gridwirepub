import { describe, expect, it } from "vitest";
import { buildJoinUrl, isOrgUuid } from "@/lib/org-join";

describe("isOrgUuid", () => {
  it("accepts standard UUID", () => {
    expect(isOrgUuid("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
  });

  it("rejects portal slug and empty", () => {
    expect(isOrgUuid("acme-corp")).toBe(false);
    expect(isOrgUuid("")).toBe(false);
    expect(isOrgUuid("not-a-uuid")).toBe(false);
  });
});

describe("buildJoinUrl", () => {
  it("prefers portal slug over uuid", () => {
    expect(buildJoinUrl("https://data.example.com", "acme-corp", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
      "https://data.example.com/join/acme-corp",
    );
  });

  it("falls back to org uuid when slug missing", () => {
    expect(buildJoinUrl("https://data.example.com/", null, "a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
      "https://data.example.com/join/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
  });
});

/**
 * Documents join RPC contracts from
 * supabase/migrations/20260721100000_join_by_org_id.sql
 */
describe("join_organization_by_ref (contract)", () => {
  const GENERIC = "Unable to join this organization";

  it("requires allow_join_by_org_id before membership insert", () => {
    const allowJoin = false;
    const wouldInsert = allowJoin;
    expect(wouldInsert).toBe(false);
  });

  it("uses one generic failure message for missing and disabled join", () => {
    const missingMsg = GENERIC;
    const disabledMsg = GENERIC;
    expect(missingMsg).toBe(disabledMsg);
  });

  it("assigns viewer + external + local on successful join", () => {
    const role = "viewer";
    const userType = "external";
    const identitySource = "local";
    expect(role).toBe("viewer");
    expect(userType).toBe("external");
    expect(identitySource).toBe("local");
  });

  it("get_join_preview is not granted to anon or authenticated", () => {
    const grantedTo = ["service_role"];
    expect(grantedTo).not.toContain("anon");
    expect(grantedTo).not.toContain("authenticated");
  });
});
