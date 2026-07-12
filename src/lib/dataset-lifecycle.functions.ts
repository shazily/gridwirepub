/**
 * Client-callable lifecycle actions: archive, restore, permanent delete.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toUserFacingMessage } from "@/lib/user-facing-error";

const baseSchema = z.object({
  orgId: z.string().uuid(),
  datasetId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export const archiveDatasetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => baseSchema.parse(data))
  .handler(async ({ data, context }) => {
    try {
      const { archiveDataset } = await import("@/lib/dataset-lifecycle.server");
      return await archiveDataset({
        orgId: data.orgId,
        datasetId: data.datasetId,
        userId: context.userId,
        reason: data.reason,
      });
    } catch (err) {
      throw new Error(toUserFacingMessage(err, "Could not archive dataset."));
    }
  });

export const restoreDatasetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => baseSchema.parse(data))
  .handler(async ({ data, context }) => {
    try {
      const { restoreDataset } = await import("@/lib/dataset-lifecycle.server");
      return await restoreDataset({
        orgId: data.orgId,
        datasetId: data.datasetId,
        userId: context.userId,
        reason: data.reason,
      });
    } catch (err) {
      throw new Error(toUserFacingMessage(err, "Could not restore dataset."));
    }
  });

export const permanentlyDeleteDatasetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    baseSchema
      .extend({
        confirmName: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    try {
      const { permanentlyDeleteDataset } = await import("@/lib/dataset-lifecycle.server");
      return await permanentlyDeleteDataset({
        orgId: data.orgId,
        datasetId: data.datasetId,
        userId: context.userId,
        confirmName: data.confirmName,
        reason: data.reason,
      });
    } catch (err) {
      throw new Error(toUserFacingMessage(err, "Could not permanently delete dataset."));
    }
  });
