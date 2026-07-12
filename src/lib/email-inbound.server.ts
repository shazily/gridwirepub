/**
 * Inbound email processing — sender/template allowlists, schema validation, audit trail.
 */

import { logSystemAuditEvent } from "@/lib/audit.server";
import { scanBytesWithClamav } from "@/lib/clamav.server";
import {
  importEmailIngestMessage,
  storeEmailAttachment,
} from "@/lib/email-ingest-import.server";
import {
  validateAttachmentAgainstTemplate,
  findMatchingIngestTemplate,
  type TemplateSchema,
} from "@/lib/email-template-validation";
import { parseWorkbookFromBuffer } from "@/lib/spreadsheet";
import { isPdfFileName } from "@/lib/ingest-parse";
import {
  assertPdfIngestCapacity,
  createPdfIngestDraft,
  raisePdfReadyAlert,
} from "@/lib/pdf-ingest-draft.server";
import { findMatchingPdfTemplate } from "@/lib/pdf-templates.server";
import { getOrgMaxRowsPerSheet, getOrgMaxUploadBytes } from "@/lib/quota.server";
import { logServer, logServerError } from "@/lib/user-facing-error";

type InboundAttachment = {
  name: string;
  contentType: string;
  contentBase64: string;
};

const ALLOWED_EXT = [".xlsx", ".xls", ".csv", ".pdf"];

/** Upper-bound decoded byte size without allocating the full buffer. */
function estimatedBase64DecodedBytes(base64: string): number {
  const trimmed = base64.trim();
  if (!trimmed) return 0;
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
}

function senderAllowed(from: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.startsWith("@")) return from.endsWith(p.toLowerCase());
    return from === p.toLowerCase();
  });
}

async function scanAttachment(name: string, bytes: Buffer): Promise<{ clean: boolean; detail?: string }> {
  const result = await scanBytesWithClamav(bytes);
  if (!result.clean) {
    return { clean: false, detail: `${name}: ${result.detail}` };
  }
  return { clean: true, detail: result.detail };
}

async function rejectMessage(
  msgId: string,
  orgId: string | null,
  status: string,
  reason: string,
  auditAction: string,
  metadata: Record<string, unknown>,
  notify?: { from: string; subject?: string | null; attachmentName?: string | null },
): Promise<{ status: string; messageId: string; detail: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("email_ingest_messages")
    .update({ status, rejection_reason: reason })
    .eq("id", msgId);
  if (orgId) {
    await logSystemAuditEvent({
      orgId,
      action: auditAction,
      resourceType: "email_ingest_message",
      resourceId: msgId,
      metadata: { status, reason, ...metadata },
    });
    if (notify) {
      const { notifyEmailIngestOutcome } = await import("@/lib/notifications.server");
      await notifyEmailIngestOutcome({
        orgId,
        status,
        fromAddress: notify.from,
        subject: notify.subject,
        attachmentName: notify.attachmentName,
        detail: reason,
      });
    }
  }
  return { status, messageId: msgId, detail: reason };
}

export async function processInboundPostmarkEmail(args: {
  from: string;
  subject: string;
  externalId?: string;
  mailboxHash?: string;
  orgId?: string;
  attachments: InboundAttachment[];
  testMode?: boolean;
}): Promise<{ status: string; messageId?: string; detail?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let orgId: string | null = args.orgId ?? null;
  if (!orgId && args.mailboxHash) {
    const { data: mb } = await supabaseAdmin
      .from("email_ingest_mailboxes")
      .select("org_id, enabled")
      .eq("inbound_address", args.mailboxHash)
      .maybeSingle();
    if (mb?.enabled) orgId = mb.org_id;
  }

  if (!orgId) {
    const { data: enabledMailboxes } = await supabaseAdmin
      .from("email_ingest_mailboxes")
      .select("org_id")
      .eq("enabled", true)
      .limit(1);
    orgId = enabledMailboxes?.[0]?.org_id ?? null;
  }

  const { data: msgRow, error: msgErr } = await supabaseAdmin
    .from("email_ingest_messages")
    .insert({
      org_id: orgId,
      from_address: args.from || "unknown",
      subject: args.subject,
      external_id: args.externalId ?? (args.testMode ? `test-${Date.now()}` : undefined),
      status: "received",
    })
    .select("id")
    .single();
  if (msgErr) throw new Error(msgErr.message);

  if (!orgId) {
    return rejectMessage(msgRow.id, null, "rejected_no_mailbox", "No matching enabled mailbox", "email_ingest.rejected", {
      from: args.from,
    });
  }

  await logSystemAuditEvent({
    orgId,
    action: "email_ingest.received",
    resourceType: "email_ingest_message",
    resourceId: msgRow.id,
    metadata: { from: args.from, subject: args.subject, test_mode: args.testMode ?? false },
  });

  const { data: senders } = await supabaseAdmin
    .from("email_ingest_sender_allowlist")
    .select("email_pattern")
    .eq("org_id", orgId);
  const senderPatterns = (senders ?? []).map((s) => s.email_pattern);
  const attachmentNames = args.attachments.map((a) => a.name);
  const ingestNotify = {
    from: args.from,
    subject: args.subject,
    attachmentName: attachmentNames[0] ?? null,
  };

  if (!senderAllowed(args.from, senderPatterns)) {
    return rejectMessage(
      msgRow.id,
      orgId,
      "rejected_sender",
      `Sender not allowlisted: ${args.from}`,
      "email_ingest.rejected_sender",
      { from: args.from },
      ingestNotify,
    );
  }

  const excelAttachments = args.attachments.filter((a) =>
    ALLOWED_EXT.some((ext) => a.name.toLowerCase().endsWith(ext)),
  );
  if (excelAttachments.length === 0) {
    return rejectMessage(
      msgRow.id,
      orgId,
      "rejected_no_attachment",
      "No Excel/CSV/PDF attachment",
      "email_ingest.rejected_no_attachment",
      {},
      ingestNotify,
    );
  }

  const primary = excelAttachments[0]!;
  const maxUploadBytes = await getOrgMaxUploadBytes(supabaseAdmin, orgId);
  const maxRowsPerSheet = await getOrgMaxRowsPerSheet(supabaseAdmin, orgId);

  for (const att of excelAttachments) {
    const estimatedBytes = estimatedBase64DecodedBytes(att.contentBase64);
    if (estimatedBytes > maxUploadBytes) {
      return rejectMessage(
        msgRow.id,
        orgId,
        "rejected_attachment_too_large",
        `Attachment exceeds org upload limit (${maxUploadBytes} bytes)`,
        "email_ingest.rejected_size",
        { attachment: att.name, estimated_bytes: estimatedBytes, limit_bytes: maxUploadBytes },
        { ...ingestNotify, attachmentName: att.name },
      );
    }
  }

  const bytes = Buffer.from(primary.contentBase64, "base64");
  ingestNotify.attachmentName = primary.name;
  let scanDetail = "scan_skipped";

  for (const att of excelAttachments) {
    const attBytes = Buffer.from(att.contentBase64, "base64");
    const scan = await scanAttachment(att.name, attBytes);
    scanDetail = scan.detail ?? scanDetail;
    if (!scan.clean) {
      return rejectMessage(
        msgRow.id,
        orgId,
        "quarantined",
        scan.detail ?? "infected",
        "email_ingest.quarantined",
        { attachment: att.name },
        { ...ingestNotify, attachmentName: att.name },
      );
    }
  }

  // PDFs: only when a curated PDF structure template matches the filename.
  // No structure discovery and no one-shot AI parse on email.
  if (isPdfFileName(primary.name)) {
    const pdfTemplate = await findMatchingPdfTemplate({
      orgId,
      fileName: primary.name,
    });
    if (!pdfTemplate) {
      return rejectMessage(
        msgRow.id,
        orgId,
        "rejected_template",
        `No curated PDF structure template matches "${primary.name}". Upload the PDF in the portal once, approve structure, and save a template — then email ingest can reuse it.`,
        "email_ingest.rejected_pdf_template",
        { attachment: primary.name },
        ingestNotify,
      );
    }

    try {
      await assertPdfIngestCapacity(orgId, bytes.byteLength);
      const { extractPdfDataWithStructure } = await import("@/lib/pdf-parse.ai.server");
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const extracted = await extractPdfDataWithStructure(
        ab,
        primary.name,
        pdfTemplate.structure_snapshot,
        { maxRowsPerSheet, orgId },
      );

      let storageRef: string | null = null;
      try {
        storageRef = await storeEmailAttachment({
          orgId,
          messageId: msgRow.id,
          fileName: primary.name,
          bytes,
        });
      } catch {
        // best-effort
      }

      const draft = await createPdfIngestDraft({
        orgId,
        source: "email",
        fileName: primary.name,
        workbook: extracted.workbook,
        meta: extracted.meta,
        bytes,
        emailMessageId: msgRow.id,
        targetDatasetId: pdfTemplate.target_dataset_id,
      });

      await supabaseAdmin
        .from("pdf_ingest_drafts" as never)
        .update({
          template_id: pdfTemplate.id,
          structure_snapshot: pdfTemplate.structure_snapshot as never,
        } as never)
        .eq("id", draft.id);

      await supabaseAdmin
        .from("email_ingest_messages")
        .update({
          status: "pending_pdf_review",
          rejection_reason: null,
          template_id: null,
          attachment_name: primary.name,
          scan_detail: scanDetail,
          attachment_storage_ref: storageRef,
        })
        .eq("id", msgRow.id);

      await raisePdfReadyAlert({
        orgId,
        draftId: draft.id,
        fileName: primary.name,
        source: "email",
        kind: "data",
      });

      await logSystemAuditEvent({
        orgId,
        action: "pdf_ingest.received",
        resourceType: "pdf_ingest_draft",
        resourceId: draft.id,
        actorLabel: "system:email-ingest",
        metadata: {
          message_id: msgRow.id,
          pdf_template_id: pdfTemplate.id,
          pdf_template_name: pdfTemplate.name,
          file_name: primary.name,
          draft_id: draft.id,
          sheet_count: extracted.workbook.sheets.length,
        },
      });

      logServer("email-ingest", "info", `PDF email matched template "${pdfTemplate.name}"`, {
        orgId,
        draftId: draft.id,
        fileName: primary.name,
        templateId: pdfTemplate.id,
      });

      return {
        status: "pending_pdf_review",
        messageId: msgRow.id,
        detail: `PDF matched template "${pdfTemplate.name}" — staged for review (${draft.id})`,
      };
    } catch (err) {
      logServerError("email-ingest", `PDF email extract failed for "${primary.name}"`, err, {
        orgId,
        templateId: pdfTemplate.id,
      });
      return rejectMessage(
        msgRow.id,
        orgId,
        "rejected_parse_error",
        err instanceof Error
          ? err.message
          : "Could not extract PDF tables using the curated structure template",
        "email_ingest.rejected_parse",
        { attachment: primary.name, pdf_template_id: pdfTemplate.id },
        ingestNotify,
      );
    }
  }

  const { data: templates } = await supabaseAdmin
    .from("email_ingest_templates")
    .select("*")
    .eq("org_id", orgId)
    .eq("active", true);

  const { template: matchedTemplate, rejectionDetail } = findMatchingIngestTemplate(
    templates ?? [],
    args.subject,
    attachmentNames,
  );

  if (!matchedTemplate) {
    return rejectMessage(
      msgRow.id,
      orgId,
      "rejected_template",
      rejectionDetail || "No matching ingest template",
      "email_ingest.rejected_template",
      { subject: args.subject, attachments: attachmentNames },
      ingestNotify,
    );
  }

  const schema = (matchedTemplate.schema_snapshot ?? {}) as TemplateSchema;
  if (!schema.columns?.length) {
    return rejectMessage(
      msgRow.id,
      orgId,
      "rejected_template",
      "Template has no uploaded column schema",
      "email_ingest.rejected_template",
      { template_id: matchedTemplate.id },
      ingestNotify,
    );
  }

  let parsed;
  try {
    parsed = parseWorkbookFromBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      primary.name,
      { maxRowsPerSheet },
    );
  } catch {
    return rejectMessage(
      msgRow.id,
      orgId,
      "rejected_parse_error",
      "Could not parse attachment as spreadsheet",
      "email_ingest.rejected_parse",
      { attachment: primary.name },
      ingestNotify,
    );
  }

  const validation = validateAttachmentAgainstTemplate(parsed, schema);
  if (!validation.ok) {
    return rejectMessage(
      msgRow.id,
      orgId,
      "rejected_schema_mismatch",
      validation.reason,
      "email_ingest.rejected_schema",
      {
        template_id: matchedTemplate.id,
        missing: validation.missing,
        extra: validation.extra,
        attachment: primary.name,
      },
      ingestNotify,
    );
  }

  await supabaseAdmin
    .from("email_ingest_messages")
    .update({
      status: "accepted_pending_ingest",
      rejection_reason: null,
      template_id: matchedTemplate.id,
      attachment_name: primary.name,
      scan_detail: scanDetail,
    })
    .eq("id", msgRow.id);

  let storageRef: string | null = null;
  try {
    storageRef = await storeEmailAttachment({
      orgId,
      messageId: msgRow.id,
      fileName: primary.name,
      bytes,
    });
    if (storageRef) {
      await supabaseAdmin
        .from("email_ingest_messages")
        .update({ attachment_storage_ref: storageRef })
        .eq("id", msgRow.id);
    }
  } catch {
    // Storage is best-effort; import can proceed from memory buffer.
  }

  const importResult = await importEmailIngestMessage({
    messageId: msgRow.id,
    orgId,
    template: matchedTemplate,
    fileName: primary.name,
    bytes,
    parsed,
  });

  const finalStatus = importResult.ok ? "ingested" : "ingest_failed";
  await supabaseAdmin
    .from("email_ingest_messages")
    .update({
      status: finalStatus,
      dataset_id: importResult.ok ? importResult.datasetId : null,
      version_id: importResult.ok ? importResult.versionId : null,
      ingest_error: importResult.ok ? null : importResult.error,
      processed_at: new Date().toISOString(),
    })
    .eq("id", msgRow.id);

  await logSystemAuditEvent({
    orgId,
    action: importResult.ok ? "email_ingest.accepted" : "email_ingest.import_failed",
    resourceType: "email_ingest_message",
    resourceId: msgRow.id,
    metadata: {
      template_id: matchedTemplate.id,
      template_name: matchedTemplate.name,
      attachment: primary.name,
      sheet: validation.sheetName,
      test_mode: args.testMode ?? false,
      dataset_id: importResult.ok ? importResult.datasetId : undefined,
      version_no: importResult.ok ? importResult.versionNo : undefined,
      error: importResult.ok ? undefined : importResult.error,
    },
  });

  const { notifyEmailIngestOutcome } = await import("@/lib/notifications.server");
  await notifyEmailIngestOutcome({
    orgId,
    status: finalStatus,
    fromAddress: args.from,
    subject: args.subject,
    attachmentName: primary.name,
    detail: importResult.ok ? undefined : importResult.error,
    datasetId: importResult.ok ? importResult.datasetId : null,
  });

  if (!importResult.ok) {
    return { status: finalStatus, messageId: msgRow.id, detail: importResult.error };
  }

  return {
    status: finalStatus,
    messageId: msgRow.id,
    detail: `dataset:${importResult.datasetId}:v${importResult.versionNo}`,
  };
}
