/**
 * Runtime configuration for the Gridwire MCP server.
 *
 * Required:
 *   GRIDWIRE_BASE_URL  — portal origin, e.g. https://gridwire.example.com
 *   GRIDWIRE_API_KEY   — workspace API key (Bearer)
 *
 * Optional:
 *   GRIDWIRE_ORG_ID       — ignored for auth (key implies org); reserved for future
 *   GRIDWIRE_DATASET_IDS  — comma-separated allowlist; empty = all published in org
 */

export type McpConfig = {
  baseUrl: string;
  apiKey: string;
  datasetAllowlist: Set<string> | null;
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Set GRIDWIRE_BASE_URL and GRIDWIRE_API_KEY.`,
    );
  }
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const baseUrl = (env.GRIDWIRE_BASE_URL ?? env.GRIDWIRE_URL)?.trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error(
      "Missing GRIDWIRE_BASE_URL (portal origin, e.g. https://your-portal.example).",
    );
  }
  try {
    // Validate URL shape early.
    new URL(baseUrl);
  } catch {
    throw new Error(`GRIDWIRE_BASE_URL is not a valid URL: ${baseUrl}`);
  }

  const apiKey = (env.GRIDWIRE_API_KEY ?? env.GRIDWIRE_TOKEN)?.trim();
  if (!apiKey) {
    throw new Error("Missing GRIDWIRE_API_KEY (workspace API key with read access).");
  }

  const rawAllow = env.GRIDWIRE_DATASET_IDS?.trim();
  const datasetAllowlist = rawAllow
    ? new Set(
        rawAllow
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;

  return { baseUrl, apiKey, datasetAllowlist };
}
