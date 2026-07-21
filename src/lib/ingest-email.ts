/** Default and validation helpers for per-workspace ingest mailboxes. */

export function ingestEmailDomain(): string {
  return (import.meta.env.VITE_INGEST_EMAIL_DOMAIN as string | undefined)?.trim() || "ingest.local";
}

/** True when the domain is a local placeholder — not routable on the public internet. */
export function isPlaceholderIngestDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  return !d || d === "ingest.local" || d.endsWith(".local");
}

/** Suggested address for a workspace before admin customizes it. */
export function suggestIngestAddress(orgSlug: string, orgId: string, domain?: string): string {
  const local = (orgSlug || `ingest-${orgId.slice(0, 8)}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${local}@${(domain?.trim() || ingestEmailDomain()).toLowerCase()}`;
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
  rejected_no_attachment: "Rejected — no Excel/CSV/PDF attachment",
  rejected_attachment_too_large: "Rejected — attachment too large",
  rejected_parse_error: "Rejected — could not parse file",
  rejected_schema_mismatch: "Rejected — columns do not match template",
  quarantined: "Quarantined — malware scan failed",
  pending_pdf_review: "Pending — PDF awaiting review",
  accepted_pending_ingest: "Accepted — importing to dataset",
  ingested: "Imported to dataset",
  ingest_failed: "Import failed after validation",
};
