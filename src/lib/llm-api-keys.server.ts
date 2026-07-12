/**
 * Org LLM API keys — same lifecycle as dataset api_keys (hash, prefix, rotate, revoke)
 * plus AES-GCM ciphertext for outbound provider calls (never returned to the client).
 */

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptValueAtRest, encryptValueAtRest } from "@/lib/field-protection.server";
import type {
  LlmApiKeyPublic,
  LlmProvider,
  OrgAiConfig,
  ResolvedLlmRuntime,
} from "@/lib/llm-api-keys-types";

export type { LlmApiKeyPublic, LlmProvider, OrgAiConfig, ResolvedLlmRuntime } from "@/lib/llm-api-keys-types";

type LlmApiKeyRow = {
  id: string;
  org_id: string;
  name: string;
  provider: string;
  model: string | null;
  base_url: string | null;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by: string | null;
  key_hash: string;
  key_ciphertext: string;
};

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function keyPrefix(raw: string): string {
  return raw.slice(0, Math.min(11, raw.length));
}

/** Reject URL-like values and other non-keys that pass public /models endpoints. */
export function assertValidProviderApiKey(provider: LlmProvider, apiKey: string): void {
  const raw = apiKey.trim();
  if (provider === "ollama") return;
  if (!raw) throw new Error("API key is required for this provider");
  if (/^https?:\/\//i.test(raw)) {
    throw new Error(
      "That looks like a URL, not an API key. Paste the provider secret (for OpenRouter, it starts with sk-or-).",
    );
  }
  if (provider === "openrouter" && !raw.startsWith("sk-or-")) {
    throw new Error("OpenRouter API keys start with sk-or-. Get one from openrouter.ai/keys.");
  }
  if (provider === "openai" && !raw.startsWith("sk-")) {
    throw new Error("OpenAI API keys usually start with sk-.");
  }
}

function asProvider(raw: string): LlmProvider {
  switch (raw) {
    case "openai":
    case "anthropic":
    case "gemini":
    case "ollama":
    case "openai_compatible":
    case "openrouter":
      return raw;
    default:
      return "openai";
  }
}

function toPublic(row: LlmApiKeyRow): LlmApiKeyPublic {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    provider: asProvider(row.provider),
    model: row.model,
    base_url: row.base_url,
    key_prefix: row.key_prefix,
    scopes: row.scopes,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

function defaultModel(provider: LlmProvider): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "gemini":
      return "gemini-2.0-flash";
    case "ollama":
      return "llava";
    case "openrouter":
      return "openrouter/free";
    case "openai":
    case "openai_compatible":
      return "gpt-4o-mini";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

function defaultBaseUrl(provider: LlmProvider): string {
  switch (provider) {
    case "ollama":
      return "http://127.0.0.1:11434";
    case "anthropic":
      return "https://api.anthropic.com";
    case "gemini":
      return "https://generativelanguage.googleapis.com";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "openai":
    case "openai_compatible":
      return "https://api.openai.com/v1";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export async function getOrgAiConfig(orgId: string): Promise<OrgAiConfig> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("ai_config")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = data?.ai_config;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as OrgAiConfig;
  }
  return {};
}

export async function updateOrgAiConfig(orgId: string, patch: OrgAiConfig): Promise<OrgAiConfig> {
  const current = await getOrgAiConfig(orgId);
  const next: OrgAiConfig = { ...current, ...patch };
  const { error } = await supabaseAdmin
    .from("organizations")
    .update({ ai_config: next as Record<string, unknown> })
    .eq("id", orgId);
  if (error) throw new Error(error.message);
  return next;
}

export async function listLlmApiKeys(orgId: string): Promise<LlmApiKeyPublic[]> {
  const { data, error } = await supabaseAdmin
    .from("llm_api_keys")
    .select(
      "id, org_id, name, provider, model, base_url, key_prefix, scopes, last_used_at, revoked_at, created_at, created_by, key_hash, key_ciphertext",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as LlmApiKeyRow[]).map(toPublic);
}

export async function createLlmApiKey(opts: {
  orgId: string;
  name: string;
  provider: LlmProvider;
  model?: string | null;
  baseUrl?: string | null;
  apiKey: string;
  createdBy: string;
}): Promise<{ key: LlmApiKeyPublic; shownOncePrefix: string }> {
  const raw = opts.apiKey.trim();
  if (opts.provider !== "ollama" && !raw) {
    throw new Error("API key is required for this provider");
  }
  assertValidProviderApiKey(opts.provider, raw);
  const material = raw || `ollama-local-${opts.orgId}`;
  const key_hash = sha256Hex(material);
  const key_prefix = keyPrefix(material);
  const key_ciphertext = encryptValueAtRest(material);

  const { data, error } = await supabaseAdmin
    .from("llm_api_keys")
    .insert({
      org_id: opts.orgId,
      name: opts.name.trim(),
      provider: opts.provider,
      model: opts.model?.trim() || null,
      base_url:
        opts.provider === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : opts.baseUrl?.trim() || null,
      key_hash,
      key_ciphertext,
      key_prefix,
      scopes: ["pdf_parse"],
      created_by: opts.createdBy,
    })
    .select(
      "id, org_id, name, provider, model, base_url, key_prefix, scopes, last_used_at, revoked_at, created_at, created_by, key_hash, key_ciphertext",
    )
    .single();
  if (error) throw new Error(error.message);

  const row = data as LlmApiKeyRow;
  const cfg = await getOrgAiConfig(opts.orgId);
  if (!cfg.active_llm_key_id) {
    await updateOrgAiConfig(opts.orgId, { active_llm_key_id: row.id });
  }

  return { key: toPublic(row), shownOncePrefix: key_prefix };
}

export async function rotateLlmApiKey(opts: {
  orgId: string;
  keyId: string;
  apiKey: string;
  createdBy: string;
}): Promise<{ key: LlmApiKeyPublic; shownOncePrefix: string }> {
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("llm_api_keys")
    .select("*")
    .eq("id", opts.keyId)
    .eq("org_id", opts.orgId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!existing) throw new Error("LLM API key not found");
  const old = existing as LlmApiKeyRow;
  if (old.revoked_at) throw new Error("Cannot rotate a revoked key");

  const created = await createLlmApiKey({
    orgId: opts.orgId,
    name: old.name,
    provider: asProvider(old.provider),
    model: old.model,
    baseUrl: old.base_url,
    apiKey: opts.apiKey,
    createdBy: opts.createdBy,
  });

  const { error: revokeErr } = await supabaseAdmin
    .from("llm_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", opts.keyId)
    .eq("org_id", opts.orgId);
  if (revokeErr) throw new Error(revokeErr.message);

  await updateOrgAiConfig(opts.orgId, { active_llm_key_id: created.key.id });
  return created;
}

export async function revokeLlmApiKey(orgId: string, keyId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("llm_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("org_id", orgId)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);

  const cfg = await getOrgAiConfig(orgId);
  if (cfg.active_llm_key_id === keyId) {
    const { data: next } = await supabaseAdmin
      .from("llm_api_keys")
      .select("id")
      .eq("org_id", orgId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await updateOrgAiConfig(orgId, {
      active_llm_key_id: (next as { id: string } | null)?.id ?? null,
    });
  }
}

export async function updateLlmApiKey(opts: {
  orgId: string;
  keyId: string;
  name?: string;
  model?: string | null;
  apiKey?: string;
}): Promise<LlmApiKeyPublic> {
  const row = await loadKeyRow(opts.orgId, opts.keyId);
  if (!row) throw new Error("LLM API key not found");

  const patch: Record<string, unknown> = {};
  if (opts.name !== undefined) {
    const name = opts.name.trim();
    if (!name) throw new Error("Name is required");
    patch.name = name;
  }
  if (opts.model !== undefined) {
    const model = opts.model?.trim() || null;
    if (!model) throw new Error("Model is required");
    patch.model = model;
  }
  if (opts.apiKey !== undefined && opts.apiKey.trim()) {
    const provider = asProvider(row.provider);
    assertValidProviderApiKey(provider, opts.apiKey);
    const material = opts.apiKey.trim();
    patch.key_hash = sha256Hex(material);
    patch.key_prefix = keyPrefix(material);
    patch.key_ciphertext = encryptValueAtRest(material);
  }

  if (Object.keys(patch).length === 0) {
    return toPublic(row);
  }

  const { data, error } = await supabaseAdmin
    .from("llm_api_keys")
    .update(patch)
    .eq("id", opts.keyId)
    .eq("org_id", opts.orgId)
    .select(
      "id, org_id, name, provider, model, base_url, key_prefix, scopes, last_used_at, revoked_at, created_at, created_by, key_hash, key_ciphertext",
    )
    .single();
  if (error) throw new Error(error.message);
  return toPublic(data as LlmApiKeyRow);
}

/** List models using a stored org key (decrypts server-side). */
export async function listModelsForStoredKey(
  orgId: string,
  keyId: string,
): Promise<{ models: { id: string; name: string }[]; defaultModel: string; provider: LlmProvider }> {
  const row = await loadKeyRow(orgId, keyId);
  if (!row) throw new Error("LLM API key not found");
  const provider = asProvider(row.provider);
  const runtime: ResolvedLlmRuntime = {
    provider,
    model: row.model?.trim() || defaultModel(provider),
    baseUrl: (row.base_url?.trim() || defaultBaseUrl(provider)).replace(/\/$/, ""),
    apiKey: decryptValueAtRest(row.key_ciphertext),
    keyId: row.id,
    source: "org_key",
  };
  assertValidProviderApiKey(provider, runtime.apiKey);
  const { listLlmModelsWithRuntime } = await import("@/lib/llm-provider.server");
  const models = await listLlmModelsWithRuntime(runtime);
  if (models.length === 0) throw new Error("No models returned for this provider");
  const preferred = row.model?.trim() || defaultModel(provider);
  const defaultModelId = models.some((m) => m.id === preferred) ? preferred : models[0]!.id;
  return { models, defaultModel: defaultModelId, provider };
}

export async function setActiveLlmApiKey(orgId: string, keyId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("llm_api_keys")
    .select("id, revoked_at")
    .eq("id", keyId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("LLM API key not found");
  if ((data as { revoked_at: string | null }).revoked_at) {
    throw new Error("Cannot activate a revoked key");
  }
  await updateOrgAiConfig(orgId, { active_llm_key_id: keyId });
}

export async function touchLlmApiKeyUsed(keyId: string): Promise<void> {
  await supabaseAdmin
    .from("llm_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId);
}

async function loadKeyRow(orgId: string, keyId: string): Promise<LlmApiKeyRow | null> {
  const { data, error } = await supabaseAdmin
    .from("llm_api_keys")
    .select("*")
    .eq("id", keyId)
    .eq("org_id", orgId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LlmApiKeyRow | null) ?? null;
}

/** Public wrapper for admin edit/test flows. */
export async function getActiveLlmApiKeyRow(
  orgId: string,
  keyId: string,
): Promise<{
  id: string;
  provider: LlmProvider;
  model: string | null;
  base_url: string | null;
  key_ciphertext: string;
} | null> {
  const row = await loadKeyRow(orgId, keyId);
  if (!row) return null;
  return {
    id: row.id,
    provider: asProvider(row.provider),
    model: row.model,
    base_url: row.base_url,
    key_ciphertext: row.key_ciphertext,
  };
}

async function loadLatestActiveKey(orgId: string): Promise<LlmApiKeyRow | null> {
  const { data, error } = await supabaseAdmin
    .from("llm_api_keys")
    .select("*")
    .eq("org_id", orgId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LlmApiKeyRow | null) ?? null;
}

function envRuntime(): ResolvedLlmRuntime | null {
  const raw = (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
  const allowed: LlmProvider[] = [
    "openai",
    "anthropic",
    "gemini",
    "ollama",
    "openai_compatible",
    "openrouter",
  ];
  const provider = (allowed.includes(raw as LlmProvider) ? raw : "openai") as LlmProvider;
  const key = process.env.LLM_API_KEY?.trim() ?? "";
  if (provider !== "ollama" && !key) return null;
  return {
    provider,
    model: process.env.LLM_MODEL?.trim() || defaultModel(provider),
    baseUrl: (process.env.LLM_BASE_URL?.trim() || defaultBaseUrl(provider)).replace(/\/$/, ""),
    apiKey: key,
    keyId: null,
    source: "env",
  };
}

/** Resolve org-stored key first, then deployment env fallback. */
export async function resolveLlmRuntime(orgId?: string | null): Promise<ResolvedLlmRuntime> {
  if (orgId) {
    const cfg = await getOrgAiConfig(orgId);
    let row: LlmApiKeyRow | null = null;
    if (cfg.active_llm_key_id) {
      row = await loadKeyRow(orgId, cfg.active_llm_key_id);
    }
    if (!row) row = await loadLatestActiveKey(orgId);
    if (row) {
      const provider = asProvider(row.provider);
      const decrypted = decryptValueAtRest(row.key_ciphertext);
      try {
        assertValidProviderApiKey(provider, decrypted);
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? `${err.message} Edit the connection and paste a valid API key.`
            : "Invalid stored API key. Edit the connection.",
        );
      }
      return {
        provider,
        model: row.model?.trim() || defaultModel(provider),
        baseUrl: (row.base_url?.trim() || defaultBaseUrl(provider)).replace(/\/$/, ""),
        apiKey: decrypted,
        keyId: row.id,
        source: "org_key",
      };
    }
  }

  const fromEnv = envRuntime();
  if (fromEnv) return fromEnv;

  throw new Error(
    "No LLM API key configured. Add one under Admin → AI / PDF, or set LLM_API_KEY in the portal environment.",
  );
}

export function orgPdfParseEnabled(cfg: OrgAiConfig): boolean {
  if (typeof cfg.pdf_parse_enabled === "boolean") return cfg.pdf_parse_enabled;
  const v = (process.env.PDF_PARSE_ENABLED ?? "true").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

export function envPdfParseMockEnabled(): boolean {
  const v = (process.env.PDF_PARSE_MOCK ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Mock mode skips the LLM. Explicit org setting wins.
 * If unset and the org has an active LLM key, never inherit PDF_PARSE_MOCK from
 * the server env — that silently ignored Admin → AI / PDF configuration.
 */
export function orgPdfParseMock(cfg: OrgAiConfig): boolean {
  if (cfg.pdf_parse_mock === true) return true;
  if (cfg.pdf_parse_mock === false) return false;
  if (cfg.active_llm_key_id) return false;
  return envPdfParseMockEnabled();
}

export { defaultModel as defaultLlmModel, defaultBaseUrl as defaultLlmBaseUrl };
