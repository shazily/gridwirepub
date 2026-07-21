import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePublicAppUrl } from "@/lib/public-app-url.server";
import { sendPasswordResetEmail } from "@/lib/password-reset.server";

type OrgRole = Database["public"]["Enums"]["app_org_role"];
type UserType = Database["public"]["Enums"]["org_member_user_type"];

async function requireOrgAdmin(
  supabase: SupabaseClient<Database>,
  orgId: string,
  userId: string,
): Promise<OrgRole> {
  const { data: membership, error } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new Error("Owner or admin access required");
  }
  return membership.role as OrgRole;
}

async function loadOrgAuthMode(
  supabaseAdmin: SupabaseClient<Database>,
  orgId: string,
): Promise<{ authMode: "local" | "sso" | "hybrid"; publicAppUrl: string | null }> {
  const { data: org, error } = await supabaseAdmin
    .from("organizations")
    .select("auth_config")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const auth = (org?.auth_config ?? {}) as Record<string, unknown>;
  const mode = auth.auth_mode;
  const authMode = mode === "local" || mode === "sso" || mode === "hybrid" ? mode : "hybrid";
  const publicAppUrl = typeof auth.public_app_url === "string" ? auth.public_app_url : null;
  return { authMode, publicAppUrl };
}

function assertAssignableRole(actorRole: OrgRole, newRole: OrgRole) {
  if (actorRole === "admin" && (newRole === "owner" || newRole === "admin")) {
    throw new Error("Admins cannot assign owner or admin roles");
  }
  if (newRole === "owner" && actorRole !== "owner") {
    throw new Error("Only owners can assign the owner role");
  }
}

async function writeAudit(
  supabaseAdmin: SupabaseClient<Database>,
  args: {
    orgId: string;
    actorId: string;
    action: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("display_name")
    .eq("id", args.actorId)
    .maybeSingle();
  await supabaseAdmin.from("audit_events").insert({
    org_id: args.orgId,
    actor_id: args.actorId,
    actor_label: profile?.display_name ?? null,
    action: args.action,
    resource_type: "org_member",
    resource_id: args.resourceId ?? null,
    metadata: (args.metadata ?? {}) as Record<string, unknown>,
  });
}

/**
 * Create (or attach) a local email/password user and add them to the organization.
 * Blocked when org auth_mode is sso-only.
 */
export const createLocalOrgUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        email: z.string().email(),
        displayName: z.string().trim().min(1).max(120).optional(),
        password: z.string().min(8).max(128).optional(),
        role: z.enum(["owner", "admin", "member", "viewer", "contributor"]),
        userType: z.enum(["internal", "external"]).default("external"),
        sendPasswordSetupEmail: z.boolean().default(true),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const actorRole = await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    assertAssignableRole(actorRole, data.role);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { authMode, publicAppUrl } = await loadOrgAuthMode(supabaseAdmin, data.orgId);
    if (authMode === "sso") {
      throw new Error("This organization is SSO-only. Local accounts cannot be created.");
    }

    const email = data.email.trim().toLowerCase();
    const displayName = data.displayName?.trim() || email.split("@")[0] || "User";
    const password =
      data.password?.trim() ||
      `Gw-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}!`;

    let userId: string | null = null;
    let created = false;

    const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });

    if (createdUser?.user?.id) {
      userId = createdUser.user.id;
      created = true;
    } else {
      const msg = (createErr?.message || "").toLowerCase();
      const alreadyExists =
        msg.includes("already") || msg.includes("registered") || msg.includes("exists");
      if (!alreadyExists) {
        throw new Error(createErr?.message || "Could not create user");
      }
      // Existing auth user — resolve id without paging the whole directory.
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
      });
      if (linkErr || !linkData?.user?.id) {
        throw new Error(linkErr?.message || "User already exists but could not be resolved");
      }
      userId = linkData.user.id;
    }

    const { data: existingMember } = await supabaseAdmin
      .from("org_members")
      .select("id")
      .eq("org_id", data.orgId)
      .eq("user_id", userId!)
      .maybeSingle();
    if (existingMember) {
      throw new Error("That user is already a member of this organization");
    }

    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId!, display_name: displayName }, { onConflict: "id" });

    const { data: member, error: memberErr } = await supabaseAdmin
      .from("org_members")
      .insert({
        org_id: data.orgId,
        user_id: userId!,
        role: data.role,
        user_type: data.userType as UserType,
        identity_source: "local",
      } as Database["public"]["Tables"]["org_members"]["Insert"])
      .select("id, role, user_type, identity_source")
      .single();
    if (memberErr) throw new Error(memberErr.message);

    let passwordEmailSent = false;
    if (data.sendPasswordSetupEmail) {
      const publicOrigin = resolvePublicAppUrl({ explicitOverride: publicAppUrl });
      const result = await sendPasswordResetEmail({
        email,
        redirectTo: `${publicOrigin}/reset-password`,
        publicAppUrlOverride: publicAppUrl,
      });
      passwordEmailSent = result.sent;
    }

    await writeAudit(supabaseAdmin, {
      orgId: data.orgId,
      actorId: context.userId,
      action: created ? "member.created" : "member.attached",
      resourceId: member.id,
      metadata: {
        email,
        role: data.role,
        user_type: data.userType,
        identity_source: "local",
        password_email_sent: passwordEmailSent,
      },
    });

    return {
      ok: true as const,
      memberId: member.id,
      userId: userId!,
      created,
      passwordEmailSent,
      temporaryPassword: data.sendPasswordSetupEmail || data.password ? null : password,
    };
  });

/** Send password reset only for local-identity members. */
export const sendLocalMemberPasswordResetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        memberId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: member, error } = await supabaseAdmin
      .from("org_members")
      .select("id, user_id, identity_source, disabled_at")
      .eq("id", data.memberId)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!member) throw new Error("Member not found");
    const identitySource = (member as { identity_source?: string }).identity_source ?? "local";
    if (identitySource !== "local") {
      throw new Error("SSO users must reset passwords through their identity provider");
    }
    if ((member as { disabled_at?: string | null }).disabled_at) {
      throw new Error("Cannot reset password for a disabled member");
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(member.user_id);
    if (userErr || !userData.user?.email) throw new Error(userErr?.message || "User email not found");

    const { publicAppUrl } = await loadOrgAuthMode(supabaseAdmin, data.orgId);
    const publicOrigin = resolvePublicAppUrl({ explicitOverride: publicAppUrl });
    const result = await sendPasswordResetEmail({
      email: userData.user.email,
      redirectTo: `${publicOrigin}/reset-password`,
      publicAppUrlOverride: publicAppUrl,
    });
    if (!result.sent && result.reason === "email_not_configured") {
      throw new Error("Password reset email is not configured on this server");
    }

    await writeAudit(supabaseAdmin, {
      orgId: data.orgId,
      actorId: context.userId,
      action: "member.password_reset_sent",
      resourceId: member.id,
    });

    return { ok: true as const, sent: result.sent };
  });

/** Soft-disable or re-enable org membership (does not delete the auth user). */
export const setOrgMemberDisabledFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        memberId: z.string().uuid(),
        disabled: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const actorRole = await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: member, error } = await supabaseAdmin
      .from("org_members")
      .select("id, user_id, role, disabled_at")
      .eq("id", data.memberId)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!member) throw new Error("Member not found");
    if (member.user_id === context.userId) {
      throw new Error("You cannot disable your own membership");
    }
    if (member.role === "owner" && actorRole !== "owner") {
      throw new Error("Only owners can disable another owner");
    }

    const { error: updErr } = await supabaseAdmin
      .from("org_members")
      .update({
        disabled_at: data.disabled ? new Date().toISOString() : null,
      } as Database["public"]["Tables"]["org_members"]["Update"])
      .eq("id", member.id);
    if (updErr) throw new Error(updErr.message);

    await writeAudit(supabaseAdmin, {
      orgId: data.orgId,
      actorId: context.userId,
      action: data.disabled ? "member.disabled" : "member.enabled",
      resourceId: member.id,
    });

    return { ok: true as const };
  });
