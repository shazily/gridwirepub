// Server-only helpers shared across the generated dataset API routes.
// Imported dynamically inside route handlers (never at client-reachable module scope).
import { createHash, createHmac, createCipheriv, randomBytes } from "crypto";
import { revealProtectedValue } from "@/lib/field-protection.server";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, if-none-match",
  "Access-Control-Expose-Headers": "ETag, Last-Modified, X-Dataset-Version, X-Total-Count",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Canonical public origin for OpenAPI servers, webhooks, and absolute URLs in specs.
 * Prefer PUBLIC_APP_URL / SITE_URL from deployment .env; else reverse-proxy headers; else request URL.
 */
export function resolvePublicOrigin(request: Request): string {
  const configured = process.env.PUBLIC_APP_URL?.trim() || process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host")?.split(",")[0]?.trim();
  if (proto && host) return `${proto}://${host}`;

  return new URL(request.url).origin;
}

export function slugify(input: string): string {
  return (
    (input ?? "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

export function maskValue(v: unknown): string {
  const s = String(v ?? "");
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}${"*".repeat(Math.max(4, s.length - 4))}${s.slice(-2)}`;
}

export type HashAlgo =
  | "sha256"
  | "sha512"
  | "sha3_256"
  | "sha3_512"
  | "hmac_sha256"
  | "hmac_sha512";

// Deterministic, irreversible hashing. Keyed HMAC variants use the same secret
// as field encryption so hashes are peppered and not trivially rainbow-tabled.
export function hashValue(v: unknown, algo: HashAlgo = "sha256"): string {
  const input = String(v ?? "");
  try {
    switch (algo) {
      case "sha512":
        return createHash("sha512").update(input).digest("hex");
      case "sha3_256":
        return createHash("sha3-256").update(input).digest("hex");
      case "sha3_512":
        return createHash("sha3-512").update(input).digest("hex");
      case "hmac_sha256":
        return createHmac("sha256", encryptionKey()).update(input).digest("hex");
      case "hmac_sha512":
        return createHmac("sha512", encryptionKey()).update(input).digest("hex");
      case "sha256":
      default:
        return createHash("sha256").update(input).digest("hex");
    }
  } catch {
    // Fallback if the runtime lacks a given digest (e.g. sha3 unavailable).
    return createHash("sha256").update(input).digest("hex");
  }
}

function encryptionKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY ?? "";
  // Stored as 64 hex chars (32 bytes). Fall back to deriving 32 bytes if not hex.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

// AES-256-GCM. Output: enc:v1:<iv>.<tag>.<ciphertext> (all base64url).
export function encryptValue(v: unknown): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(v ?? ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64 = (b: Buffer) => b.toString("base64url");
  return `enc:v1:${b64(iv)}.${b64(tag)}.${b64(ct)}`;
}

export type ServeField = {
  api_name: string;
  sheet_name: string;
  masking: "none" | "mask" | "hash" | "encrypt";
  hash_algo?: HashAlgo;
  included: boolean;
  data_type?: string;
  is_pii?: boolean;
  original_name?: string;
  nullable?: boolean;
};

export function applyMask(
  value: unknown,
  masking: ServeField["masking"],
  hashAlgo: HashAlgo = "sha256",
): unknown {
  if (value === null || value === undefined) return null;
  switch (masking) {
    case "mask":
      return maskValue(value);
    case "hash":
      return hashValue(value, hashAlgo);
    case "encrypt":
      return revealProtectedValue(value, "encrypt", hashAlgo);
    default:
      return value;
  }
}

export function shapeRow(
  row: Record<string, unknown>,
  fields: ServeField[],
  select?: string[] | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (select && select.length > 0 && !select.includes(f.api_name)) continue;
    out[f.api_name] = applyMask(row[f.api_name], f.masking, f.hash_algo ?? "sha256");
  }
  return out;
}

export type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

export async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type ResolvedDataset = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  slug: string;
  api_access: "secure" | "public";
  status: string;
  current_version_id: string | null;
  updated_at: string;
};

// Validates the API key bearer token (for secure datasets). Returns the key row or null.
export async function validateApiKey(admin: AdminClient, request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { ok: false as const, reason: "missing" as const };
  const keyHash = createHash("sha256").update(token).digest("hex");
  const { data: key } = await admin
    .from("api_keys")
    .select("id, org_id, name, revoked_at, rate_limit_override")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (!key || key.revoked_at) return { ok: false as const, reason: "invalid" as const };
  return { ok: true as const, key };
}

// Resolves a published dataset and enforces access control.
// For public datasets no key is required; for secure datasets a valid key
// belonging to the dataset's org is required.
export async function authorizeDataset(
  admin: AdminClient,
  request: Request,
  datasetId: string,
): Promise<
  | { ok: true; dataset: ResolvedDataset; apiKeyId: string | null; apiKeyLabel: string | null; rateLimitHeaders: Record<string, string> }
  | { ok: false; response: Response }
> {
  const { data: ds } = await admin
    .from("datasets")
    .select("id, org_id, name, description, slug, api_access, status, current_version_id, updated_at")
    .eq("id", datasetId)
    .maybeSingle();
  if (!ds) return { ok: false, response: json({ error: "Dataset not found" }, 404) };
  const dataset = ds as ResolvedDataset;
  if (dataset.status !== "published" || !dataset.current_version_id)
    return { ok: false, response: json({ error: "Dataset not published" }, 404) };

  const orgLimits = await loadOrgApiLimits(admin, dataset.org_id);

  if (dataset.api_access === "public") {
    const quota = await checkOrgMonthlyQuota(admin, dataset.org_id, orgLimits.monthlyQuota);
    if (!quota.ok) return { ok: false, response: quota.response };
    const rl = checkRateLimit(request, null, { perMin: orgLimits.perMin });
    if (!rl.ok) {
      await logRateLimited(admin, { orgId: dataset.org_id, datasetId: dataset.id, apiKeyId: null, request });
      return { ok: false, response: rl.response };
    }
    return { ok: true, dataset, apiKeyId: null, apiKeyLabel: null, rateLimitHeaders: rl.headers };
  }

  const res = await validateApiKey(admin, request);
  if (!res.ok) {
    const msg = res.reason === "missing" ? "Missing API key" : "Invalid API key";
    await logAuthFailure(admin, request, {
      orgId: dataset.org_id,
      datasetId: dataset.id,
      reason: res.reason,
    });
    return {
      ok: false,
      response: json({ error: msg }, 401, { "WWW-Authenticate": 'Bearer realm="dataset"' }),
    };
  }
  if (res.key.org_id !== dataset.org_id) {
    await logAuthFailure(admin, request, {
      orgId: dataset.org_id,
      datasetId: dataset.id,
      reason: "wrong_org",
    });
    return { ok: false, response: json({ error: "Dataset not found" }, 404) };
  }
  const quota = await checkOrgMonthlyQuota(admin, dataset.org_id, orgLimits.monthlyQuota);
  if (!quota.ok) return { ok: false, response: quota.response };

  const keyOverride = (res.key as { rate_limit_override?: number | null }).rate_limit_override;
  const perMin = keyOverride ?? orgLimits.perMin;
  const rl = checkRateLimit(request, res.key.id, { perMin });
  if (!rl.ok) {
    await logRateLimited(admin, {
      orgId: dataset.org_id,
      datasetId: dataset.id,
      apiKeyId: res.key.id,
      request,
    });
    return { ok: false, response: rl.response };
  }
  return { ok: true, dataset, apiKeyId: res.key.id, apiKeyLabel: res.key.name ?? null, rateLimitHeaders: rl.headers };
}

type OrgApiLimits = { perMin: number | undefined; monthlyQuota: number | undefined };

async function loadOrgApiLimits(admin: AdminClient, orgId: string): Promise<OrgApiLimits> {
  try {
    const { data } = await admin
      .from("organizations")
      .select("api_rate_limit_per_min, api_monthly_quota")
      .eq("id", orgId)
      .maybeSingle();
    return {
      perMin: data?.api_rate_limit_per_min ?? undefined,
      monthlyQuota: data?.api_monthly_quota ?? undefined,
    };
  } catch {
    return { perMin: undefined, monthlyQuota: undefined };
  }
}

async function checkOrgMonthlyQuota(
  admin: AdminClient,
  orgId: string,
  monthlyQuota: number | undefined,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!monthlyQuota || monthlyQuota <= 0) return { ok: true };
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  try {
    const { count } = await admin
      .from("consumption_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .gte("created_at", since.toISOString());
    if ((count ?? 0) >= monthlyQuota) {
      return {
        ok: false,
        response: json({ error: "Organization API quota exceeded", code: "quota_exceeded" }, 429),
      };
    }
  } catch {
    /* best-effort */
  }
  return { ok: true };
}

function clientIp(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

// In-memory sliding-window rate limiter (per API key or client IP).
const rateWindows = new Map<string, number[]>();

function rateLimitConfig(overrides?: { perMin?: number; burst?: number }) {
  const envPerMin = Number(process.env.API_RATE_LIMIT_PER_MIN ?? 60);
  const envBurst = Number(process.env.API_RATE_LIMIT_BURST ?? 20);
  const perMin = Math.max(1, overrides?.perMin ?? envPerMin);
  const burst = Math.max(1, overrides?.burst ?? envBurst);
  return { perMin, burst, windowMs: 60_000 };
}

type RateLimitState = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

function consumeRateLimit(bucketKey: string, overrides?: { perMin?: number; burst?: number }): RateLimitState {
  const { perMin, burst, windowMs } = rateLimitConfig(overrides);
  const limit = Math.max(perMin, burst);
  const now = Date.now();
  const hits = (rateWindows.get(bucketKey) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt: hits[0]! + windowMs };
  }
  hits.push(now);
  rateWindows.set(bucketKey, hits);
  return { allowed: true, limit, remaining: limit - hits.length, resetAt: now + windowMs };
}

function rateLimitHeaders(state: RateLimitState): Record<string, string> {
  const resetSec = Math.ceil(state.resetAt / 1000);
  return {
    "X-RateLimit-Limit": String(state.limit),
    "X-RateLimit-Remaining": String(Math.max(0, state.remaining)),
    "X-RateLimit-Reset": String(resetSec),
  };
}

function rateLimitResponse(state: RateLimitState): Response {
  const retryAfter = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
  return json(
    { error: "Rate limit exceeded", code: "rate_limit_exceeded" },
    429,
    { ...rateLimitHeaders(state), "Retry-After": String(retryAfter) },
  );
}

async function logRateLimited(
  admin: AdminClient,
  args: { orgId: string; datasetId: string; apiKeyId: string | null; request: Request },
) {
  try {
    const ip = clientIp(args.request);
    await admin.from("audit_events").insert({
      org_id: args.orgId,
      dataset_id: args.datasetId,
      actor_id: null,
      actor_label: args.apiKeyId ? "API key" : "Anonymous",
      action: "api.rate_limited",
      resource_type: "dataset",
      resource_id: args.datasetId,
      ip,
      metadata: { api_key_id: args.apiKeyId },
    });
    await admin.from("consumption_events").insert({
      org_id: args.orgId,
      api_key_id: args.apiKeyId,
      dataset_id: args.datasetId,
      endpoint: args.datasetId,
      status_code: 429,
      row_count: 0,
    });
  } catch {
    /* best-effort */
  }
}

export function checkRateLimit(
  request: Request,
  apiKeyId: string | null,
  overrides?: { perMin?: number; burst?: number },
): { ok: true; headers: Record<string, string> } | { ok: false; response: Response } {
  const ip = clientIp(request) ?? "unknown";
  const bucketKey = apiKeyId ? `key:${apiKeyId}` : `ip:${ip}`;
  const state = consumeRateLimit(bucketKey, overrides);
  if (!state.allowed) return { ok: false, response: rateLimitResponse(state) };
  return { ok: true, headers: rateLimitHeaders(state) };
}

/** Clears in-memory rate limit windows (tests only). */
export function resetRateLimitsForTests(): void {
  rateWindows.clear();
}

// Records a failed authentication attempt against a secure dataset and runs
// suspicious-access heuristics. Service-role write, bypasses RLS.
export async function logAuthFailure(
  admin: AdminClient,
  request: Request,
  args: { orgId: string; datasetId: string; reason: string },
) {
  try {
    const ip = clientIp(request);
    await admin.from("audit_events").insert({
      org_id: args.orgId,
      dataset_id: args.datasetId,
      actor_id: null,
      actor_label: "Unauthenticated caller",
      action: "api.auth.failed",
      resource_type: "dataset",
      resource_id: args.datasetId,
      ip,
      metadata: { reason: args.reason, user_agent: request.headers.get("user-agent") ?? null },
    });
    await flagSuspiciousAccess(admin, { orgId: args.orgId, ip });
  } catch {
    /* best-effort */
  }
}

// Heuristic detector: raises a warning-severity alert event when a single IP
// generates an unusual burst of failed auth attempts or data reads within a
// short window. Deduplicated so it fires at most once per org per window.
export async function flagSuspiciousAccess(
  admin: AdminClient,
  args: { orgId: string; ip: string | null },
) {
  try {
    if (!args.ip) return;
    const windowMs = 15 * 60 * 1000;
    const since = new Date(Date.now() - windowMs).toISOString();

    const { count: failCount } = await admin
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", args.orgId)
      .eq("ip", args.ip)
      .eq("action", "api.auth.failed")
      .gte("created_at", since);
    const { count: readCount } = await admin
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", args.orgId)
      .eq("ip", args.ip)
      .eq("action", "api.data.read")
      .gte("created_at", since);

    const failures = failCount ?? 0;
    const reads = readCount ?? 0;
    const FAIL_THRESHOLD = 5;
    const READ_THRESHOLD = 500;
    if (failures < FAIL_THRESHOLD && reads < READ_THRESHOLD) return;

    // Dedup: at most one suspicious-access alert per org per window.
    const { count: recentAlerts } = await admin
      .from("alert_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", args.orgId)
      .eq("event_type", "suspicious_access")
      .gte("created_at", since);
    if ((recentAlerts ?? 0) > 0) return;

    const body =
      failures >= FAIL_THRESHOLD
        ? `${failures} failed API key attempts from ${args.ip} in the last 15 minutes.`
        : `${reads} data reads from ${args.ip} in the last 15 minutes (possible scraping).`;

    await admin.from("alert_events").insert({
      org_id: args.orgId,
      event_type: "suspicious_access",
      severity: "warning",
      title: "Suspicious API access detected",
      body,
      audience: "admins",
    });
  } catch {
    /* best-effort */
  }
}

export async function logConsumption(
  admin: AdminClient,
  args: {
    orgId: string;
    apiKeyId: string | null;
    datasetId: string;
    endpoint: string;
    statusCode: number;
    rowCount: number;
  },
) {
  try {
    await admin.from("consumption_events").insert({
      org_id: args.orgId,
      api_key_id: args.apiKeyId,
      dataset_id: args.datasetId,
      endpoint: args.endpoint,
      status_code: args.statusCode,
      row_count: args.rowCount,
    });
    if (args.apiKeyId)
      await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", args.apiKeyId);
  } catch {
    /* best-effort */
  }
}

// Records a data-access event in the audit trail (service-role write, bypasses
// RLS). Captures which API key / access mode read which dataset, plus caller IP.
export async function logDataAccess(
  admin: AdminClient,
  request: Request,
  args: {
    orgId: string;
    datasetId: string;
    apiKeyId: string | null;
    apiKeyLabel: string | null;
    access: "secure" | "public";
    resource: string;
    rowCount: number;
    statusCode: number;
  },
) {
  try {
    const ip = clientIp(request);
    await admin.from("audit_events").insert({
      org_id: args.orgId,
      dataset_id: args.datasetId,
      actor_id: null,
      actor_label: args.apiKeyLabel ?? (args.access === "public" ? "Public (anonymous)" : "API key"),
      action: "api.data.read",
      resource_type: "dataset",
      resource_id: args.resource,
      ip,
      metadata: {
        access: args.access,
        api_key_id: args.apiKeyId,
        row_count: args.rowCount,
        status_code: args.statusCode,
        user_agent: request.headers.get("user-agent") ?? null,
      },
    });
    await flagSuspiciousAccess(admin, { orgId: args.orgId, ip });
  } catch {
    /* best-effort: auditing must never break the API */
  }
}

// Loads included fields for a version and groups by sheet, resolving the
// requested sheet slug to its real name.
export async function loadSheetFields(admin: AdminClient, versionId: string) {
  const { data: fields } = await admin
    .from("dataset_fields")
    .select("api_name, sheet_name, masking, hash_algo, included, data_type, is_pii, original_name, nullable, position")
    .eq("version_id", versionId)
    .order("position", { ascending: true });
  const all = (fields ?? []) as (ServeField & { position?: number })[];
  const sheets = [...new Set(all.map((f) => f.sheet_name))];
  return { all, sheets };
}
