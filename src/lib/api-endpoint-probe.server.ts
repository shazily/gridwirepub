/**
 * Live HTTP probes for published dataset API endpoints.
 * Used by the dataset API tab "Test" actions so operators can verify health
 * without depending on Swagger CDN / Try-it-out.
 */

import { slugify } from "@/lib/api-serve.server";

export type EndpointProbeKind =
  | "rows"
  | "schema"
  | "dataset"
  | "openapi"
  | "contract_json"
  | "contract_yaml"
  | "lineage";

export type EndpointProbeResult = {
  kind: EndpointProbeKind;
  label: string;
  url: string;
  /** healthy | auth_required | not_published | unhealthy */
  outcome: "healthy" | "auth_required" | "not_published" | "unhealthy";
  http_status: number | null;
  latency_ms: number;
  detail: string | null;
};

const KIND_LABEL: Record<EndpointProbeKind, string> = {
  rows: "Rows",
  schema: "Schema",
  dataset: "Dataset / poll",
  openapi: "OpenAPI spec",
  contract_json: "Data contract (JSON)",
  contract_yaml: "Data contract (YAML)",
  lineage: "Lineage graph",
};

function pathForKind(datasetId: string, sheetSlug: string, kind: EndpointProbeKind): string {
  const base = `/api/v1/datasets/${datasetId}`;
  switch (kind) {
    case "rows":
      return `${base}/${sheetSlug}?limit=1`;
    case "schema":
      return `${base}/${sheetSlug}/schema`;
    case "dataset":
      return base;
    case "openapi":
      return `${base}/openapi.json`;
    case "contract_json":
      return `${base}/contract.json`;
    case "contract_yaml":
      return `${base}/contract.yaml`;
    case "lineage":
      return `${base}/lineage.json`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function classifyStatus(
  status: number,
  secure: boolean,
  bodyPreview: string,
): EndpointProbeResult["outcome"] {
  if (status >= 200 && status < 300) return "healthy";
  if (status === 401 || status === 403) {
    // Secure datasets without a key should return 401 — route is up, auth gate works.
    return secure ? "auth_required" : "unhealthy";
  }
  if (status === 404 && /not published/i.test(bodyPreview)) return "not_published";
  if (status === 404) return "unhealthy";
  return "unhealthy";
}

async function httpProbe(
  absoluteUrl: string,
  kind: EndpointProbeKind,
  secure: boolean,
  bearerToken?: string | null,
): Promise<EndpointProbeResult> {
  const started = Date.now();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (bearerToken?.trim()) {
    headers.Authorization = `Bearer ${bearerToken.trim()}`;
  }

  try {
    const res = await fetch(absoluteUrl, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const latency_ms = Date.now() - started;
    const text = await res.text().catch(() => "");
    const preview = text.slice(0, 240);
    const outcome = classifyStatus(res.status, secure, preview);

    let detail: string | null = null;
    if (outcome === "auth_required") {
      detail = "Endpoint reachable; API key required (expected for secure datasets).";
    } else if (outcome === "not_published") {
      detail = "Dataset is not published — restore/publish to serve the API.";
    } else if (outcome === "unhealthy") {
      detail = preview || `HTTP ${res.status}`;
    } else if (bearerToken && secure) {
      detail = "Authenticated probe succeeded.";
    }

    return {
      kind,
      label: KIND_LABEL[kind],
      url: absoluteUrl,
      outcome,
      http_status: res.status,
      latency_ms,
      detail,
    };
  } catch (err) {
    return {
      kind,
      label: KIND_LABEL[kind],
      url: absoluteUrl,
      outcome: "unhealthy",
      http_status: null,
      latency_ms: Date.now() - started,
      detail: err instanceof Error ? err.message : "Request failed",
    };
  }
}

export type ProbeDatasetEndpointsInput = {
  origin: string;
  datasetId: string;
  sheetName: string;
  secure: boolean;
  /** Optional raw API key for full authenticated checks on secure datasets. */
  apiKey?: string | null;
  kinds?: EndpointProbeKind[];
};

/**
 * Probe one or more dataset API endpoints over HTTP against `origin`.
 */
export async function probeDatasetEndpoints(
  input: ProbeDatasetEndpointsInput,
): Promise<EndpointProbeResult[]> {
  const sheetSlug = slugify(input.sheetName);
  const kinds: EndpointProbeKind[] =
    input.kinds ??
    (["rows", "schema", "dataset", "openapi", "contract_json", "contract_yaml", "lineage"] as const);

  const origin = input.origin.replace(/\/$/, "");
  const results: EndpointProbeResult[] = [];

  for (const kind of kinds) {
    const path = pathForKind(input.datasetId, sheetSlug, kind);
    const url = `${origin}${path}`;
    results.push(await httpProbe(url, kind, input.secure, input.apiKey));
  }

  return results;
}

export type PlatformHealthCheck = {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "skipped";
  detail: string | null;
  latency_ms: number | null;
};

export type PlatformHealthReport = {
  overall: "healthy" | "degraded" | "down";
  checked_at: string;
  checks: PlatformHealthCheck[];
};

/**
 * Aggregate portal + backend readiness into a single operator-facing report.
 */
export async function collectPlatformHealth(origin: string): Promise<PlatformHealthReport> {
  const checks: PlatformHealthCheck[] = [];
  const base = origin.replace(/\/$/, "");

  const probePublic = async (id: string, label: string, path: string) => {
    const started = Date.now();
    try {
      const res = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      const latency_ms = Date.now() - started;
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) {
        checks.push({ id, label, status: "ok", detail: JSON.stringify(body).slice(0, 200), latency_ms });
      } else {
        checks.push({
          id,
          label,
          status: "fail",
          detail: typeof body.status === "string" ? body.status : `HTTP ${res.status}`,
          latency_ms,
        });
      }
    } catch (err) {
      checks.push({
        id,
        label,
        status: "fail",
        detail: err instanceof Error ? err.message : "unreachable",
        latency_ms: Date.now() - started,
      });
    }
  };

  await probePublic("liveness", "Portal liveness (/api/public/health)", "/api/public/health");
  await probePublic("readiness", "Portal readiness (/api/public/ready)", "/api/public/ready");

  // Direct DB / storage / clamav detail from ready response shape is enough for most ops.
  // Enrich with published dataset count via service role when available.
  const startedDb = Date.now();
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error } = await supabaseAdmin
      .from("datasets")
      .select("id", { head: true, count: "exact" })
      .eq("status", "published");
    if (error) {
      checks.push({
        id: "published_datasets",
        label: "Published datasets (DB)",
        status: "fail",
        detail: error.message,
        latency_ms: Date.now() - startedDb,
      });
    } else {
      checks.push({
        id: "published_datasets",
        label: "Published datasets (DB)",
        status: "ok",
        detail: `${count ?? 0} published`,
        latency_ms: Date.now() - startedDb,
      });
    }
  } catch (err) {
    checks.push({
      id: "published_datasets",
      label: "Published datasets (DB)",
      status: "fail",
      detail: err instanceof Error ? err.message : "query failed",
      latency_ms: Date.now() - startedDb,
    });
  }

  const startedStorage = Date.now();
  try {
    const { storageEnabled, testStorageConnection } = await import("@/lib/storage.server");
    if (!storageEnabled()) {
      checks.push({
        id: "storage",
        label: "Object storage",
        status: "skipped",
        detail: "Not configured",
        latency_ms: null,
      });
    } else {
      const result = await testStorageConnection({ provider: "platform" });
      checks.push({
        id: "storage",
        label: "Object storage",
        status: result.ok ? "ok" : "fail",
        detail: result.message || (result.ok ? "Reachable" : "unreachable"),
        latency_ms: Date.now() - startedStorage,
      });
    }
  } catch (err) {
    checks.push({
      id: "storage",
      label: "Object storage",
      status: "fail",
      detail: err instanceof Error ? err.message : "check failed",
      latency_ms: Date.now() - startedStorage,
    });
  }

  const startedClam = Date.now();
  try {
    const { clamavConfigured, clamavReachable } = await import("@/lib/clamav.server");
    if (!clamavConfigured()) {
      checks.push({
        id: "clamav",
        label: "ClamAV virus scan",
        status: "skipped",
        detail: "Not configured",
        latency_ms: null,
      });
    } else {
      const ping = await clamavReachable();
      checks.push({
        id: "clamav",
        label: "ClamAV virus scan",
        status: ping.ok ? "ok" : "warn",
        detail: ping.ok ? "Reachable" : (ping.detail ?? "unreachable"),
        latency_ms: Date.now() - startedClam,
      });
    }
  } catch (err) {
    checks.push({
      id: "clamav",
      label: "ClamAV virus scan",
      status: "warn",
      detail: err instanceof Error ? err.message : "check failed",
      latency_ms: Date.now() - startedClam,
    });
  }

  const startedSec = Date.now();
  try {
    const { assertProductionSecurityBootstrap } = await import("@/server/bootstrap");
    assertProductionSecurityBootstrap();
    checks.push({
      id: "security_bootstrap",
      label: "Production security bootstrap",
      status: "ok",
      detail: "Pass",
      latency_ms: Date.now() - startedSec,
    });
  } catch (err) {
    const isProd = process.env.NODE_ENV === "production";
    checks.push({
      id: "security_bootstrap",
      label: "Production security bootstrap",
      status: isProd ? "fail" : "warn",
      detail: err instanceof Error ? err.message : "failed",
      latency_ms: Date.now() - startedSec,
    });
  }

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  const overall = hasFail ? "down" : hasWarn ? "degraded" : "healthy";

  return {
    overall,
    checked_at: new Date().toISOString(),
    checks,
  };
}
