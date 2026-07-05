import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractClientIp, ipMatchesCidr } from "@/lib/portal-access.server";
import { getRequest } from "@tanstack/react-start/server";

async function requireOrgAdmin(
  supabase: SupabaseClient<Database>,
  orgId: string,
  userId: string,
) {
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
}

export const getPortalSecurity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { data: org } = await context.supabase
      .from("organizations")
      .select("portal_slug, portal_access_enforced")
      .eq("id", data.orgId)
      .single();
    const { data: allowlist } = await context.supabase
      .from("portal_ip_allowlist")
      .select("id, cidr, label, is_system, created_at")
      .eq("org_id", data.orgId)
      .order("is_system", { ascending: false })
      .order("created_at", { ascending: true });
    const req = getRequest();
    const myIp = req ? extractClientIp(req) : "127.0.0.1";
    return { org, allowlist: allowlist ?? [], myIp };
  });

export const updatePortalAccessEnforced = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), enforced: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { error } = await context.supabase
      .from("organizations")
      .update({ portal_access_enforced: data.enforced })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addPortalIpRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({ orgId: z.string().uuid(), cidr: z.string().min(3), label: z.string().optional() })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { error } = await context.supabase.from("portal_ip_allowlist").insert({
      org_id: data.orgId,
      cidr: data.cidr.trim(),
      label: data.label?.trim() ?? "",
      is_system: false,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removePortalIpRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), ruleId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { error } = await context.supabase
      .from("portal_ip_allowlist")
      .delete()
      .eq("id", data.ruleId)
      .eq("org_id", data.orgId)
      .eq("is_system", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testMyPortalIp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const req = getRequest();
    const myIp = req ? extractClientIp(req) : "127.0.0.1";
    const { data: rules } = await context.supabase
      .from("portal_ip_allowlist")
      .select("cidr")
      .eq("org_id", data.orgId);
    const allowed = (rules ?? []).some((r) => ipMatchesCidr(myIp, r.cidr));
    return { myIp, allowed };
  });

export const regeneratePortalSlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { data: newSlug, error } = await context.supabase.rpc("regenerate_portal_slug", {
      _org_id: data.orgId,
    });
    if (error) throw new Error(error.message);
    return { portalSlug: newSlug as string };
  });
