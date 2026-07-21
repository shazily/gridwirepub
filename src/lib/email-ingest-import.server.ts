/**
 * Import validated email attachments into datasets (publish new version).
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logSystemAuditEvent } from "@/lib/audit.server";
import type { TemplateSchema } from "@/lib/email-template-validation";
import { publishVersionServer } from "@/lib/publish.server";
import type { PublishField, PublishSheet } from "@/lib/publish";
import { putObject, storageEnabled, type StorageProfile } from "@/lib/storage.server";
import type { ParsedWorkbook } from "@/lib/spreadsheet";

export type EmailImportResult =
  | { ok: true; datasetId: string; versionId: string; versionNo: number; rowCount: number }
  | { ok: false; error: string };

async function resolveOrgActor(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["owner", "admin"])
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}

function buildPublishPayload(
  parsed: ParsedWorkbook,
  schema: TemplateSchema,
): { fields: PublishField[]; sheets: PublishSheet[]; hasMacros: boolean } {
  const sheetName = schema.sheet_name ?? parsed.sheets[0]?.name;
  const sheet = parsed.sheets.find((s) => s.name === sheetName) ?? parsed.sheets[0];
  if (!sheet) throw new Error("Attachment has no sheets");

  const fields: PublishField[] = sheet.headers.map((h, idx) => ({
    source_key: h.api_name,
    sheet_name: sheet.name,
    original_name: h.original_name,
    api_name: h.api_name,
    data_type: h.data_type,
    nullable: true,
    is_pii: false,
    masking: "none",
    included: true,
    position: idx,
  }));

  const sheets: PublishSheet[] = [
    {
      name: sheet.name,
      included: true,
      rows: sheet.rows,
    },
  ];

  return { fields, sheets, hasMacros: parsed.hasMacros };
}

export async function storeEmailAttachment(opts: {
  orgId: string;
  messageId: string;
  fileName: string;
  bytes: Buffer;
}): Promise<string | null> {
  if (!storageEnabled()) return null;

  const { data: orgRow } = await supabaseAdmin
    .from("organizations")
    .select("storage_config")
    .eq("id", opts.orgId)
    .maybeSingle();
  const storageProfile = (orgRow?.storage_config ?? {}) as StorageProfile;
  const ext = opts.fileName.includes(".") ? opts.fileName.split(".").pop() : "bin";
  return putObject(
    { orgId: opts.orgId, profile: storageProfile },
    ["email-ingest", opts.messageId, `attachment.${ext}`],
    opts.bytes,
    "application/octet-stream",
  );
}

function formatImportError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return "import_failed";
}

export async function importEmailIngestMessage(opts: {
  messageId: string;
  orgId: string;
  template: {
    id: string;
    name: string;
    target_dataset_id: string | null;
    load_mode?: string | null;
    schema_snapshot: unknown;
  };
  fileName: string;
  bytes: Buffer;
  parsed: ParsedWorkbook;
}): Promise<EmailImportResult> {
  const schema = (opts.template.schema_snapshot ?? {}) as TemplateSchema;
  const actorId = await resolveOrgActor(opts.orgId);
  const { fields, sheets, hasMacros } = buildPublishPayload(opts.parsed, schema);
  const loadMode = opts.template.load_mode === "incremental" ? "incremental" : "full";
  let datasetName = opts.template.name;
  if (opts.template.target_dataset_id) {
    const { data: existing } = await supabaseAdmin
      .from("datasets")
      .select("name")
      .eq("id", opts.template.target_dataset_id)
      .maybeSingle();
    datasetName = existing?.name ?? opts.template.name;
  }

  try {
    const result = await publishVersionServer({
      orgId: opts.orgId,
      datasetId: opts.template.target_dataset_id ?? undefined,
      name: datasetName,
      description: opts.template.target_dataset_id
        ? undefined
        : `Auto-created from email ingest template "${opts.template.name}"`,
      fields,
      sheets,
      loadMode,
      hasMacros,
      fileName: opts.fileName,
      apiAccess: "secure",
      userId: actorId,
      fileBytes: opts.bytes.buffer.slice(opts.bytes.byteOffset, opts.bytes.byteOffset + opts.bytes.byteLength),
    });

    const { data: versionRow } = await supabaseAdmin
      .from("dataset_versions")
      .select("id")
      .eq("dataset_id", result.datasetId)
      .eq("version_no", result.versionNo)
      .maybeSingle();

    await logSystemAuditEvent({
      orgId: opts.orgId,
      action: "email_ingest.imported",
      resourceType: "email_ingest_message",
      resourceId: opts.messageId,
      metadata: {
        template_id: opts.template.id,
        dataset_id: result.datasetId,
        version_no: result.versionNo,
        file_name: opts.fileName,
      },
    });

    return {
      ok: true,
      datasetId: result.datasetId,
      versionId: versionRow?.id ?? "",
      versionNo: result.versionNo,
      rowCount: sheets[0]?.rows.length ?? 0,
    };
  } catch (err) {
    let message = formatImportError(err);
    if (message.includes("Data contract violation") && opts.template.target_dataset_id) {
      message =
        `${message} — Template "${opts.template.name}" imports into dataset "${datasetName}", ` +
        `but that dataset’s published contract does not match this file’s columns. ` +
        `Edit the template and choose “Create new dataset” or pick a dataset with matching columns.`;
    }
    await logSystemAuditEvent({
      orgId: opts.orgId,
      action: "email_ingest.import_failed",
      resourceType: "email_ingest_message",
      resourceId: opts.messageId,
      metadata: {
        error: message,
        template_id: opts.template.id,
        target_dataset_id: opts.template.target_dataset_id,
      },
    });
    return { ok: false, error: message };
  }
}
