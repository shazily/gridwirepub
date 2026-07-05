import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  orgId: z.string().uuid(),
  action: z.string().min(1).max(100),
  resourceType: z.string().max(100).optional(),
  resourceId: z.string().max(200).optional(),
  datasetId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Records a control-plane audit event for an organization.
 *
 * log_audit_event is no longer executable by the authenticated database role.
 * This server function verifies org membership and writes via the service role.
 */
export const logAuditEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: membership, error: mErr } = await context.supabase
      .from("org_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!membership) throw new Error("Not authorized for this organization");

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("audit_events").insert({
      org_id: data.orgId,
      actor_id: context.userId,
      actor_label: profile?.display_name ?? null,
      action: data.action,
      resource_type: data.resourceType ?? null,
      resource_id: data.resourceId ?? null,
      dataset_id: data.datasetId ?? null,
      metadata: (data.metadata ?? {}) as Record<string, unknown>,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
