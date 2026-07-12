/** Shared LLM API key types — safe for client and server. */

export type LlmProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "openai_compatible"
  | "openrouter";

export type LlmApiKeyPublic = {
  id: string;
  org_id: string;
  name: string;
  provider: LlmProvider;
  model: string | null;
  base_url: string | null;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by: string | null;
};

export type OrgAiConfig = {
  pdf_parse_enabled?: boolean;
  pdf_parse_mock?: boolean;
  active_llm_key_id?: string | null;
};

export type ResolvedLlmRuntime = {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  keyId: string | null;
  source: "org_key" | "env";
};
