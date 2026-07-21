/**
 * Resolve secrets from process.env with optional future Vault/KMS injection.
 * Never log secret values. Fail closed in production when required keys are missing.
 */

export type SecretName =
  | "FIELD_ENCRYPTION_KEY"
  | "INBOUND_WEBHOOK_SECRET"
  | "WORKER_INGEST_TOKEN"
  | "METRICS_TOKEN"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "POSTMARK_API_TOKEN"
  | "SFTP_SECRETS";

export function getSecret(name: SecretName): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function requireSecret(name: SecretName): string {
  const value = getSecret(name);
  if (!value) {
    throw new Error(`${name} is required but not configured`);
  }
  return value;
}

/** Production fail-closed checks for connector / vault-adjacent secrets. */
export function assertSecurityBaselineProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  requireSecret("FIELD_ENCRYPTION_KEY");
  requireSecret("INBOUND_WEBHOOK_SECRET");
  requireSecret("WORKER_INGEST_TOKEN");
  requireSecret("METRICS_TOKEN");
  const enc = process.env.FIELD_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(enc)) {
    throw new Error("FIELD_ENCRYPTION_KEY must be a 64-character hex value in production");
  }
}
