/** Default and validation helpers for per-workspace ingest mailboxes. */

export function ingestEmailDomain(): string {
  return (import.meta.env.VITE_INGEST_EMAIL_DOMAIN as string | undefined)?.trim() || "ingest.local";
}

/** Suggested address for a workspace before admin customizes it. */
export function suggestIngestAddress(orgSlug: string, orgId: string): string {
  const local = (orgSlug || `ingest-${orgId.slice(0, 8)}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${local}@${ingestEmailDomain()}`;
}

export function isValidIngestEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Inbound routing: mail gateway forwards parsed JSON to our webhook — no mailbox UI in Gridwire. */
export type IngestDeliveryMode = "inbound_webhook" | "mail_forward" | "connector";

export const INGEST_STATUS_LABELS: Record<string, string> = {
  received: "Received",
  rejected_no_mailbox: "Rejected — no mailbox",
  rejected_sender: "Rejected — sender not allowlisted",
  rejected_template: "Rejected — no matching template",
  rejected_no_attachment: "Rejected — no Excel/CSV attachment",
  rejected_parse_error: "Rejected — could not parse file",
  rejected_schema_mismatch: "Rejected — columns do not match template",
  quarantined: "Quarantined — malware scan failed",
  accepted_pending_ingest: "Accepted — importing to dataset",
  ingested: "Imported to dataset",
  ingest_failed: "Import failed after validation",
};
