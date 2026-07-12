/**
 * Client-callable server functions for org LLM API keys + AI/PDF settings.
 * Ciphertext never leaves the server.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const providerSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "openai_compatible",
  "openrouter",
]);

function pickDefaultModelId(
  provider: string,
  models: { id: string }[],
  preferred?: string | null,
): string {
  const explicit = preferred?.trim();
  if (explicit && models.some((m) => m.id === explicit)) return explicit;
  if (provider === "openrouter") {
    for (const id of ["openrouter/free", "openrouter/auto"]) {
      if (models.some((m) => m.id === id)) return id;
    }
  }
  return models[0]!.id;
}

async function requireOrgAdmin(orgId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: membership, error } = await supabaseAdmin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!membership || !["owner", "admin"].includes((membership as { role: string }).role)) {
    throw new Error("Owner or admin access required");
  }
}

export const listLlmApiKeysFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const { listLlmApiKeys, getOrgAiConfig, orgPdfParseEnabled, orgPdfParseMock, envPdfParseMockEnabled } =
      await import("@/lib/llm-api-keys.server");
    const [keys, aiConfig] = await Promise.all([
      listLlmApiKeys(data.orgId),
      getOrgAiConfig(data.orgId),
    ]);
    return {
      keys,
      aiConfig,
      effective: {
        pdfParseEnabled: orgPdfParseEnabled(aiConfig),
        pdfParseMock: orgPdfParseMock(aiConfig),
        envPdfParseMock: envPdfParseMockEnabled(),
      },
    };
  });

export const createLlmApiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        name: z.string().min(1).max(200),
        provider: providerSchema,
        model: z.string().max(200).optional().nullable(),
        baseUrl: z.string().max(500).optional().nullable(),
        apiKey: z.string().max(4000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const { createLlmApiKey, updateOrgAiConfig } = await import("@/lib/llm-api-keys.server");
    const result = await createLlmApiKey({
      orgId: data.orgId,
      name: data.name,
      provider: data.provider,
      model: data.model,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
      createdBy: context.userId,
    });
    // Saving a live key should leave mock mode — otherwise PDF uploads never call the LLM.
    await updateOrgAiConfig(data.orgId, { pdf_parse_mock: false }).catch(() => undefined);
    try {
      const { logUserAuditEvent } = await import("@/lib/audit.server");
      await logUserAuditEvent({
        orgId: data.orgId,
        userId: context.userId,
        action: "llm_api_key.created",
        resourceType: "llm_api_key",
        resourceId: result.key.id,
        metadata: {
          name: result.key.name,
          provider: result.key.provider,
          key_prefix: result.key.key_prefix,
        },
      });
    } catch {
      /* best-effort */
    }
    return {
      key: result.key,
      message: `Key saved. Prefix ${result.shownOncePrefix}•••• — the full secret is never shown again.`,
    };
  });

export const rotateLlmApiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        keyId: z.string().uuid(),
        apiKey: z.string().min(1).max(4000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const { rotateLlmApiKey } = await import("@/lib/llm-api-keys.server");
    const result = await rotateLlmApiKey({
      orgId: data.orgId,
      keyId: data.keyId,
      apiKey: data.apiKey,
      createdBy: context.userId,
    });
    try {
      const { logUserAuditEvent } = await import("@/lib/audit.server");
      await logUserAuditEvent({
        orgId: data.orgId,
        userId: context.userId,
        action: "llm_api_key.rotated",
        resourceType: "llm_api_key",
        resourceId: result.key.id,
        metadata: {
          name: result.key.name,
          key_prefix: result.key.key_prefix,
          replaced_key_id: data.keyId,
        },
      });
    } catch {
      /* best-effort */
    }
    return {
      key: result.key,
      message: `Key rotated. Old key revoked. New prefix ${result.shownOncePrefix}••••`,
    };
  });

export const revokeLlmApiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), keyId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const { revokeLlmApiKey } = await import("@/lib/llm-api-keys.server");
    await revokeLlmApiKey(data.orgId, data.keyId);
    try {
      const { logUserAuditEvent } = await import("@/lib/audit.server");
      await logUserAuditEvent({
        orgId: data.orgId,
        userId: context.userId,
        action: "llm_api_key.revoked",
        resourceType: "llm_api_key",
        resourceId: data.keyId,
      });
    } catch {
      /* best-effort */
    }
    return { ok: true };
  });

export const setActiveLlmApiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), keyId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const { setActiveLlmApiKey, updateOrgAiConfig } = await import("@/lib/llm-api-keys.server");
    await setActiveLlmApiKey(data.orgId, data.keyId);
    await updateOrgAiConfig(data.orgId, { pdf_parse_mock: false }).catch(() => undefined);
    return { ok: true };
  });

export const updateOrgAiConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        pdfParseEnabled: z.boolean().optional(),
        pdfParseMock: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const { updateOrgAiConfig } = await import("@/lib/llm-api-keys.server");
    const patch: Record<string, boolean> = {};
    if (data.pdfParseEnabled !== undefined) patch.pdf_parse_enabled = data.pdfParseEnabled;
    if (data.pdfParseMock !== undefined) patch.pdf_parse_mock = data.pdfParseMock;
    const aiConfig = await updateOrgAiConfig(data.orgId, patch);
    return { aiConfig };
  });

const pingMessages = [
  { role: "system" as const, content: "Reply with valid JSON only." },
  { role: "user" as const, content: 'Return {"ok":true,"ping":"pong"}' },
];

export const testLlmConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const { resolveLlmRuntime, touchLlmApiKeyUsed, getOrgAiConfig, orgPdfParseMock } = await import(
      "@/lib/llm-api-keys.server"
    );
    const cfg = await getOrgAiConfig(data.orgId);
    const mock = orgPdfParseMock(cfg);
    try {
      const runtime = await resolveLlmRuntime(data.orgId);
      const { llmCompleteJsonWithRuntime } = await import("@/lib/llm-provider.server");
      const result = await llmCompleteJsonWithRuntime(pingMessages, runtime);
      if (runtime.keyId) await touchLlmApiKeyUsed(runtime.keyId);
      return {
        ok: true as const,
        connected: true as const,
        mock,
        provider: runtime.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        source: runtime.source,
        error: null as string | null,
      };
    } catch (err) {
      return {
        ok: false as const,
        connected: false as const,
        mock,
        provider: null as string | null,
        model: null as string | null,
        latencyMs: null as number | null,
        source: null as string | null,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  });

/** Probe unsaved credentials before persisting an LLM API key; returns available models. */
export const testLlmCredentialsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        provider: providerSchema,
        model: z.string().max(200).optional().nullable(),
        baseUrl: z.string().max(500).optional().nullable(),
        apiKey: z.string().max(4000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const {
      defaultLlmModel,
      defaultLlmBaseUrl,
      assertValidProviderApiKey,
    } = await import("@/lib/llm-api-keys.server");
    const { listLlmModelsWithRuntime, llmCompleteJsonWithRuntime } = await import(
      "@/lib/llm-provider.server"
    );
    if (data.provider !== "ollama" && !data.apiKey.trim()) {
      throw new Error("API key is required for this provider");
    }
    assertValidProviderApiKey(data.provider, data.apiKey);
    const started = Date.now();
    const runtime = {
      provider: data.provider,
      model: data.model?.trim() || defaultLlmModel(data.provider),
      baseUrl: (data.baseUrl?.trim() || defaultLlmBaseUrl(data.provider)).replace(/\/$/, ""),
      apiKey: data.apiKey.trim(),
      keyId: null,
      source: "org_key" as const,
    };
    // OpenRouter /models is public — listing alone does not prove the key works.
    const models = await listLlmModelsWithRuntime(runtime);
    if (models.length === 0) {
      throw new Error("API key accepted but no models were returned for this provider");
    }
    const preferred = data.model?.trim() || defaultLlmModel(data.provider);
    const defaultModel = pickDefaultModelId(data.provider, models, preferred);
    // Ping with a resilient default (openrouter/free), not a possibly rate-limited pinned free model.
    const pingModel = pickDefaultModelId(data.provider, models, defaultLlmModel(data.provider));
    runtime.model = pingModel;
    try {
      await llmCompleteJsonWithRuntime(pingMessages, runtime);
      return {
        ok: true as const,
        connected: true as const,
        provider: runtime.provider,
        models,
        defaultModel,
        latencyMs: Date.now() - started,
        error: null as string | null,
      };
    } catch (err) {
      // Still return the catalog so the UI can show the full dropdown.
      return {
        ok: true as const,
        connected: false as const,
        provider: runtime.provider,
        models,
        defaultModel,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : "Connection ping failed",
      };
    }
  });

export const updateLlmApiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        keyId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        model: z.string().min(1).max(200).optional().nullable(),
        apiKey: z.string().max(4000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const { updateLlmApiKey } = await import("@/lib/llm-api-keys.server");
    const key = await updateLlmApiKey({
      orgId: data.orgId,
      keyId: data.keyId,
      name: data.name,
      model: data.model,
      apiKey: data.apiKey,
    });
    try {
      const { logUserAuditEvent } = await import("@/lib/audit.server");
      await logUserAuditEvent({
        orgId: data.orgId,
        userId: context.userId,
        action: "llm_api_key.updated",
        resourceType: "llm_api_key",
        resourceId: key.id,
        metadata: {
          name: key.name,
          model: key.model,
          key_prefix: key.key_prefix,
          secret_rotated: Boolean(data.apiKey?.trim()),
        },
      });
    } catch {
      /* best-effort */
    }
    return { key };
  });

/** List models for a stored key without requiring a successful chat ping. */
export const listStoredLlmModelsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        keyId: z.string().uuid(),
        apiKey: z.string().max(4000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const {
      getActiveLlmApiKeyRow,
      assertValidProviderApiKey,
      defaultLlmModel,
      defaultLlmBaseUrl,
    } = await import("@/lib/llm-api-keys.server");
    const { decryptValueAtRest } = await import("@/lib/field-protection.server");
    const { listLlmModelsWithRuntime } = await import("@/lib/llm-provider.server");

    const row = await getActiveLlmApiKeyRow(data.orgId, data.keyId);
    if (!row) throw new Error("LLM API key not found");

    const apiKey = data.apiKey?.trim()
      ? data.apiKey.trim()
      : decryptValueAtRest(row.key_ciphertext);
    assertValidProviderApiKey(row.provider, apiKey);

    const runtime = {
      provider: row.provider,
      model: row.model || defaultLlmModel(row.provider),
      baseUrl: (row.base_url?.trim() || defaultLlmBaseUrl(row.provider)).replace(/\/$/, ""),
      apiKey,
      keyId: row.id,
      source: "org_key" as const,
    };

    const models = await listLlmModelsWithRuntime(runtime);
    if (models.length === 0) throw new Error("No models returned for this provider");
    const defaultModel = pickDefaultModelId(row.provider, models, row.model);
    return {
      provider: runtime.provider,
      models,
      defaultModel,
      currentModel: row.model,
    };
  });

/** Test + list models for an existing stored key (optionally with a replacement secret). */
export const testStoredLlmKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        keyId: z.string().uuid(),
        apiKey: z.string().max(4000).optional(),
        model: z.string().max(200).optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireOrgAdmin(data.orgId, context.userId);
    const {
      getActiveLlmApiKeyRow,
      assertValidProviderApiKey,
      defaultLlmModel,
      defaultLlmBaseUrl,
    } = await import("@/lib/llm-api-keys.server");
    const { decryptValueAtRest } = await import("@/lib/field-protection.server");
    const { listLlmModelsWithRuntime, llmCompleteJsonWithRuntime } = await import(
      "@/lib/llm-provider.server"
    );

    const row = await getActiveLlmApiKeyRow(data.orgId, data.keyId);
    if (!row) throw new Error("LLM API key not found");

    const apiKey = data.apiKey?.trim()
      ? data.apiKey.trim()
      : decryptValueAtRest(row.key_ciphertext);
    assertValidProviderApiKey(row.provider, apiKey);

    const runtime = {
      provider: row.provider,
      model: data.model?.trim() || row.model || defaultLlmModel(row.provider),
      baseUrl: (row.base_url?.trim() || defaultLlmBaseUrl(row.provider)).replace(/\/$/, ""),
      apiKey,
      keyId: row.id,
      source: "org_key" as const,
    };

    const started = Date.now();
    const models = await listLlmModelsWithRuntime(runtime);
    if (models.length === 0) throw new Error("No models returned for this provider");
    const preferred = data.model?.trim() || row.model || defaultLlmModel(row.provider);
    const defaultModel = pickDefaultModelId(row.provider, models, preferred);
    // Prefer resilient router for the live ping so a rate-limited pinned free model
    // does not wipe the catalog from the UI.
    const pingModel = pickDefaultModelId(row.provider, models, defaultLlmModel(row.provider));
    runtime.model = pingModel;
    try {
      await llmCompleteJsonWithRuntime(pingMessages, runtime);
      return {
        ok: true as const,
        connected: true as const,
        provider: runtime.provider,
        models,
        defaultModel,
        latencyMs: Date.now() - started,
        error: null as string | null,
      };
    } catch (err) {
      return {
        ok: true as const,
        connected: false as const,
        provider: runtime.provider,
        models,
        defaultModel,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : "Connection ping failed",
      };
    }
  });
