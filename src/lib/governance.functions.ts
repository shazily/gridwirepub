import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { testStorageConnection, type StorageProfile } from "@/lib/storage.server";

const orgIdSchema = z.object({ orgId: z.string().uuid() });

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

export const testOrgStorage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        storageConfig: z.record(z.unknown()),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    return testStorageConnection(data.storageConfig as StorageProfile);
  });

export const updateOrgGovernance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        storageConfig: z.record(z.unknown()).optional(),
        storageQuotaBytes: z.number().int().positive().optional(),
        maxUploadBytes: z.number().int().positive().optional(),
        maxRowsPerSheet: z.number().int().positive().optional(),
        apiRateLimitPerMin: z.number().int().positive().optional(),
        apiMonthlyQuota: z.number().int().positive().nullable().optional(),
        authConfig: z.record(z.unknown()).optional(),
        smtpConfig: z.record(z.unknown()).optional(),
        smsConfig: z.record(z.unknown()).optional(),
        mfaRequiredRoles: z.array(z.string()).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const patch: Record<string, unknown> = {};
    if (data.storageConfig !== undefined) patch.storage_config = data.storageConfig;
    if (data.storageQuotaBytes !== undefined) patch.storage_quota_bytes = data.storageQuotaBytes;
    if (data.maxUploadBytes !== undefined) patch.max_upload_bytes = data.maxUploadBytes;
    if (data.maxRowsPerSheet !== undefined) patch.max_rows_per_sheet = data.maxRowsPerSheet;
    if (data.apiRateLimitPerMin !== undefined) patch.api_rate_limit_per_min = data.apiRateLimitPerMin;
    if (data.apiMonthlyQuota !== undefined) patch.api_monthly_quota = data.apiMonthlyQuota;
    if (data.authConfig !== undefined) patch.auth_config = data.authConfig;
    if (data.smtpConfig !== undefined) patch.smtp_config = data.smtpConfig;
    if (data.smsConfig !== undefined) patch.sms_config = data.smsConfig;
    if (data.mfaRequiredRoles !== undefined) patch.mfa_required_roles = data.mfaRequiredRoles;

    const { error } = await context.supabase.from("organizations").update(patch).eq("id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        teamId: z.string().uuid().optional(),
        name: z.string().min(1),
        storageQuotaBytes: z.number().int().positive().nullable().optional(),
        leadUserId: z.string().uuid().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    if (data.teamId) {
      const { error } = await context.supabase
        .from("teams")
        .update({
          name: data.name,
          storage_quota_bytes: data.storageQuotaBytes,
          lead_user_id: data.leadUserId,
        })
        .eq("id", data.teamId)
        .eq("org_id", data.orgId);
      if (error) throw new Error(error.message);
      return { teamId: data.teamId };
    }
    const { data: row, error } = await context.supabase
      .from("teams")
      .insert({
        org_id: data.orgId,
        name: data.name,
        storage_quota_bytes: data.storageQuotaBytes,
        lead_user_id: data.leadUserId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { teamId: row.id };
  });

export const allocateMemberStorage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        teamId: z.string().uuid().nullable().optional(),
        storageQuotaBytes: z.number().int().positive().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { error } = await context.supabase
      .from("org_members")
      .update({
        team_id: data.teamId,
        storage_quota_bytes: data.storageQuotaBytes,
      })
      .eq("org_id", data.orgId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getOrgStorageSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => orgIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: membership, error: mErr } = await context.supabase
      .from("org_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!membership) throw new Error("Not authorized for this organization");

    const { data: org, error } = await context.supabase
      .from("organizations")
      .select("storage_quota_bytes, storage_used_bytes, max_upload_bytes")
      .eq("id", data.orgId)
      .single();
    if (error) throw new Error(error.message);

    return {
      usedBytes: Number(org.storage_used_bytes ?? 0),
      quotaBytes: Number(org.storage_quota_bytes ?? 0),
      maxUploadBytes: Number(org.max_upload_bytes ?? 0),
    };
  });

export const getOrgGovernance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => orgIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { data: org, error } = await context.supabase
      .from("organizations")
      .select(
        "storage_config, storage_quota_bytes, storage_used_bytes, max_upload_bytes, max_rows_per_sheet, api_rate_limit_per_min, api_monthly_quota, auth_config, smtp_config, sms_config, mfa_required_roles",
      )
      .eq("id", data.orgId)
      .single();
    if (error) throw new Error(error.message);
    const { data: teams } = await context.supabase.from("teams").select("*").eq("org_id", data.orgId);
    const { data: members } = await context.supabase
      .from("org_members")
      .select("user_id, role, team_id, storage_quota_bytes, profiles(display_name)")
      .eq("org_id", data.orgId);
    return { org, teams: teams ?? [], members: members ?? [] };
  });
