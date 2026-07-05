import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const alertEventSchema = z.object({
  event_type: z.string().min(1).max(100),
  severity: z.enum(["info", "warning", "error"]),
  title: z.string().min(1).max(300),
  body: z.string().max(4000),
});

const inputSchema = z.object({
  orgId: z.string().uuid(),
  events: z.array(alertEventSchema).min(1).max(20),
});

/**
 * Raises alert events for an organization.
 *
 * alert_events is backend-write-only (no client INSERT policy). This server
 * function authorizes the caller as a member of the target org and then writes
 * the events with the service role, so members can no longer set arbitrary
 * recipients / email_status / severity directly from the client.
 */
export const raiseAlertEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Verify the caller actually belongs to the org (RLS-scoped read of own membership).
    const { data: membership, error: mErr } = await context.supabase
      .from("org_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!membership) throw new Error("Not authorized for this organization");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = data.events.map((e) => ({
      org_id: data.orgId,
      audience: "workspace" as const,
      ...e,
    }));
    const { error } = await supabaseAdmin.from("alert_events").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
