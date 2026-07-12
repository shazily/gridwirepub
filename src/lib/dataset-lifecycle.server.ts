/**
 * Dataset archive / restore / permanent delete with structured audit + operator logs.
 *
 * Logging contract (every lifecycle action):
 * - Operator console: `[dataset-lifecycle]` structured line via logServer
 * - Compliance: insert-only `audit_events` with correlation_id + pre/post snapshot
 * - Workspace: `alert_events` so operators see the change in-app
 * - Permanent delete audits BEFORE row delete so the trail survives CASCADE
 */

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logUserAuditEvent } from "@/lib/audit.server";
import { logServer, logServerError } from "@/lib/user-facing-error";

export type DatasetLifecycleSnapshot = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: string;
  api_access: string | null;
  source_type: string | null;
  current_version_id: string | null;
  version_count: number;
  total_rows: number;
  latest_version_no: number | null;
};

type OrgRoleName = "owner" | "admin" | "member" | "contributor" | "viewer";

async function assertOrgRole(
  orgId: string,
  userId: string,
  allowed: OrgRoleName[],
): Promise<OrgRoleName> {
  const { data, error } = await supabaseAdmin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not authorized for this organization");
  const role = (data as { role: string }).role as OrgRoleName;
  if (!allowed.includes(role)) {
    throw new Error("You do not have permission for this dataset action");
  }
  return role;
}

function newCorrelationId(): string {
  return randomUUID();
}

export async function loadDatasetLifecycleSnapshot(
  datasetId: string,
  orgId: string,
): Promise<DatasetLifecycleSnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from("datasets")
    .select("id, org_id, name, slug, status, api_access, source_type, current_version_id")
    .eq("id", datasetId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: versions, error: vErr } = await supabaseAdmin
    .from("dataset_versions")
    .select("version_no, row_count")
    .eq("dataset_id", datasetId);
  if (vErr) throw new Error(vErr.message);
  const vers = (versions ?? []) as { version_no: number; row_count: number | null }[];
  const total_rows = vers.reduce((n, v) => n + (v.row_count ?? 0), 0);
  const latest_version_no =
    vers.length > 0 ? Math.max(...vers.map((v) => v.version_no)) : null;

  return {
    id: data.id,
    org_id: data.org_id,
    name: data.name,
    slug: data.slug,
    status: data.status,
    api_access: (data as { api_access?: string | null }).api_access ?? null,
    source_type: data.source_type,
    current_version_id: data.current_version_id,
    version_count: vers.length,
    total_rows,
    latest_version_no,
  };
}

async function raiseLifecycleAlert(opts: {
  orgId: string;
  title: string;
  body: string;
  severity?: "info" | "warning" | "error";
}): Promise<void> {
  await supabaseAdmin.from("alert_events").insert({
    org_id: opts.orgId,
    event_type: "dataset_lifecycle",
    severity: opts.severity ?? "info",
    title: opts.title,
    body: opts.body,
    audience: "workspace",
  } as never);
}

export async function archiveDataset(opts: {
  orgId: string;
  datasetId: string;
  userId: string;
  reason?: string;
}): Promise<DatasetLifecycleSnapshot> {
  const correlationId = newCorrelationId();
  const actorRole = await assertOrgRole(opts.orgId, opts.userId, [
    "owner",
    "admin",
    "member",
    "contributor",
  ]);
  const snap = await loadDatasetLifecycleSnapshot(opts.datasetId, opts.orgId);
  if (!snap) throw new Error("Dataset not found");
  if (snap.status === "archived") throw new Error("Dataset is already archived");

  const occurredAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("datasets")
    .update({ status: "archived", updated_at: occurredAt })
    .eq("id", opts.datasetId)
    .eq("org_id", opts.orgId);
  if (error) {
    logServerError("dataset-lifecycle", `Archive failed for "${snap.name}"`, error, {
      correlationId,
      datasetId: opts.datasetId,
      orgId: opts.orgId,
    });
    throw new Error(error.message);
  }

  const meta = {
    correlation_id: correlationId,
    occurred_at: occurredAt,
    actor_role: actorRole,
    reason: opts.reason?.trim() || null,
    previous_status: snap.status,
    new_status: "archived",
    name: snap.name,
    slug: snap.slug,
    api_access: snap.api_access,
    source_type: snap.source_type,
    version_count: snap.version_count,
    total_rows: snap.total_rows,
    latest_version_no: snap.latest_version_no,
    api_effect: "offline",
  };

  await logUserAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    action: "dataset.archived",
    resourceType: "dataset",
    resourceId: opts.datasetId,
    datasetId: opts.datasetId,
    metadata: meta,
  });

  await raiseLifecycleAlert({
    orgId: opts.orgId,
    title: `Dataset archived: ${snap.name}`,
    body: `API is offline. ${snap.version_count} version(s), ${snap.total_rows} row(s).${opts.reason ? ` Reason: ${opts.reason}` : ""}`,
    severity: "warning",
  });

  logServer("dataset-lifecycle", "info", `Archived dataset "${snap.name}"`, {
    datasetId: opts.datasetId,
    orgId: opts.orgId,
    userId: opts.userId,
    ...meta,
  });

  return { ...snap, status: "archived" };
}

export async function restoreDataset(opts: {
  orgId: string;
  datasetId: string;
  userId: string;
  reason?: string;
}): Promise<DatasetLifecycleSnapshot> {
  const correlationId = newCorrelationId();
  const actorRole = await assertOrgRole(opts.orgId, opts.userId, [
    "owner",
    "admin",
    "member",
    "contributor",
  ]);
  const snap = await loadDatasetLifecycleSnapshot(opts.datasetId, opts.orgId);
  if (!snap) throw new Error("Dataset not found");
  if (snap.status !== "archived") throw new Error("Only archived datasets can be restored");

  const nextStatus = snap.current_version_id ? "published" : "draft";
  const occurredAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("datasets")
    .update({ status: nextStatus, updated_at: occurredAt })
    .eq("id", opts.datasetId)
    .eq("org_id", opts.orgId);
  if (error) {
    logServerError("dataset-lifecycle", `Restore failed for "${snap.name}"`, error, {
      correlationId,
      datasetId: opts.datasetId,
      orgId: opts.orgId,
    });
    throw new Error(error.message);
  }

  const meta = {
    correlation_id: correlationId,
    occurred_at: occurredAt,
    actor_role: actorRole,
    reason: opts.reason?.trim() || null,
    previous_status: "archived",
    new_status: nextStatus,
    restored_status: nextStatus,
    name: snap.name,
    slug: snap.slug,
    api_access: snap.api_access,
    source_type: snap.source_type,
    version_count: snap.version_count,
    total_rows: snap.total_rows,
    api_effect: nextStatus === "published" ? "online" : "offline_until_publish",
  };

  await logUserAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    action: "dataset.restored",
    resourceType: "dataset",
    resourceId: opts.datasetId,
    datasetId: opts.datasetId,
    metadata: meta,
  });

  await raiseLifecycleAlert({
    orgId: opts.orgId,
    title: `Dataset restored: ${snap.name}`,
    body: `Status set to ${nextStatus}. API ${nextStatus === "published" ? "is live again" : "remains offline until publish"}.`,
    severity: "info",
  });

  logServer("dataset-lifecycle", "info", `Restored dataset "${snap.name}" → ${nextStatus}`, {
    datasetId: opts.datasetId,
    orgId: opts.orgId,
    userId: opts.userId,
    ...meta,
  });

  return { ...snap, status: nextStatus };
}

/**
 * Permanently deletes a dataset and cascaded versions/fields/rows.
 * Owner/admin only. Writes an immutable audit event with a full pre-delete snapshot first.
 */
export async function permanentlyDeleteDataset(opts: {
  orgId: string;
  datasetId: string;
  userId: string;
  confirmName: string;
  reason?: string;
}): Promise<{ deleted: DatasetLifecycleSnapshot }> {
  const correlationId = newCorrelationId();
  const actorRole = await assertOrgRole(opts.orgId, opts.userId, ["owner", "admin"]);
  const snap = await loadDatasetLifecycleSnapshot(opts.datasetId, opts.orgId);
  if (!snap) throw new Error("Dataset not found");

  if (opts.confirmName.trim() !== snap.name) {
    logServer("dataset-lifecycle", "warn", "Permanent delete blocked: name confirmation mismatch", {
      correlationId,
      datasetId: opts.datasetId,
      orgId: opts.orgId,
      userId: opts.userId,
      actor_role: actorRole,
      expected_name: snap.name,
    });
    throw new Error(`Type the exact dataset name "${snap.name}" to confirm permanent deletion.`);
  }

  const occurredAt = new Date().toISOString();
  const meta = {
    correlation_id: correlationId,
    occurred_at: occurredAt,
    actor_role: actorRole,
    reason: opts.reason?.trim() || null,
    deleted_name: snap.name,
    deleted_slug: snap.slug,
    previous_status: snap.status,
    api_access: snap.api_access,
    source_type: snap.source_type,
    version_count: snap.version_count,
    total_rows: snap.total_rows,
    latest_version_no: snap.latest_version_no,
    current_version_id: snap.current_version_id,
    irreversible: true,
    api_effect: "removed",
  };

  // Audit BEFORE delete — audit_events.dataset_id has no FK, so the trail survives.
  await logUserAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    action: "dataset.deleted",
    resourceType: "dataset",
    resourceId: opts.datasetId,
    datasetId: opts.datasetId,
    metadata: meta,
  });

  logServer("dataset-lifecycle", "warn", `Permanently deleting dataset "${snap.name}"`, {
    datasetId: opts.datasetId,
    orgId: opts.orgId,
    userId: opts.userId,
    ...meta,
  });

  const { error } = await supabaseAdmin
    .from("datasets")
    .delete()
    .eq("id", opts.datasetId)
    .eq("org_id", opts.orgId);
  if (error) {
    logServerError("dataset-lifecycle", `Delete failed for "${snap.name}" (audit already recorded)`, error, {
      correlationId,
      datasetId: opts.datasetId,
      orgId: opts.orgId,
    });
    await logUserAuditEvent({
      orgId: opts.orgId,
      userId: opts.userId,
      action: "dataset.delete_failed",
      resourceType: "dataset",
      resourceId: opts.datasetId,
      datasetId: opts.datasetId,
      metadata: {
        correlation_id: correlationId,
        occurred_at: new Date().toISOString(),
        actor_role: actorRole,
        cause: error.message,
        previous_delete_audit: "dataset.deleted",
      },
    });
    throw new Error(error.message);
  }

  await raiseLifecycleAlert({
    orgId: opts.orgId,
    title: `Dataset permanently deleted: ${snap.name}`,
    body: `Removed ${snap.version_count} version(s) and ${snap.total_rows} row(s). This cannot be undone.`,
    severity: "error",
  });

  logServer("dataset-lifecycle", "warn", `Deleted dataset "${snap.name}"`, {
    correlationId,
    datasetId: opts.datasetId,
    orgId: opts.orgId,
    userId: opts.userId,
    version_count: snap.version_count,
    total_rows: snap.total_rows,
  });

  return { deleted: snap };
}
