-- Per-org API quotas, per-key rate overrides, connector dead-letter metadata.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS api_rate_limit_per_min INTEGER,
  ADD COLUMN IF NOT EXISTS api_monthly_quota INTEGER;

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS rate_limit_override INTEGER;

COMMENT ON COLUMN public.organizations.api_rate_limit_per_min IS
  'Optional org-wide requests/min override (null = platform default).';
COMMENT ON COLUMN public.organizations.api_monthly_quota IS
  'Optional monthly API request cap per org (null = unlimited).';
COMMENT ON COLUMN public.api_keys.rate_limit_override IS
  'Optional per-key requests/min override (null = org/platform default).';

ALTER TABLE public.connector_runs
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dead_letter_at TIMESTAMPTZ;

COMMENT ON COLUMN public.connector_runs.dead_letter_at IS
  'Set when retries exhausted — visible in admin UI as dead-letter.';
