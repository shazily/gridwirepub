-- LLM provider API keys (outbound credentials for AI PDF parse).
-- Lifecycle mirrors public.api_keys: name, key_hash, key_prefix, scopes, revoke, rotate.
-- key_ciphertext holds AES-GCM enc:v1:... (FIELD_ENCRYPTION_KEY) so the server can call providers.
-- Authenticated clients never SELECT this table — all access via portal service_role server fns.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organizations.ai_config IS
  'Org AI/PDF settings: pdf_parse_enabled, pdf_parse_mock, active_llm_key_id (no raw secrets).';

CREATE TABLE public.llm_api_keys (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT,
  base_url TEXT,
  key_hash TEXT NOT NULL UNIQUE,
  key_ciphertext TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['pdf_parse']::text[],
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT llm_api_keys_provider_check CHECK (
    provider = ANY (ARRAY[
      'openai'::text,
      'anthropic'::text,
      'gemini'::text,
      'ollama'::text,
      'openai_compatible'::text
    ])
  )
);

CREATE INDEX IF NOT EXISTS llm_api_keys_org_id_idx ON public.llm_api_keys (org_id);
CREATE INDEX IF NOT EXISTS llm_api_keys_org_active_idx
  ON public.llm_api_keys (org_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.llm_api_keys IS
  'Outbound LLM credentials. key_hash like api_keys; key_ciphertext is server-only AES-GCM.';
COMMENT ON COLUMN public.llm_api_keys.key_hash IS 'SHA-256 hex of raw provider API key (same pattern as api_keys.key_hash).';
COMMENT ON COLUMN public.llm_api_keys.key_ciphertext IS 'enc:v1:... AES-256-GCM; never exposed to browser clients.';
COMMENT ON COLUMN public.llm_api_keys.key_prefix IS 'First characters of raw key for UI display (same pattern as api_keys).';

-- Service role only — no authenticated grants (ciphertext must not reach the SPA).
REVOKE ALL ON public.llm_api_keys FROM PUBLIC;
REVOKE ALL ON public.llm_api_keys FROM authenticated;
GRANT ALL ON public.llm_api_keys TO service_role;

ALTER TABLE public.llm_api_keys ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon: only service_role bypasses RLS.
