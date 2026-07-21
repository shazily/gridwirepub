import { describe, expect, it } from "vitest";
import {
  extractGroupsFromClaims,
  parseGroupRoleMappings,
  resolveRoleFromGroups,
} from "../../src/lib/ad-group-role";

describe("ad-group-role", () => {
  it("parses mappings and never allows owner auto-assign", () => {
    const mappings = parseGroupRoleMappings([
      { group: "Finance", role: "member" },
      { group: "Admins", role: "owner" },
      { group: "", role: "admin" },
    ]);
    expect(mappings).toEqual([{ group: "Finance", role: "member" }]);
  });

  it("picks the highest matching role", () => {
    const role = resolveRoleFromGroups(
      ["finance", "IT-Admins"],
      [
        { group: "Finance", role: "member" },
        { group: "IT-Admins", role: "admin" },
      ],
    );
    expect(role).toBe("admin");
  });

  it("extracts groups from claim shapes", () => {
    expect(
      extractGroupsFromClaims({
        groups: ["a", "b"],
        memberOf: "CN=Finance,OU=Groups",
      }),
    ).toEqual(["a", "b", "CN=Finance,OU=Groups"]);
  });
});
