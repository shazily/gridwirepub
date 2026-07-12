-- Allow OpenRouter as a first-class LLM provider (OpenAI-compatible API).
ALTER TABLE public.llm_api_keys DROP CONSTRAINT IF EXISTS llm_api_keys_provider_check;
ALTER TABLE public.llm_api_keys ADD CONSTRAINT llm_api_keys_provider_check CHECK (
  provider = ANY (ARRAY[
    'openai'::text,
    'anthropic'::text,
    'gemini'::text,
    'ollama'::text,
    'openai_compatible'::text,
    'openrouter'::text
  ])
);
