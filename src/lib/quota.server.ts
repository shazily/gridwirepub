import type { AdminClient } from "@/lib/api-serve.server";

export type QuotaCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; limit?: number; used?: number };

export async function checkStorageQuota(
  admin: AdminClient,
  opts: {
    orgId: string;
    userId: string | null;
    bytes: number;
    inviteId?: string | null;
  },
): Promise<QuotaCheckResult> {
  const { data, error } = await admin.rpc("check_storage_quota", {
    _org_id: opts.orgId,
    _user_id: opts.userId,
    _bytes: opts.bytes,
    _invite_id: opts.inviteId ?? null,
  });
  if (error) throw new Error(error.message);
  const result = data as { allowed: boolean; reason?: string; limit?: number; used?: number; quota?: number };
  if (!result.allowed) {
    return {
      allowed: false,
      reason: result.reason ?? "quota_exceeded",
      limit: result.limit ?? result.quota,
      used: result.used,
    };
  }
  return { allowed: true };
}

export async function recordStorageUsage(
  admin: AdminClient,
  opts: {
    orgId: string;
    userId: string | null;
    bytesDelta: number;
    eventType: string;
    teamId?: string | null;
    datasetId?: string | null;
    versionId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.rpc("record_storage_usage", {
    _org_id: opts.orgId,
    _user_id: opts.userId,
    _bytes_delta: opts.bytesDelta,
    _event_type: opts.eventType,
    _team_id: opts.teamId ?? null,
    _dataset_id: opts.datasetId ?? null,
    _version_id: opts.versionId ?? null,
    _metadata: opts.metadata ?? {},
  });
  if (error) throw new Error(error.message);
}

export const DEFAULT_MAX_UPLOAD_BYTES = 52_428_800; // 50 MB

export async function getOrgMaxUploadBytes(admin: AdminClient, orgId: string): Promise<number> {
  const { data } = await admin
    .from("organizations")
    .select("max_upload_bytes")
    .eq("id", orgId)
    .maybeSingle();
  return data?.max_upload_bytes ?? DEFAULT_MAX_UPLOAD_BYTES;
}

export const DEFAULT_MAX_ROWS_PER_SHEET = 5000;

export async function getOrgMaxRowsPerSheet(admin: AdminClient, orgId: string): Promise<number> {
  const { data } = await admin
    .from("organizations")
    .select("max_rows_per_sheet")
    .eq("id", orgId)
    .maybeSingle();
  const rows = (data as { max_rows_per_sheet?: number } | null)?.max_rows_per_sheet;
  return rows && rows > 0 ? rows : DEFAULT_MAX_ROWS_PER_SHEET;
}
