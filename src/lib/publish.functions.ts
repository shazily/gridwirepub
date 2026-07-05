import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { publishVersionServer } from "@/lib/publish.server";
import type { PublishField, PublishSheet } from "@/lib/publish";

const publishSchema = z.object({
  orgId: z.string().uuid(),
  datasetId: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(z.custom<PublishField>()),
  sheets: z.array(z.custom<PublishSheet>()),
  loadMode: z.enum(["full", "incremental"]),
  hasMacros: z.boolean(),
  fileName: z.string(),
  apiAccess: z.enum(["secure", "public"]).optional(),
  fileBase64: z.string().optional(),
});

export const publishDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => publishSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: membership, error: mErr } = await context.supabase
      .from("org_members")
      .select("role, accepted_invite_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!membership) throw new Error("Not authorized for this organization");
    if (membership.role === "viewer") throw new Error("Viewers cannot publish datasets");

    const fileBytes = data.fileBase64
      ? Buffer.from(data.fileBase64, "base64").buffer
      : null;

    return publishVersionServer({
      orgId: data.orgId,
      datasetId: data.datasetId,
      name: data.name,
      description: data.description,
      fields: data.fields,
      sheets: data.sheets,
      loadMode: data.loadMode,
      hasMacros: data.hasMacros,
      fileName: data.fileName,
      apiAccess: data.apiAccess,
      userId: context.userId,
      fileBytes,
      inviteId: (membership as { accepted_invite_id?: string | null }).accepted_invite_id ?? null,
    });
  });
