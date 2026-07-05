import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildSchemaFromParsed, type TemplateSchema, attachmentPatternForFileName } from "@/lib/email-template-validation";
import { parseWorkbookFromBuffer } from "@/lib/spreadsheet";
import { logUserAuditEvent } from "@/lib/audit.server";
import { putObject, storageEnabled, type StorageProfile } from "@/lib/storage.server";

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

export const uploadEmailIngestTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        name: z.string().min(1).max(200),
        subjectPattern: z.string().max(200).optional(),
        fileName: z.string().min(1),
        fileBase64: z.string().min(1),
        sheetIndex: z.number().int().min(0).default(0),
        targetDatasetId: z.string().uuid().optional(),
        loadMode: z.enum(["full", "incremental"]).default("full"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);

    const bytes = Buffer.from(data.fileBase64, "base64");
    const parsed = parseWorkbookFromBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      data.fileName,
    );
    const schema = buildSchemaFromParsed(parsed, data.sheetIndex, data.fileName);
    if (!schema.columns.length) {
      throw new Error("Template file has no detectable column headers");
    }

    const { data: row, error } = await context.supabase
      .from("email_ingest_templates")
      .insert({
        org_id: data.orgId,
        name: data.name.trim(),
        subject_pattern: data.subjectPattern?.trim() || null,
        attachment_pattern: attachmentPatternForFileName(data.fileName),
        schema_snapshot: schema as unknown as Record<string, unknown>,
        template_file_name: data.fileName,
        sheet_name: schema.sheet_name,
        target_dataset_id: data.targetDatasetId ?? null,
        load_mode: data.loadMode,
        active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    let templateStorageRef: string | null = null;
    if (storageEnabled()) {
      const { data: orgRow } = await context.supabase
        .from("organizations")
        .select("storage_config")
        .eq("id", data.orgId)
        .maybeSingle();
      const storageProfile = (orgRow?.storage_config ?? {}) as StorageProfile;
      const ext = data.fileName.includes(".") ? data.fileName.split(".").pop() : "bin";
      templateStorageRef = await putObject(
        { orgId: data.orgId, profile: storageProfile },
        ["email-ingest", "templates", row.id, `template.${ext}`],
        bytes,
        "application/octet-stream",
      );
      await context.supabase
        .from("email_ingest_templates")
        .update({ template_storage_ref: templateStorageRef })
        .eq("id", row.id);
    }

    await logUserAuditEvent({
      orgId: data.orgId,
      userId: context.userId,
      action: "email_ingest.template_created",
      resourceType: "email_ingest_template",
      resourceId: row.id,
      metadata: {
        name: data.name,
        file_name: data.fileName,
        columns: schema.columns.map((c) => c.api_name),
        template_storage_ref: templateStorageRef,
      },
    });

    return { templateId: row.id, schema: schema as TemplateSchema };
  });

export const testEmailIngest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        fromAddress: z.string().email(),
        subject: z.string().min(1),
        fileName: z.string().min(1),
        fileBase64: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);

    const { processInboundPostmarkEmail } = await import("@/lib/email-inbound.server");
    const result = await processInboundPostmarkEmail({
      from: data.fromAddress.toLowerCase(),
      subject: data.subject,
      orgId: data.orgId,
      attachments: [
        {
          name: data.fileName,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          contentBase64: data.fileBase64,
        },
      ],
      testMode: true,
    });

    await logUserAuditEvent({
      orgId: data.orgId,
      userId: context.userId,
      action: "email_ingest.test_run",
      resourceType: "email_ingest_message",
      resourceId: result.messageId,
      metadata: { status: result.status, from: data.fromAddress, subject: data.subject },
    });

    return result;
  });

export const deleteEmailIngestTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), templateId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);
    const { error } = await context.supabase
      .from("email_ingest_templates")
      .delete()
      .eq("id", data.templateId)
      .eq("org_id", data.orgId);
    if (error) throw new Error(error.message);

    await logUserAuditEvent({
      orgId: data.orgId,
      userId: context.userId,
      action: "email_ingest.template_deleted",
      resourceType: "email_ingest_template",
      resourceId: data.templateId,
    });

    return { ok: true as const };
  });

function publicAppBaseUrl(): string {
  return (
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    "http://127.0.0.1:3020"
  ).replace(/\/$/, "");
}

export const getEmailIngestSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(context.supabase, data.orgId, context.userId);

    const { clamavConfigured, clamavReachable } = await import("@/lib/clamav.server");
    const clamav = clamavConfigured()
      ? await clamavReachable()
      : { ok: false, detail: "not_configured" };

    const webhookUrl = `${publicAppBaseUrl()}/api/public/inbound/webhook`;
    const ingestDomain = process.env.INGEST_EMAIL_DOMAIN?.trim() || "ingest.local";

    return {
      webhookUrl,
      ingestDomain,
      webhookAuthConfigured: (await import("@/lib/public-endpoint-guard.server")).inboundWebhookAuthConfigured(),
      clamav: {
        configured: clamavConfigured(),
        reachable: clamav.ok,
        detail: clamav.detail,
      },
      inboundWebhookSteps: [
        "Create a dedicated ingest address for this workspace (configured above).",
        "Use any inbound mail gateway that receives email and POSTs parsed JSON to your webhook URL.",
        "Point the gateway at the webhook URL below (HTTP POST, application/json).",
        "MX records, forwarding, or journaling from your existing mail server can route mail to the ingest address.",
      ],
      mailForwardSteps: [
        "Optional: forward from your organization mail server to the workspace ingest address.",
        "Restrict forwarding with transport rules so only allowlisted senders reach the ingest pipeline.",
        "Gridwire does not host a mailbox — it only accepts parsed inbound webhooks and attachment bytes.",
      ],
      webhookSchemaNote:
        "Webhook body uses standard fields: From, Subject, MessageID, MailboxHash, Attachments[{Name, Content, ContentType}]. Compatible with common inbound providers.",
      webhookAuthNote:
        "Required for production: set INBOUND_WEBHOOK_SECRET and send X-Gridwire-Webhook-Secret (or Authorization: Bearer) on every POST. Postmark users should target /api/public/inbound/postmark and configure X-Postmark-Signature (HMAC-SHA256 of the raw body).",
    };
  });
