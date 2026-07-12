/**
 * Thin LLM provider for AI PDF extraction.
 * Prefer org-stored LLM API keys (Admin → AI / PDF); fall back to LLM_* env.
 */

import type { ResolvedLlmRuntime } from "@/lib/llm-api-keys-types";
import { logServer, logServerError, toUserFacingMessage } from "@/lib/user-facing-error";
import { pdfParseLlmTimeoutMs } from "@/lib/pdf-parse-limits.server";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmCompleteResult = {
  text: string;
  model: string;
  latencyMs: number;
};

export function pdfParseEnabled(): boolean {
  const v = (process.env.PDF_PARSE_ENABLED ?? "true").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

export function pdfParseMockEnabled(): boolean {
  const v = (process.env.PDF_PARSE_MOCK ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function envProviderName(): string {
  return (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
}

function envResolveModel(): string {
  const explicit = process.env.LLM_MODEL?.trim();
  if (explicit) return explicit;
  switch (envProviderName()) {
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "gemini":
      return "gemini-2.0-flash";
    case "ollama":
      return "llava";
    case "openrouter":
      return "openrouter/free";
    default:
      return "gpt-4o-mini";
  }
}

function envResolveBaseUrl(): string {
  const base = process.env.LLM_BASE_URL?.trim();
  if (base) return base.replace(/\/$/, "");
  switch (envProviderName()) {
    case "ollama":
      return "http://127.0.0.1:11434";
    case "anthropic":
      return "https://api.anthropic.com";
    case "gemini":
      return "https://generativelanguage.googleapis.com";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    default:
      return "https://api.openai.com/v1";
  }
}

function envRequireApiKey(): string {
  const key = process.env.LLM_API_KEY?.trim();
  const provider = envProviderName();
  if (provider === "ollama") return key ?? "";
  if (!key) {
    throw new Error(
      "LLM_API_KEY is required for AI PDF parsing (configure Admin → AI / PDF, or set PDF_PARSE_MOCK=true for tests).",
    );
  }
  return key;
}

function runtimeFromEnv(): ResolvedLlmRuntime {
  return {
    provider: envProviderName() as ResolvedLlmRuntime["provider"],
    model: envResolveModel(),
    baseUrl: envResolveBaseUrl(),
    apiKey: envRequireApiKey(),
    keyId: null,
    source: "env",
  };
}

async function completeOpenAiCompatible(
  messages: LlmMessage[],
  runtime: ResolvedLlmRuntime,
  opts?: { timeoutMs?: number; maxTokens?: number },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? pdfParseLlmTimeoutMs();
  const base = runtime.baseUrl;
  const url = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}),
    ...(runtime.provider === "openrouter"
      ? { "HTTP-Referer": "https://gridwire.local", "X-Title": "Gridwire" }
      : {}),
  };

  const post = async (withJsonObject: boolean) => {
    const body: Record<string, unknown> = {
      model: runtime.model,
      temperature: 0,
      messages,
    };
    if (opts?.maxTokens != null) body.max_tokens = opts.maxTokens;
    // Many OpenRouter routed models (and some OpenAI-compatible hosts) reject
    // response_format=json_object even though the prompt asks for JSON.
    if (withJsonObject) body.response_format = { type: "json_object" };
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  // Prefer JSON mode when the host supports it; fall back if the model rejects it.
  let res = await post(runtime.provider !== "openrouter");
  if (!res.ok && runtime.provider !== "openrouter") {
    const body = await res.text().catch(() => "");
    if (res.status === 400 && /response[_\s-]?format|json_object/i.test(body)) {
      res = await post(false);
    } else {
      throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 400)}`);
    }
  }
  if (!res.ok && runtime.provider === "openrouter") {
    // OpenRouter: first attempt already skipped json_object; surface the error.
    const body = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 400)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("LLM returned empty content");
  return text;
}

async function completeAnthropic(
  messages: LlmMessage[],
  runtime: ResolvedLlmRuntime,
  opts?: { timeoutMs?: number; maxTokens?: number },
): Promise<string> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const userMessages = messages.filter((m) => m.role !== "system");
  const res = await fetch(`${runtime.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": runtime.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: runtime.model,
      max_tokens: opts?.maxTokens ?? 8192,
      temperature: 0,
      system,
      messages: userMessages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    }),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? pdfParseLlmTimeoutMs()),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic request failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = json.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) throw new Error("Anthropic returned empty content");
  return text;
}

async function completeGemini(
  messages: LlmMessage[],
  runtime: ResolvedLlmRuntime,
  opts?: { timeoutMs?: number; maxTokens?: number },
): Promise<string> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");
  const url = `${runtime.baseUrl}/v1beta/models/${encodeURIComponent(runtime.model)}:generateContent?key=${encodeURIComponent(runtime.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        ...(opts?.maxTokens != null ? { maxOutputTokens: opts.maxTokens } : {}),
      },
    }),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? pdfParseLlmTimeoutMs()),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini request failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned empty content");
  return text;
}

async function completeOllama(
  messages: LlmMessage[],
  runtime: ResolvedLlmRuntime,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const res = await fetch(`${runtime.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: runtime.model,
      stream: false,
      format: "json",
      messages,
    }),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? pdfParseLlmTimeoutMs()),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  const text = json.message?.content?.trim();
  if (!text) throw new Error("Ollama returned empty content");
  return text;
}

/** Complete with an explicit runtime (org key or env). */
export async function llmCompleteJsonWithRuntime(
  messages: LlmMessage[],
  runtime: ResolvedLlmRuntime,
  opts?: { timeoutMs?: number; maxTokens?: number },
): Promise<LlmCompleteResult> {
  const started = Date.now();
  logServer("llm", "info", `Calling ${runtime.provider} model "${runtime.model}"`, {
    source: runtime.source,
    keyId: runtime.keyId,
    baseUrl: runtime.baseUrl,
    timeoutMs: opts?.timeoutMs ?? null,
    maxTokens: opts?.maxTokens ?? null,
  });
  let text: string;
  try {
    switch (runtime.provider) {
      case "anthropic":
        text = await completeAnthropic(messages, runtime, opts);
        break;
      case "gemini":
        text = await completeGemini(messages, runtime, opts);
        break;
      case "ollama":
        text = await completeOllama(messages, runtime, opts);
        break;
      case "openai":
      case "openai_compatible":
      case "openrouter":
        text = await completeOpenAiCompatible(messages, runtime, opts);
        break;
      default: {
        const _exhaustive: never = runtime.provider;
        throw new Error(`Unsupported LLM provider: ${_exhaustive}`);
      }
    }
  } catch (err) {
    logServerError("llm", `Provider call failed (${runtime.provider}/${runtime.model})`, err, {
      source: runtime.source,
      keyId: runtime.keyId,
    });
    throw new Error(toUserFacingMessage(err, "The AI provider request failed."));
  }
  const latencyMs = Date.now() - started;
  logServer("llm", "info", `Provider OK (${runtime.provider}/${runtime.model}) in ${latencyMs}ms`, {
    chars: text.length,
  });
  return { text, model: runtime.model, latencyMs };
}

export type LlmModelOption = {
  id: string;
  name: string;
};

function normalizeOpenAiBase(base: string): string {
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function parseOpenAiModelsPayload(
  json: {
    data?: {
      id?: string;
      name?: string;
      architecture?: { modality?: string; input_modalities?: string[] };
      pricing?: { prompt?: string; completion?: string };
    }[];
  },
  opts?: { textOnly?: boolean },
): LlmModelOption[] {
  const rows = json.data ?? [];
  const options = rows
    .map((m) => {
      const id = m.id?.trim();
      if (!id) return null;
      if (opts?.textOnly !== false) {
        const modality = m.architecture?.modality?.toLowerCase() ?? "";
        const inputs = m.architecture?.input_modalities ?? [];
        if (modality && !modality.includes("text") && !inputs.includes("text")) return null;
      }
      return { id, name: (m.name?.trim() || id) as string };
    })
    .filter((m): m is LlmModelOption => !!m);
  options.sort((a, b) => a.id.localeCompare(b.id));
  return options;
}

async function listOpenAiCompatibleModels(runtime: ResolvedLlmRuntime): Promise<LlmModelOption[]> {
  const base = normalizeOpenAiBase(runtime.baseUrl);
  const headers: Record<string, string> = {
    ...(runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}),
    ...(runtime.provider === "openrouter"
      ? { "HTTP-Referer": "https://gridwire.local", "X-Title": "Gridwire" }
      : {}),
  };

  // OpenRouter: /models/user is filtered to this key's preferences, privacy, and access.
  if (runtime.provider === "openrouter" && runtime.apiKey) {
    const userRes = await fetch(`${base}/models/user`, { headers });
    if (userRes.ok) {
      const json = (await userRes.json()) as Parameters<typeof parseOpenAiModelsPayload>[0];
      const userModels = parseOpenAiModelsPayload(json);
      // Ensure the free router is selectable even if the catalog omits router ids.
      const withRouters = ensureOpenRouterRouterOptions(userModels);
      if (withRouters.length > 0) return withRouters;
    }
  }

  const res = await fetch(`${base}/models`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Could not list models (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as Parameters<typeof parseOpenAiModelsPayload>[0];
  const listed = parseOpenAiModelsPayload(json);
  return runtime.provider === "openrouter" ? ensureOpenRouterRouterOptions(listed) : listed;
}

function ensureOpenRouterRouterOptions(models: LlmModelOption[]): LlmModelOption[] {
  const extras: LlmModelOption[] = [
    { id: "openrouter/free", name: "Free Models Router (openrouter/free)" },
  ];
  const out = [...models];
  for (const extra of extras) {
    if (!out.some((m) => m.id === extra.id)) out.unshift(extra);
  }
  return out;
}

async function listAnthropicModels(runtime: ResolvedLlmRuntime): Promise<LlmModelOption[]> {
  const res = await fetch(`${runtime.baseUrl}/v1/models`, {
    headers: {
      "x-api-key": runtime.apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Could not list Anthropic models (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: { id?: string; display_name?: string }[] };
  return (json.data ?? [])
    .map((m) => {
      const id = m.id?.trim();
      if (!id) return null;
      return { id, name: m.display_name?.trim() || id };
    })
    .filter((m): m is LlmModelOption => !!m)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function listGeminiModels(runtime: ResolvedLlmRuntime): Promise<LlmModelOption[]> {
  const url = `${runtime.baseUrl}/v1beta/models?key=${encodeURIComponent(runtime.apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Could not list Gemini models (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  return (json.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => {
      const raw = m.name?.trim() ?? "";
      const id = raw.startsWith("models/") ? raw.slice("models/".length) : raw;
      if (!id) return null;
      return { id, name: m.displayName?.trim() || id };
    })
    .filter((m): m is LlmModelOption => !!m)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function listOllamaModels(runtime: ResolvedLlmRuntime): Promise<LlmModelOption[]> {
  const res = await fetch(`${runtime.baseUrl}/api/tags`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Could not list Ollama models (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { models?: { name?: string }[] };
  return (json.models ?? [])
    .map((m) => {
      const id = m.name?.trim();
      if (!id) return null;
      return { id, name: id };
    })
    .filter((m): m is LlmModelOption => !!m)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** List models for a provider using the given credentials (also validates the key). */
export async function listLlmModelsWithRuntime(runtime: ResolvedLlmRuntime): Promise<LlmModelOption[]> {
  switch (runtime.provider) {
    case "anthropic":
      return listAnthropicModels(runtime);
    case "gemini":
      return listGeminiModels(runtime);
    case "ollama":
      return listOllamaModels(runtime);
    case "openai":
    case "openai_compatible":
    case "openrouter":
      return listOpenAiCompatibleModels(runtime);
    default: {
      const _exhaustive: never = runtime.provider;
      throw new Error(`Unsupported LLM provider: ${_exhaustive}`);
    }
  }
}

/**
 * Complete a chat prompt using org LLM key when orgId is provided,
 * otherwise deployment env. Returns JSON text from the model.
 */
export async function llmCompleteJson(
  messages: LlmMessage[],
  opts?: { orgId?: string | null; timeoutMs?: number; maxTokens?: number },
): Promise<LlmCompleteResult> {
  if (!pdfParseEnabled() && !opts?.orgId) {
    // org path may still enable via ai_config; checked by caller for PDF
  }
  let runtime: ResolvedLlmRuntime;
  if (opts?.orgId) {
    const { resolveLlmRuntime } = await import("@/lib/llm-api-keys.server");
    runtime = await resolveLlmRuntime(opts.orgId);
  } else {
    runtime = runtimeFromEnv();
  }
  const result = await llmCompleteJsonWithRuntime(messages, runtime, {
    timeoutMs: opts?.timeoutMs,
    maxTokens: opts?.maxTokens,
  });
  if (runtime.keyId) {
    const { touchLlmApiKeyUsed } = await import("@/lib/llm-api-keys.server");
    await touchLlmApiKeyUsed(runtime.keyId).catch(() => undefined);
  }
  return result;
}
