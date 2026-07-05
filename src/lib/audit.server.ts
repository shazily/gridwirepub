/** Service-role audit writes for system pipelines (email ingest, webhooks). */

export async function logSystemAuditEvent(args: {
  orgId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  datasetId?: string;
  actorLabel?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("audit_events").insert({
    org_id: args.orgId,
    actor_id: null,
    actor_label: args.actorLabel ?? "system:email-ingest",
    action: args.action,
    resource_type: args.resourceType ?? null,
    resource_id: args.resourceId ?? null,
    dataset_id: args.datasetId ?? null,
    metadata: (args.metadata ?? {}) as Record<string, unknown>,
  });
  if (error) throw new Error(error.message);
}

/** Audit write from a server handler with a known user — avoids nested server-fn WebSocket issues. */
export async function logUserAuditEvent(args: {
  orgId: string;
  userId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  datasetId?: string;
  actorLabel?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let actorLabel = args.actorLabel ?? null;
  if (!actorLabel) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", args.userId)
      .maybeSingle();
    actorLabel = profile?.display_name ?? null;
  }

  const { error } = await supabaseAdmin.from("audit_events").insert({
    org_id: args.orgId,
    actor_id: args.userId,
    actor_label: actorLabel,
    action: args.action,
    resource_type: args.resourceType ?? null,
    resource_id: args.resourceId ?? null,
    dataset_id: args.datasetId ?? null,
    metadata: (args.metadata ?? {}) as Record<string, unknown>,
  });
  if (error) throw new Error(error.message);
}
