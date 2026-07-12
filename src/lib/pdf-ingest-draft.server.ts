/**
 * Persist AI PDF parses as drafts until a human accepts them for publish.
 * Flow: processing (structure) → pending_structure → extracting → pending_review → accepted.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logSystemAuditEvent, logUserAuditEvent } from "@/lib/audit.server";
import type { IngestParseMeta, PdfParseConfidence } from "@/lib/ingest-file-types";
import { hashPdfBytes } from "@/lib/pdf-parse.ai.server";
import {
  formatBytesShort,
  pdfParseMaxBytes,
  pdfParseMaxConcurrentPerOrg,
  pdfParseStaleMs,
} from "@/lib/pdf-parse-limits.server";
import {
  includedStructureTables,
  normalizeStructureSnapshot,
  workbookFromStructure,
  type PdfStructureSnapshot,
} from "@/lib/pdf-structure";
import { getObjectBytes, putObject, storageEnabled, type StorageProfile } from "@/lib/storage.server";
import type { ParsedWorkbook } from "@/lib/spreadsheet";
import type { Json } from "@/integrations/supabase/types";
import { logServer, logServerError } from "@/lib/user-facing-error";

export type PdfIngestSource = "upload" | "email" | "connector";
export type PdfIngestStatus =
  | "processing"
  | "pending_structure"
  | "extracting"
  | "pending_review"
  | "accepted"
  | "rejected"
  | "failed";

export type PdfIngestDraftRow = {
  id: string;
  org_id: string;
  source: PdfIngestSource;
  status: PdfIngestStatus;
  file_name: string;
  file_storage_ref: string | null;
  file_bytes_hash: string | null;
  parsed_workbook: ParsedWorkbook | null;
  structure_snapshot: PdfStructureSnapshot | null;
  template_id: string | null;
  parse_phase: "structure" | "extract";
  confidence: PdfParseConfidence | Record<string, unknown>;
  ai_model: string | null;
  page_count: number | null;
  parse_error: string | null;
  parse_started_at: string | null;
  parse_finished_at: string | null;
  email_message_id: string | null;
  connector_id: string | null;
  target_dataset_id: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  dataset_id: string | null;
  version_id: string | null;
  created_at: string;
  updated_at: string;
};

/** In-process byte staging when object storage is unavailable (survives client disconnect, not portal restart). */
const pendingPdfBytes = new Map<string, Buffer>();

export function stashPdfDraftBytes(draftId: string, bytes: Buffer): void {
  pendingPdfBytes.set(draftId, bytes);
}

export function takeStashedPdfDraftBytes(draftId: string): Buffer | null {
  const buf = pendingPdfBytes.get(draftId) ?? null;
  pendingPdfBytes.delete(draftId);
  return buf;
}

export function peekStashedPdfDraftBytes(draftId: string): Buffer | null {
  return pendingPdfBytes.get(draftId) ?? null;
}

function emptyWorkbook(fileName: string): ParsedWorkbook {
  return { sheets: [], hasMacros: false, fileName };
}

async function orgStorageProfile(orgId: string): Promise<StorageProfile> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("storage_config")
    .eq("id", orgId)
    .maybeSingle();
  return ((data as { storage_config?: StorageProfile } | null)?.storage_config ?? {}) as StorageProfile;
}

export async function storePdfDraftBytes(opts: {
  orgId: string;
  draftId: string;
  fileName: string;
  bytes: Buffer;
}): Promise<string | null> {
  if (!storageEnabled()) return null;
  const profile = await orgStorageProfile(opts.orgId);
  const safeName = opts.fileName.replace(/[^\w.\-]+/g, "_") || "upload.pdf";
  return putObject(
    { orgId: opts.orgId, profile },
    ["pdf-drafts", opts.draftId, safeName],
    opts.bytes,
    "application/pdf",
  );
}

export async function loadPdfDraftBytes(opts: {
  orgId: string;
  draftId: string;
  fileStorageRef: string | null;
}): Promise<Buffer | null> {
  const stashed = peekStashedPdfDraftBytes(opts.draftId);
  if (stashed) return stashed;
  if (!opts.fileStorageRef || !storageEnabled()) return null;
  const profile = await orgStorageProfile(opts.orgId);
  return getObjectBytes(opts.fileStorageRef, profile);
}

export async function countProcessingPdfDrafts(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", ["processing", "extracting"]);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Fail stuck processing/extracting jobs so they do not block the concurrency budget forever. */
export async function failStalePdfProcessingDrafts(orgId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - pdfParseStaleMs()).toISOString();
  let q = supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .update({
      status: "failed",
      parse_error: "PDF parsing timed out or the server restarted mid-job. Please upload again.",
      parse_finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .in("status", ["processing", "extracting"])
    .lt("parse_started_at", cutoff);
  if (orgId) q = q.eq("org_id", orgId);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return (data as { id: string }[] | null)?.length ?? 0;
}

export async function assertPdfIngestCapacity(orgId: string, byteLength: number): Promise<void> {
  const hardCap = pdfParseMaxBytes();
  if (byteLength > hardCap) {
    throw new Error(
      `This PDF is too large for AI parsing (max ${formatBytesShort(hardCap)}). Split the document or raise PDF_PARSE_MAX_BYTES.`,
    );
  }
  await failStalePdfProcessingDrafts(orgId);
  const active = await countProcessingPdfDrafts(orgId);
  const max = pdfParseMaxConcurrentPerOrg();
  if (active >= max) {
    throw new Error(
      `This workspace already has ${active} PDF parse job${active === 1 ? "" : "s"} running (limit ${max}). Wait for one to finish, or open PDF reviews.`,
    );
  }
}

export async function createProcessingPdfDraft(opts: {
  orgId: string;
  source: PdfIngestSource;
  fileName: string;
  bytes: Buffer;
  createdBy?: string | null;
  connectorId?: string | null;
  targetDatasetId?: string | null;
  emailMessageId?: string | null;
}): Promise<PdfIngestDraftRow> {
  await assertPdfIngestCapacity(opts.orgId, opts.bytes.byteLength);
  const fileHash = hashPdfBytes(opts.bytes);
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .insert({
      org_id: opts.orgId,
      source: opts.source,
      status: "processing",
      parse_phase: "structure",
      file_name: opts.fileName,
      file_bytes_hash: fileHash,
      parsed_workbook: emptyWorkbook(opts.fileName) as unknown as Json,
      structure_snapshot: null,
      confidence: {} as unknown as Json,
      created_by: opts.createdBy ?? null,
      connector_id: opts.connectorId ?? null,
      target_dataset_id: opts.targetDatasetId ?? null,
      email_message_id: opts.emailMessageId ?? null,
      parse_started_at: now,
      updated_at: now,
    } as never)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not create PDF draft record. Please try again.");
  const row = data as unknown as PdfIngestDraftRow;

  stashPdfDraftBytes(row.id, opts.bytes);
  try {
    const ref = await storePdfDraftBytes({
      orgId: opts.orgId,
      draftId: row.id,
      fileName: opts.fileName,
      bytes: opts.bytes,
    });
    if (ref) {
      await supabaseAdmin
        .from("pdf_ingest_drafts" as never)
        .update({ file_storage_ref: ref, updated_at: new Date().toISOString() } as never)
        .eq("id", row.id);
      row.file_storage_ref = ref;
    }
  } catch (err) {
    logServer("pdf-ingest", "warn", `Could not store PDF bytes for draft ${row.id}`, {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (opts.createdBy) {
    await logUserAuditEvent({
      orgId: opts.orgId,
      userId: opts.createdBy,
      action: "pdf_ingest.queued",
      resourceType: "pdf_ingest_draft",
      resourceId: row.id,
      metadata: {
        source: opts.source,
        file_name: opts.fileName,
        bytes: opts.bytes.byteLength,
      },
    });
  }

  return row;
}

export async function createPdfIngestDraft(opts: {
  orgId: string;
  source: PdfIngestSource;
  fileName: string;
  workbook: ParsedWorkbook;
  meta: IngestParseMeta;
  bytes?: Buffer | ArrayBuffer | null;
  createdBy?: string | null;
  emailMessageId?: string | null;
  connectorId?: string | null;
  targetDatasetId?: string | null;
}): Promise<PdfIngestDraftRow> {
  const bytesBuf = opts.bytes
    ? Buffer.isBuffer(opts.bytes)
      ? opts.bytes
      : Buffer.from(opts.bytes)
    : null;
  const fileHash = bytesBuf ? hashPdfBytes(bytesBuf) : null;
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .insert({
      org_id: opts.orgId,
      source: opts.source,
      status: "pending_review",
      file_name: opts.fileName,
      file_bytes_hash: fileHash,
      parsed_workbook: opts.workbook as unknown as Json,
      confidence: (opts.meta.confidence ?? {}) as unknown as Json,
      ai_model: opts.meta.aiModel ?? null,
      page_count: opts.meta.pageCount ?? opts.meta.confidence?.pageCount ?? null,
      email_message_id: opts.emailMessageId ?? null,
      connector_id: opts.connectorId ?? null,
      target_dataset_id: opts.targetDatasetId ?? null,
      created_by: opts.createdBy ?? null,
      parse_started_at: now,
      parse_finished_at: now,
    } as never)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not create PDF draft record. Please try again.");
  const row = data as unknown as PdfIngestDraftRow;

  if (bytesBuf) {
    try {
      const ref = await storePdfDraftBytes({
        orgId: opts.orgId,
        draftId: row.id,
        fileName: opts.fileName,
        bytes: bytesBuf,
      });
      if (ref) {
        await supabaseAdmin
          .from("pdf_ingest_drafts" as never)
          .update({ file_storage_ref: ref, updated_at: new Date().toISOString() } as never)
          .eq("id", row.id);
        row.file_storage_ref = ref;
      }
    } catch {
      // Storage is best-effort; draft still holds parsed workbook JSON.
    }
  }

  if (opts.createdBy) {
    await logUserAuditEvent({
      orgId: opts.orgId,
      userId: opts.createdBy,
      action: "pdf_ingest.parsed",
      resourceType: "pdf_ingest_draft",
      resourceId: row.id,
      metadata: {
        source: opts.source,
        file_name: opts.fileName,
        ai_model: opts.meta.aiModel,
        page_count: opts.meta.pageCount,
        sheet_count: opts.workbook.sheets.length,
      },
    });
  } else {
    await logSystemAuditEvent({
      orgId: opts.orgId,
      action: "pdf_ingest.parsed",
      resourceType: "pdf_ingest_draft",
      resourceId: row.id,
      actorLabel: `system:pdf-${opts.source}`,
      metadata: {
        source: opts.source,
        file_name: opts.fileName,
        ai_model: opts.meta.aiModel,
        page_count: opts.meta.pageCount,
        sheet_count: opts.workbook.sheets.length,
      },
    });
  }

  return row;
}

export async function completePdfDraftStructure(opts: {
  draftId: string;
  orgId: string;
  structure: PdfStructureSnapshot;
  previewWorkbook: ParsedWorkbook;
  meta: IngestParseMeta;
}): Promise<PdfIngestDraftRow> {
  const structure = normalizeStructureSnapshot(opts.structure);
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .update({
      status: "pending_structure",
      parse_phase: "structure",
      structure_snapshot: structure as unknown as Json,
      parsed_workbook: opts.previewWorkbook as unknown as Json,
      confidence: (opts.meta.confidence ?? {}) as unknown as Json,
      ai_model: opts.meta.aiModel ?? null,
      page_count: opts.meta.pageCount ?? structure.page_count,
      parse_error: null,
      parse_finished_at: now,
      updated_at: now,
    } as never)
    .eq("id", opts.draftId)
    .eq("org_id", opts.orgId)
    .eq("status", "processing")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as unknown as PdfIngestDraftRow;

  // Idempotent: a concurrent job may have already advanced this draft.
  const existing = await getPdfIngestDraft(opts.draftId, opts.orgId);
  if (
    existing?.status === "pending_structure" ||
    existing?.status === "extracting" ||
    existing?.status === "pending_review"
  ) {
    logServer("pdf-ingest", "info", `completePdfDraftStructure: draft ${opts.draftId} already ${existing.status}`);
    return existing;
  }
  throw new Error(
    `Could not save PDF structure — draft is ${existing?.status ?? "missing"} (expected processing). Refresh or upload again.`,
  );
}

export async function completePdfDraftParse(opts: {
  draftId: string;
  orgId: string;
  workbook: ParsedWorkbook;
  meta: IngestParseMeta;
}): Promise<PdfIngestDraftRow> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .update({
      status: "pending_review",
      parse_phase: "extract",
      parsed_workbook: opts.workbook as unknown as Json,
      confidence: (opts.meta.confidence ?? {}) as unknown as Json,
      ai_model: opts.meta.aiModel ?? null,
      page_count: opts.meta.pageCount ?? opts.meta.confidence?.pageCount ?? null,
      parse_error: null,
      parse_finished_at: now,
      updated_at: now,
    } as never)
    .eq("id", opts.draftId)
    .eq("org_id", opts.orgId)
    .in("status", ["processing", "extracting"])
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    takeStashedPdfDraftBytes(opts.draftId);
    return data as unknown as PdfIngestDraftRow;
  }

  const existing = await getPdfIngestDraft(opts.draftId, opts.orgId);
  if (existing?.status === "pending_review" || existing?.status === "accepted") {
    logServer("pdf-ingest", "info", `completePdfDraftParse: draft ${opts.draftId} already ${existing.status}`);
    takeStashedPdfDraftBytes(opts.draftId);
    return existing;
  }
  throw new Error(
    `Could not save extracted PDF data — draft is ${existing?.status ?? "missing"} (expected extracting). Refresh or re-approve structure.`,
  );
}

export async function failPdfDraftParse(opts: {
  draftId: string;
  orgId: string;
  error: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .update({
      status: "failed",
      parse_error: opts.error.slice(0, 2000),
      parse_finished_at: now,
      updated_at: now,
    } as never)
    .eq("id", opts.draftId)
    .eq("org_id", opts.orgId)
    .in("status", ["processing", "extracting"]);
  takeStashedPdfDraftBytes(opts.draftId);
}

/** Background: structure discovery only → pending_structure. */
export async function processPdfIngestJob(draftId: string, orgId: string): Promise<void> {
  const draft = await getPdfIngestDraft(draftId, orgId);
  if (!draft) {
    logServer("pdf-ingest", "warn", `processPdfIngestJob: draft ${draftId} not found`);
    return;
  }
  if (draft.status !== "processing") {
    logServer("pdf-ingest", "info", `processPdfIngestJob: draft ${draftId} already ${draft.status}`);
    return;
  }

  logServer("pdf-ingest", "info", `Discovering PDF structure for draft ${draftId}`, {
    fileName: draft.file_name,
    orgId,
  });

  try {
    const bytes = await loadPdfDraftBytes({
      orgId,
      draftId,
      fileStorageRef: draft.file_storage_ref,
    });
    if (!bytes) {
      throw new Error(
        "PDF bytes are no longer available (server may have restarted). Please upload the file again.",
      );
    }

    const { discoverPdfStructureWithAi } = await import("@/lib/pdf-parse.ai.server");
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const result = await discoverPdfStructureWithAi(ab, draft.file_name, { orgId });

    const completed = await completePdfDraftStructure({
      draftId,
      orgId,
      structure: result.structure,
      previewWorkbook: result.previewWorkbook,
      meta: result.meta,
    });

    await raisePdfReadyAlert({
      orgId,
      draftId,
      fileName: draft.file_name,
      source: draft.source,
      kind: "structure",
    });

    if (draft.created_by) {
      await logUserAuditEvent({
        orgId,
        userId: draft.created_by,
        action: "pdf_ingest.structure_ready",
        resourceType: "pdf_ingest_draft",
        resourceId: draftId,
        metadata: {
          source: draft.source,
          file_name: draft.file_name,
          ai_model: result.meta.aiModel,
          page_count: result.meta.pageCount,
          table_count: result.structure.tables.length,
        },
      });
    }

    logServer("pdf-ingest", "info", `PDF draft ${draftId} ready for structure review`, {
      tables: completed.structure_snapshot?.tables?.length ?? 0,
      model: result.meta.aiModel,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logServerError("pdf-ingest", `PDF draft ${draftId} structure failed`, err, { orgId });
    await failPdfDraftParse({ draftId, orgId, error: message });
  }
}

export function schedulePdfIngestJob(draftId: string, orgId: string): void {
  void processPdfIngestJob(draftId, orgId).catch((err) => {
    logServerError("pdf-ingest", `Unhandled PDF job error for ${draftId}`, err, { orgId });
  });
}

/** Save curated structure and kick off full data extract. */
export async function approvePdfStructureAndExtract(opts: {
  draftId: string;
  orgId: string;
  userId: string;
  structure: PdfStructureSnapshot;
  saveTemplate?: {
    name: string;
    description?: string;
    fileNamePattern?: string;
    connectorId?: string | null;
  } | null;
}): Promise<PdfIngestDraftRow> {
  const structure = normalizeStructureSnapshot(opts.structure);
  if (includedStructureTables(structure).length === 0) {
    throw new Error("Include at least one table with columns before loading data.");
  }

  let templateId: string | null = null;
  if (opts.saveTemplate?.name?.trim()) {
    const { createPdfIngestTemplate } = await import("@/lib/pdf-templates.server");
    const tmpl = await createPdfIngestTemplate({
      orgId: opts.orgId,
      name: opts.saveTemplate.name,
      description: opts.saveTemplate.description,
      fileNamePattern: opts.saveTemplate.fileNamePattern,
      structure,
      connectorId: opts.saveTemplate.connectorId,
      createdBy: opts.userId,
    });
    templateId = tmpl.id;
  }

  const preview = workbookFromStructure(structure, "structure-preview.pdf");
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .update({
      status: "extracting",
      parse_phase: "extract",
      structure_snapshot: structure as unknown as Json,
      parsed_workbook: preview as unknown as Json,
      ...(templateId ? { template_id: templateId } : {}),
      parse_error: null,
      parse_started_at: now,
      parse_finished_at: null,
      updated_at: now,
    } as never)
    .eq("id", opts.draftId)
    .eq("org_id", opts.orgId)
    .eq("status", "pending_structure")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const existing = await getPdfIngestDraft(opts.draftId, opts.orgId);
    if (existing?.status === "extracting" || existing?.status === "pending_review") {
      logServer("pdf-ingest", "info", `approvePdfStructure: draft ${opts.draftId} already ${existing.status}`);
      return existing;
    }
    throw new Error(
      `Could not start data extract — draft is ${existing?.status ?? "missing"} (expected structure review). Refresh and try again.`,
    );
  }

  await logUserAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    action: "pdf_ingest.structure_approved",
    resourceType: "pdf_ingest_draft",
    resourceId: opts.draftId,
    metadata: {
      table_count: includedStructureTables(structure).length,
      template_id: templateId,
      template_saved: Boolean(templateId),
    },
  });

  schedulePdfExtractJob(opts.draftId, opts.orgId);
  return data as unknown as PdfIngestDraftRow;
}

export async function processPdfExtractJob(draftId: string, orgId: string): Promise<void> {
  const draft = await getPdfIngestDraft(draftId, orgId);
  if (!draft) {
    logServer("pdf-ingest", "warn", `processPdfExtractJob: draft ${draftId} not found`);
    return;
  }
  if (draft.status !== "extracting") {
    logServer("pdf-ingest", "info", `processPdfExtractJob: draft ${draftId} already ${draft.status}`);
    return;
  }

  const structure = draft.structure_snapshot
    ? normalizeStructureSnapshot(draft.structure_snapshot)
    : null;
  if (!structure || includedStructureTables(structure).length === 0) {
    await failPdfDraftParse({
      draftId,
      orgId,
      error: "Missing approved PDF structure for data extract.",
    });
    return;
  }

  try {
    const bytes = await loadPdfDraftBytes({
      orgId,
      draftId,
      fileStorageRef: draft.file_storage_ref,
    });
    if (!bytes) {
      throw new Error(
        "PDF bytes are no longer available (server may have restarted). Please upload the file again.",
      );
    }

    const { getOrgMaxRowsPerSheet } = await import("@/lib/quota.server");
    const { extractPdfDataWithStructure } = await import("@/lib/pdf-parse.ai.server");
    const maxRowsPerSheet = await getOrgMaxRowsPerSheet(supabaseAdmin, orgId);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const result = await extractPdfDataWithStructure(ab, draft.file_name, structure, {
      maxRowsPerSheet,
      orgId,
    });

    await completePdfDraftParse({
      draftId,
      orgId,
      workbook: result.workbook,
      meta: result.meta,
    });

    await raisePdfReadyAlert({
      orgId,
      draftId,
      fileName: draft.file_name,
      source: draft.source,
      kind: "data",
    });

    logServer("pdf-ingest", "info", `PDF draft ${draftId} data ready for publish review`, {
      sheets: result.workbook.sheets.length,
      model: result.meta.aiModel,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logServerError("pdf-ingest", `PDF draft ${draftId} extract failed`, err, { orgId });
    // Keep curated structure so the user can retry Approve & load data.
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("pdf_ingest_drafts" as never)
      .update({
        status: "pending_structure",
        parse_phase: "structure",
        parse_error: message.slice(0, 2000),
        parse_finished_at: now,
        updated_at: now,
      } as never)
      .eq("id", draftId)
      .eq("org_id", orgId)
      .eq("status", "extracting");
  }
}

export function schedulePdfExtractJob(draftId: string, orgId: string): void {
  void processPdfExtractJob(draftId, orgId).catch((err) => {
    logServerError("pdf-ingest", `Unhandled PDF extract error for ${draftId}`, err, { orgId });
  });
}

export async function savePdfDraftStructure(opts: {
  draftId: string;
  orgId: string;
  structure: PdfStructureSnapshot;
}): Promise<PdfIngestDraftRow> {
  const structure = normalizeStructureSnapshot(opts.structure);
  const preview = workbookFromStructure(structure, "structure-preview.pdf");
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .update({
      structure_snapshot: structure as unknown as Json,
      parsed_workbook: preview as unknown as Json,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", opts.draftId)
    .eq("org_id", opts.orgId)
    .eq("status", "pending_structure")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("Could not save structure — open the draft from PDF reviews and try again.");
  }
  return data as unknown as PdfIngestDraftRow;
}

export async function getPdfIngestDraft(draftId: string, orgId: string): Promise<PdfIngestDraftRow | null> {
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .select("*")
    .eq("id", draftId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as PdfIngestDraftRow) ?? null;
}

export async function listPendingPdfDrafts(orgId: string): Promise<PdfIngestDraftRow[]> {
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .select("*")
    .eq("org_id", orgId)
    .in("status", ["processing", "pending_structure", "extracting", "pending_review", "failed"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data as unknown as PdfIngestDraftRow[]) ?? [];
}

export async function updatePdfDraftWorkbook(opts: {
  draftId: string;
  orgId: string;
  workbook: ParsedWorkbook;
  userId: string;
}): Promise<PdfIngestDraftRow> {
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .update({
      parsed_workbook: opts.workbook as unknown as Json,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", opts.draftId)
    .eq("org_id", opts.orgId)
    .eq("status", "pending_review")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not update draft workbook — it may already be published.");
  return data as unknown as PdfIngestDraftRow;
}

export async function rejectPdfIngestDraft(opts: {
  draftId: string;
  orgId: string;
  userId: string;
  reason?: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .update({
      status: "rejected",
      reviewed_by: opts.userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: opts.reason ?? null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", opts.draftId)
    .eq("org_id", opts.orgId)
    .in("status", [
      "pending_review",
      "pending_structure",
      "processing",
      "extracting",
      "failed",
    ]);
  if (error) throw new Error(error.message);
  takeStashedPdfDraftBytes(opts.draftId);

  await logUserAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    action: "pdf_ingest.review_rejected",
    resourceType: "pdf_ingest_draft",
    resourceId: opts.draftId,
    metadata: { reason: opts.reason ?? null },
  });
}

export async function markPdfDraftAccepted(opts: {
  draftId: string;
  orgId: string;
  userId: string;
  datasetId: string;
  versionId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("pdf_ingest_drafts" as never)
    .update({
      status: "accepted",
      reviewed_by: opts.userId,
      reviewed_at: new Date().toISOString(),
      dataset_id: opts.datasetId,
      version_id: opts.versionId,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", opts.draftId)
    .eq("org_id", opts.orgId);
  if (error) throw new Error(error.message);

  await logUserAuditEvent({
    orgId: opts.orgId,
    userId: opts.userId,
    action: "pdf_ingest.review_accepted",
    resourceType: "pdf_ingest_draft",
    resourceId: opts.draftId,
    datasetId: opts.datasetId,
    metadata: { version_id: opts.versionId },
  });
}

export async function raisePdfReadyAlert(opts: {
  orgId: string;
  draftId: string;
  fileName: string;
  source: PdfIngestSource;
  kind?: "structure" | "data";
}): Promise<void> {
  const kind = opts.kind ?? "data";
  await supabaseAdmin.from("alert_events").insert({
    org_id: opts.orgId,
    event_type: "pdf_review",
    severity: "info",
    title: kind === "structure" ? "PDF structure ready" : "PDF data ready for review",
    body:
      kind === "structure"
        ? `AI discovered table layout in ${opts.fileName} (${opts.source}). Curate structure, then load data.`
        : `AI loaded table data from ${opts.fileName} (${opts.source}). Review before publishing.`,
    audience: "workspace",
  } as never);
}
