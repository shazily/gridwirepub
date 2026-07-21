/**
 * Apply auth_config.group_role_mappings after SSO login (service-role only).
 * Call from a future GoTrue webhook / post-auth hook with IdP claims.
 */

import {
  extractGroupsFromClaims,
  parseGroupRoleMappings,
  resolveRoleFromGroups,
  type OrgRole,
} from "@/lib/ad-group-role";

export async function syncOrgMemberRoleFromIdpGroups(args: {
  orgId: string;
  userId: string;
  claims: Record<string, unknown>;
}): Promise<{ role: OrgRole | null; updated: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("auth_config")
    .eq("id", args.orgId)
    .maybeSingle();

  const authConfig = (org?.auth_config ?? {}) as Record<string, unknown>;
  const mappings = parseGroupRoleMappings(authConfig.group_role_mappings);
  const groups = extractGroupsFromClaims(args.claims);
  const role = resolveRoleFromGroups(groups, mappings);
  if (!role) return { role: null, updated: false };

  const { data: member } = await supabaseAdmin
    .from("org_members")
    .select("id, role")
    .eq("org_id", args.orgId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (!member) {
    const { error } = await supabaseAdmin.from("org_members").insert({
      org_id: args.orgId,
      user_id: args.userId,
      role,
      identity_source: "sso",
      user_type: "internal",
    } as Record<string, unknown>);
    if (error) throw error;
    return { role, updated: true };
  }

  if (member.role === "owner" || member.role === role) {
    await supabaseAdmin
      .from("org_members")
      .update({ identity_source: "sso" } as Record<string, unknown>)
      .eq("id", member.id);
    return { role: member.role as OrgRole, updated: false };
  }

  const { error } = await supabaseAdmin
    .from("org_members")
    .update({ role, identity_source: "sso" } as Record<string, unknown>)
    .eq("id", member.id);
  if (error) throw error;
  return { role, updated: true };
}
