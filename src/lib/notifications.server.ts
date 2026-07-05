/**
 * In-app notifications (all members) and email dispatch for email-ingest outcomes.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
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

export async function notifyEmailIngestOutcome(opts: {
  orgId: string;
  status: string;
  fromAddress: string;
  subject?: string | null;
  attachmentName?: string | null;
  detail?: string | null;
  datasetId?: string | null;
}): Promise<void> {
  const label = INGEST_STATUS_LABELS[opts.status] ?? opts.status;
  const title = `Email ingest: ${label}`;
  const bodyParts = [
    `From: ${opts.fromAddress}`,
    opts.subject ? `Subject: ${opts.subject}` : null,
    opts.attachmentName ? `Attachment: ${opts.attachmentName}` : null,
    opts.detail ? `Detail: ${opts.detail}` : null,
    opts.datasetId ? `Dataset: ${opts.datasetId}` : null,
  ].filter(Boolean);

  await insertAlertEvent({
    orgId: opts.orgId,
    eventType: isEmailIngestSuccess(opts.status) ? "email_ingest_success" : "email_ingest_failure",
    title,
    body: bodyParts.join("\n"),
    severity: emailIngestSeverity(opts.status),
    audience: "workspace",
  });

  if (isEmailIngestSuccess(opts.status) || isEmailIngestFailure(opts.status)) {
    await dispatchEmailIngestNotificationEmails(opts.orgId, {
      success: isEmailIngestSuccess(opts.status),
      title,
      body: bodyParts.join("\n"),
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

  const { sendEmail, emailDeliveryConfigured } = await import("@/lib/email.server");
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
