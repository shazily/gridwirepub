/**
 * Client-callable server functions for AI PDF parse + draft review gate.
 * Server-only modules are loaded dynamically inside handlers (import-protection).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isPdfFileName } from "@/lib/ingest-file-types";
import type { PublishField, PublishSheet } from "@/lib/publish";
import type { ParsedWorkbook } from "@/lib/spreadsheet";
import type { TemplateSchema } from "@/lib/email-template-validation";
import type { PdfParseConfidence } from "@/lib/ingest-file-types";
import { PDF_STRUCTURE_SAMPLE_ROWS, type PdfStructureSnapshot } from "@/lib/pdf-structure";
import { logServerError, toUserFacingMessage } from "@/lib/user-facing-error";

type DraftSummary = {
  id: string;
  source: string;
  status: string;
  file_name: string;
  ai_model: string | null;
  page_count: number | null;
  confidence: PdfParseConfidence | Record<string, unknown>;
  sheet_count: number;
  table_count: number;
  parse_error: string | null;
  target_dataset_id: string | null;
  connector_id: string | null;
  email_message_id: string | null;
  created_at: string;
};

async function assertOrgEditor(orgId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: membership, error } = await supabaseAdmin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!membership) throw new Error("Not authorized for this organization");
  if ((membership as { role: string }).role === "viewer") {
    throw new Error("Viewers cannot parse or review PDF ingest");
  }
  return (membership as { role: string }).role;
}

const parsePdfSchema = z.object({
  orgId: z.string().uuid(),
  fileName: z.string().min(1),
  fileBase64: z.string().min(1),
  source: z.enum(["upload", "email", "connector"]).default("upload"),
  targetDatasetId: z.string().uuid().optional(),
  connectorId: z.string().uuid().optional(),
});

/**
 * Queue PDF AI parse: creates a `processing` draft immediately, returns draftId,
 * then continues parsing in the background so refresh/leave does not lose the job.
 */
export const startPdfIngest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => parsePdfSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertOrgEditor(data.orgId, context.userId);
    if (!isPdfFileName(data.fileName)) {
      throw new Error("Only PDF files can be sent to startPdfIngest");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { scanBytesWithClamav } = await import("@/lib/clamav.server");
    const { getOrgMaxUploadBytes } = await import("@/lib/quota.server");
    const { formatBytesShort, pdfParseMaxBytes } = await import("@/lib/pdf-parse-limits.server");
    const { createProcessingPdfDraft, schedulePdfIngestJob } = await import(
      "@/lib/pdf-ingest-draft.server"
    );

    const bytes = Buffer.from(data.fileBase64, "base64");
    const maxUpload = await getOrgMaxUploadBytes(supabaseAdmin, data.orgId);
    const hardCap = Math.min(maxUpload, pdfParseMaxBytes());
    if (bytes.byteLength > hardCap) {
      throw new Error(
        `This PDF exceeds the AI parse limit (${formatBytesShort(hardCap)}). Split the file or ask an admin to raise the cap.`,
      );
    }

    const scan = await scanBytesWithClamav(bytes);
    if (!scan.clean) {
      throw new Error(`Malware scan failed: ${scan.detail}`);
    }

    try {
      const draft = await createProcessingPdfDraft({
        orgId: data.orgId,
        source: data.source,
        fileName: data.fileName,
        bytes,
        createdBy: context.userId,
        connectorId: data.connectorId ?? null,
        targetDatasetId: data.targetDatasetId ?? null,
      });
      schedulePdfIngestJob(draft.id, data.orgId);
      return {
        draftId: draft.id,
        status: draft.status as "processing",
        scanDetail: scan.detail,
      };
    } catch (err) {
      logServerError("pdf-ingest", `startPdfIngest failed for "${data.fileName}"`, err, {
        orgId: data.orgId,
        bytes: bytes.byteLength,
      });
      throw new Error(toUserFacingMessage(err, "Could not start PDF parsing."));
    }
  });

/** @deprecated Prefer startPdfIngest + polling; kept for older clients. */
export const parsePdfForIngest = startPdfIngest;

export const listPdfIngestDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertOrgEditor(data.orgId, context.userId);
    const { listPendingPdfDrafts } = await import("@/lib/pdf-ingest-draft.server");
    const drafts = await listPendingPdfDrafts(data.orgId);
    return drafts.map(
      (d): DraftSummary => ({
        id: d.id,
        source: d.source,
        status: d.status,
        file_name: d.file_name,
        ai_model: d.ai_model,
        page_count: d.page_count,
        confidence: d.confidence,
        sheet_count: d.parsed_workbook?.sheets?.length ?? 0,
        table_count: d.structure_snapshot?.tables?.length ?? d.parsed_workbook?.sheets?.length ?? 0,
        parse_error: d.parse_error,
        target_dataset_id: d.target_dataset_id,
        connector_id: d.connector_id,
        email_message_id: d.email_message_id,
        created_at: d.created_at,
      }),
    );
  });

export const getPdfIngestDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), draftId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOrgEditor(data.orgId, context.userId);
    const { getPdfIngestDraft } = await import("@/lib/pdf-ingest-draft.server");
    const draft = await getPdfIngestDraft(data.draftId, data.orgId);
    if (!draft) throw new Error("PDF draft not found");
    return draft;
  });

export const savePdfDraftStructureFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        draftId: z.string().uuid(),
        structure: z.custom<PdfStructureSnapshot>(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOrgEditor(data.orgId, context.userId);
    const { savePdfDraftStructure } = await import("@/lib/pdf-ingest-draft.server");
    return savePdfDraftStructure({
      draftId: data.draftId,
      orgId: data.orgId,
      structure: data.structure,
    });
  });

export const approvePdfStructureFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        draftId: z.string().uuid(),
        structure: z.custom<PdfStructureSnapshot>(),
        saveTemplate: z
          .object({
            name: z.string().min(1),
            description: z.string().optional(),
            fileNamePattern: z.string().optional(),
            connectorId: z.string().uuid().nullable().optional(),
          })
          .nullable()
          .optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOrgEditor(data.orgId, context.userId);
    const { approvePdfStructureAndExtract } = await import("@/lib/pdf-ingest-draft.server");
    return approvePdfStructureAndExtract({
      draftId: data.draftId,
      orgId: data.orgId,
      userId: context.userId,
      structure: data.structure,
      saveTemplate: data.saveTemplate ?? null,
    });
  });

export const listPdfTemplatesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertOrgEditor(data.orgId, context.userId);
    const { listPdfIngestTemplates } = await import("@/lib/pdf-templates.server");
    return listPdfIngestTemplates(data.orgId);
  });

export const savePdfDraftWorkbook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        draftId: z.string().uuid(),
        workbook: z.custom<ParsedWorkbook>(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOrgEditor(data.orgId, context.userId);
    const { updatePdfDraftWorkbook } = await import("@/lib/pdf-ingest-draft.server");
    return updatePdfDraftWorkbook({
      draftId: data.draftId,
      orgId: data.orgId,
      workbook: data.workbook,
      userId: context.userId,
    });
  });

export const rejectPdfDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        draftId: z.string().uuid(),
        reason: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOrgEditor(data.orgId, context.userId);
    const { rejectPdfIngestDraft } = await import("@/lib/pdf-ingest-draft.server");
    await rejectPdfIngestDraft({
      draftId: data.draftId,
      orgId: data.orgId,
      userId: context.userId,
      reason: data.reason,
    });
    return { ok: true as const };
  });

const publishFromDraftSchema = z.object({
  orgId: z.string().uuid(),
  draftId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(z.custom<PublishField>()),
  sheets: z.array(z.custom<PublishSheet>()),
  loadMode: z.enum(["full", "incremental"]),
  apiAccess: z.enum(["secure", "public"]).optional(),
  datasetId: z.string().uuid().optional(),
  emailTemplateSchema: z.custom<TemplateSchema>().optional(),
});

export const publishPdfDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => publishFromDraftSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertOrgEditor(data.orgId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPdfIngestDraft, markPdfDraftAccepted } = await import("@/lib/pdf-ingest-draft.server");
    const { publishVersionServer } = await import("@/lib/publish.server");
    const { validateAttachmentAgainstTemplate } = await import("@/lib/email-template-validation");

    const draft = await getPdfIngestDraft(data.draftId, data.orgId);
    if (!draft) throw new Error("PDF draft not found");
    if (draft.status !== "pending_review") {
      throw new Error(`PDF draft is ${draft.status}, not pending_review`);
    }

    const workbook = (() => {
      if (!draft.parsed_workbook?.sheets?.length) {
        throw new Error("PDF draft has no parsed tables yet");
      }
      return data.sheets.length
        ? reconstructWorkbookFromPublish(draft.parsed_workbook, data.sheets)
        : draft.parsed_workbook;
    })();

    const totalRows = workbook.sheets.reduce((n, s) => n + (s.rowCount ?? s.rows?.length ?? 0), 0);
    const conf = draft.confidence as { sheets?: { flags?: string[] }[] } | null;
    const flags = (conf?.sheets ?? []).flatMap((s) => s.flags ?? []);
    const sampleOnly =
      totalRows > 0 &&
      totalRows <= PDF_STRUCTURE_SAMPLE_ROWS &&
      (flags.some((f) =>
        ["fragment_only", "structure_only", "extract_failed_used_samples", "text_fallback"].includes(
          f,
        ),
      ) ||
        draft.ai_model === "text-fallback" ||
        draft.parse_phase === "structure");
    if (sampleOnly) {
      throw new Error(
        `This PDF only has ${totalRows} sample row(s) — full data was never loaded. Go back to Structure, click Approve & load data, then publish.`,
      );
    }

    let emailTemplateSchema = data.emailTemplateSchema;
    if (!emailTemplateSchema && draft.email_message_id) {
      const { data: msg } = await supabaseAdmin
        .from("email_ingest_messages")
        .select("template_id")
        .eq("id", draft.email_message_id)
        .maybeSingle();
      const templateId = (msg as { template_id?: string } | null)?.template_id;
      if (templateId) {
        const { data: tmpl } = await supabaseAdmin
          .from("email_ingest_templates")
          .select("schema_snapshot")
          .eq("id", templateId)
          .maybeSingle();
        const snap = (tmpl as { schema_snapshot?: TemplateSchema } | null)?.schema_snapshot;
        if (snap) emailTemplateSchema = snap;
      }
    }

    if (emailTemplateSchema) {
      const validation = validateAttachmentAgainstTemplate(workbook, emailTemplateSchema);
      if (!validation.ok) {
        throw new Error(`Template schema mismatch: ${validation.reason}`);
      }
    }

    const { data: membership } = await context.supabase
      .from("org_members")
      .select("accepted_invite_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();

    const published = await publishVersionServer({
      orgId: data.orgId,
      datasetId: data.datasetId ?? draft.target_dataset_id ?? undefined,
      name: data.name,
      description: data.description,
      fields: data.fields,
      sheets: data.sheets,
      loadMode: data.loadMode,
      hasMacros: false,
      fileName: draft.file_name,
      apiAccess: data.apiAccess,
      userId: context.userId,
      fileBytes: null,
      inviteId: (membership as { accepted_invite_id?: string | null } | null)?.accepted_invite_id ?? null,
    });

    await markPdfDraftAccepted({
      draftId: draft.id,
      orgId: data.orgId,
      userId: context.userId,
      datasetId: published.datasetId,
      versionId: published.versionId,
    });

    if (draft.email_message_id) {
      await supabaseAdmin
        .from("email_ingest_messages")
        .update({
          status: "ingested",
          dataset_id: published.datasetId,
          version_id: published.versionId,
          processed_at: new Date().toISOString(),
          ingest_error: null,
        } as never)
        .eq("id", draft.email_message_id);
    }

    return published;
  });

function reconstructWorkbookFromPublish(
  original: ParsedWorkbook,
  sheets: PublishSheet[],
): ParsedWorkbook {
  const included = new Set(sheets.filter((s) => s.included).map((s) => s.name));
  return {
    ...original,
    sheets: original.sheets.filter((s) => included.has(s.name)),
  };
}
