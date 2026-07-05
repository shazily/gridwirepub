/** Keys that must never be stored in connectors.config — use worker SFTP_SECRETS instead. */
const CREDENTIAL_KEYS = new Set([
  "password",
  "privateKey",
  "private_key",
  "pass",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "credentials",
]);

const WORKER_SAFE_CONFIG_KEYS = new Set(["host", "path", "port", "username"]);

export function sanitizeConnectorConfigForStorage(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const input = config ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (CREDENTIAL_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Non-secret fields exposed to the companion worker. */
export function stripConnectorConfigForWorker(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const input = config ?? {};
  const out: Record<string, unknown> = {};
  for (const key of WORKER_SAFE_CONFIG_KEYS) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "") {
      out[key] = input[key];
    }
  }
  return out;
}

export function connectorConfigContainsCredentials(
  config: Record<string, unknown> | null | undefined,
): boolean {
  if (!config) return false;
  return Object.keys(config).some((k) => CREDENTIAL_KEYS.has(k));
}

export function sftpSecretsEnvSnippet(connectorId: string): string {
  return `"${connectorId}": { "password": "YOUR_PASSWORD" }`;
}
