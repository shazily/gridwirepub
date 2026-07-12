/**
 * In-app notifications (all members) and email dispatch for email-ingest outcomes.
 * On rejection, also emails the original sender with the rejection reason.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emailDeliveryConfigured, sendEmail } from "@/lib/email.server";
import { INGEST_STATUS_LABELS } from "@/lib/ingest-email";

export type AlertAudience = "workspace" | "admins";

export function isEmailIngestSuccess(status: string): boolean {
  return status === "ingested" || status === "accepted_pending_ingest";
}

export function isEmailIngestFailure(status: string): boolean {
  return (
    status.startsWith("rejected") ||
    status === "quarantined" ||
    status === "ingest_failed"
  );
}

export function emailIngestSeverity(status: string): "info" | "warning" | "error" {
  if (isEmailIngestSuccess(status)) return "info";
  if (isEmailIngestFailure(status)) return "error";
  return "warning";
}

/** Pull a bare address from `Name <user@host>` or return trimmed input if it looks like an email. */
export function extractEmailAddress(fromHeader: string): string | null {
  const raw = fromHeader.trim();
  if (!raw) return null;
  const angled = raw.match(/<([^>\s]+@[^>\s]+)>/);
  if (angled?.[1]) return angled[1].toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw.toLowerCase();
  const loose = raw.match(/([^\s<>"]+@[^\s<>"]+)/);
  return loose?.[1]?.toLowerCase() ?? null;
}

function statusLabel(status: string): string {
  return INGEST_STATUS_LABELS[status] ?? status;
}

function ingestOutcomeBody(opts: {
  status: string;
  fromAddress: string;
  subject?: string | null;
  attachmentName?: string | null;
  detail?: string | null;
  datasetId?: string | null;
}): string {
  return [
    `Status: ${statusLabel(opts.status)} (${opts.status})`,
    opts.detail ? `Reason: ${opts.detail}` : null,
    `From: ${opts.fromAddress}`,
    opts.subject ? `Subject: ${opts.subject}` : null,
    opts.attachmentName ? `Attachment: ${opts.attachmentName}` : null,
    opts.datasetId ? `Dataset: ${opts.datasetId}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function senderRejectionBody(opts: {
  status: string;
  detail: string;
  subject?: string | null;
  attachmentName?: string | null;
}): string {
  return [
    "Your email to the Gridwire ingest address was not imported.",
    "",
    `Reason: ${opts.detail}`,
    `Status: ${statusLabel(opts.status)}`,
    opts.subject ? `Original subject: ${opts.subject}` : null,
    opts.attachmentName ? `Attachment: ${opts.attachmentName}` : null,
    "",
    "If this was a PDF, upload it once in the portal, approve the table structure, and save a PDF structure template that matches the filename — then email ingest can reuse that template.",
    "For spreadsheets, ensure your sender is allowlisted and an email ingest template matches the subject/attachment pattern.",
    "",
    "This is an automated message; replies are not monitored.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function insertAlertEvent(opts: {
  orgId: string;
  eventType: string;
  title: string;
  body?: string | null;
  severity?: "info" | "warning" | "error";
  audience?: AlertAudience;
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("alert_events")
    .insert({
      org_id: opts.orgId,
      event_type: opts.eventType,
      title: opts.title,
      body: opts.body ?? null,
      severity: opts.severity ?? "info",
      audience: opts.audience ?? "workspace",
      email_status: "skipped",
    })
    .select("id")
    .single();
  if (error) return null;
  return data.id;
}

/** Tell the original sender why their ingest email was rejected. */
export async function notifyEmailIngestSenderRejection(opts: {
  fromAddress: string;
  status: string;
  detail: string;
  subject?: string | null;
  attachmentName?: string | null;
}): Promise<void> {
  if (!isEmailIngestFailure(opts.status)) return;
  if (!emailDeliveryConfigured()) return;

  const to = extractEmailAddress(opts.fromAddress);
  if (!to) return;

  try {
    await sendEmail({
      to,
      subject: `[Gridwire] Ingest rejected: ${statusLabel(opts.status)}`,
      text: senderRejectionBody({
        status: opts.status,
        detail: opts.detail,
        subject: opts.subject,
        attachmentName: opts.attachmentName,
      }),
      purpose: "noreply",
      tag: "email-ingest-sender-reject",
    });
  } catch {
    // Best-effort — never block the ingest pipeline.
  }
}

export async function notifyEmailIngestOutcome(opts: {
  orgId: string;
  status: string;
  fromAddress: string;
  subject?: string | null;
  attachmentName?: string | null;
  detail?: string | null;
  datasetId?: string | null;
}): Promise<void> {
  const label = statusLabel(opts.status);
  const title = `Email ingest: ${label}`;
  const body = ingestOutcomeBody(opts);

  await insertAlertEvent({
    orgId: opts.orgId,
    eventType: isEmailIngestSuccess(opts.status) ? "email_ingest_success" : "email_ingest_failure",
    title,
    body,
    severity: emailIngestSeverity(opts.status),
    audience: "workspace",
  });

  if (isEmailIngestSuccess(opts.status) || isEmailIngestFailure(opts.status)) {
    await dispatchEmailIngestNotificationEmails(opts.orgId, {
      success: isEmailIngestSuccess(opts.status),
      title,
      body,
    });
  }

  if (isEmailIngestFailure(opts.status) && opts.detail) {
    await notifyEmailIngestSenderRejection({
      fromAddress: opts.fromAddress,
      status: opts.status,
      detail: opts.detail,
      subject: opts.subject,
      attachmentName: opts.attachmentName,
    });
  }
}

export async function dispatchEmailIngestNotificationEmails(
  orgId: string,
  opts: { success: boolean; title: string; body: string },
): Promise<void> {
  const flagCol = opts.success ? "notify_on_success" : "notify_on_failure";
  const { data: rows } = await supabaseAdmin
    .from("email_ingest_notification_recipients")
    .select("email")
    .eq("org_id", orgId)
    .eq(flagCol, true);
  const recipients = (rows ?? []).map((r) => r.email.trim().toLowerCase()).filter(Boolean);
  if (recipients.length === 0) return;

  if (!emailDeliveryConfigured()) return;

  for (const to of recipients) {
    try {
      await sendEmail({
        to,
        subject: `[Gridwire] ${opts.title}`,
        text: `${opts.title}\n\n${opts.body}`,
        purpose: "notifications",
        tag: opts.success ? "email-ingest-success" : "email-ingest-failure",
      });
    } catch {
      // Best-effort per recipient.
    }
  }
}
