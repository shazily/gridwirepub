/**
 * AD / IdP group → org role mapping helpers.
 * Mappings live in organizations.auth_config.group_role_mappings.
 */

export type OrgRole = "owner" | "admin" | "member" | "viewer" | "contributor";

export type GroupRoleMapping = {
  group: string;
  role: OrgRole;
};

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  contributor: 2,
  member: 3,
  admin: 4,
  owner: 5,
};

export function parseGroupRoleMappings(raw: unknown): GroupRoleMapping[] {
  if (!Array.isArray(raw)) return [];
  const out: GroupRoleMapping[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const group = String((item as { group?: unknown }).group ?? "").trim();
    const role = String((item as { role?: unknown }).role ?? "").trim() as OrgRole;
    if (!group) continue;
    if (!ROLE_RANK[role] || role === "owner") continue; // never auto-assign owner
    out.push({ group, role });
  }
  return out;
}

/**
 * Resolve the highest mapped role for the given IdP group claims.
 * Matching is case-insensitive exact on group id / CN / display name.
 */
export function resolveRoleFromGroups(
  groups: string[],
  mappings: GroupRoleMapping[],
): OrgRole | null {
  if (!groups.length || !mappings.length) return null;
  const normalized = new Set(groups.map((g) => g.trim().toLowerCase()).filter(Boolean));
  let best: OrgRole | null = null;
  for (const mapping of mappings) {
    if (!normalized.has(mapping.group.trim().toLowerCase())) continue;
    if (!best || ROLE_RANK[mapping.role] > ROLE_RANK[best]) {
      best = mapping.role;
    }
  }
  return best;
}

/**
 * Extract groups from common OIDC / SAML claim shapes.
 */
export function extractGroupsFromClaims(claims: Record<string, unknown>): string[] {
  const candidates = [
    claims.groups,
    claims.memberOf,
    claims.roles,
    claims["http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"],
  ];
  const out: string[] = [];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) out.push(c.trim());
    if (Array.isArray(c)) {
      for (const item of c) {
        if (typeof item === "string" && item.trim()) out.push(item.trim());
      }
    }
  }
  return [...new Set(out)];
}
