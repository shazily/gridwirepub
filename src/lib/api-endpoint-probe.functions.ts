/**
 * Authenticated server functions for endpoint and platform health probes.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toUserFacingMessage } from "@/lib/user-facing-error";
import type { EndpointProbeKind } from "@/lib/api-endpoint-probe.server";

const probeKinds = z.enum([
  "rows",
  "schema",
  "dataset",
  "openapi",
  "contract_json",
  "contract_yaml",
  "lineage",
]);

function resolveProbeOrigin(): string {
  const configured = process.env.PUBLIC_APP_URL?.trim() || process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  try {
    const req = getRequest();
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host =
      req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
      req.headers.get("host")?.split(",")[0]?.trim();
    if (proto && host) return `${proto}://${host}`;
    return new URL(req.url).origin;
  } catch {
    return process.env.PORTAL_INTERNAL_URL?.trim() || "http://127.0.0.1:3000";
  }
}

export const probeDatasetEndpointsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        datasetId: z.string().uuid(),
        sheetName: z.string().min(1).max(200),
        apiKey: z.string().min(8).max(200).optional(),
        kinds: z.array(probeKinds).min(1).max(10).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: member } = await context.supabase
        .from("org_members")
        .select("role")
        .eq("org_id", data.orgId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!member) throw new Error("You are not a member of this workspace.");

      const { data: ds, error } = await context.supabase
        .from("datasets")
        .select("id, org_id, status, api_access, current_version_id")
        .eq("id", data.datasetId)
        .eq("org_id", data.orgId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!ds) throw new Error("Dataset not found.");

      const { probeDatasetEndpoints } = await import("@/lib/api-endpoint-probe.server");
      const origin = resolveProbeOrigin();

      const results = await probeDatasetEndpoints({
        origin,
        datasetId: data.datasetId,
        sheetName: data.sheetName,
        secure: ds.api_access === "secure",
        apiKey: data.apiKey ?? null,
        kinds: data.kinds as EndpointProbeKind[] | undefined,
      });

      return {
        datasetId: data.datasetId,
        status: ds.status,
        api_access: ds.api_access,
        origin,
        results,
      };
    } catch (err) {
      throw new Error(toUserFacingMessage(err, "Could not probe dataset endpoints."));
    }
  });

export const getPlatformHealthFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    try {
      const { data: member } = await context.supabase
        .from("org_members")
        .select("role")
        .eq("org_id", data.orgId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!member || !["owner", "admin"].includes(member.role)) {
        throw new Error("Owner or admin access required for platform health.");
      }

      const { collectPlatformHealth } = await import("@/lib/api-endpoint-probe.server");
      return await collectPlatformHealth(resolveProbeOrigin());
    } catch (err) {
      throw new Error(toUserFacingMessage(err, "Could not collect platform health."));
    }
  });
