-- GoTrue MFA tables (TOTP enrollment via supabase.auth.mfa).

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friendly_name text,
  factor_type text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  secret text
);

CREATE INDEX IF NOT EXISTS mfa_factors_user_id_idx ON auth.mfa_factors (user_id);

CREATE TABLE IF NOT EXISTS auth.mfa_challenges (
  id uuid PRIMARY KEY,
  factor_id uuid NOT NULL REFERENCES auth.mfa_factors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  ip_address inet
);

CREATE INDEX IF NOT EXISTS mfa_challenges_factor_id_idx ON auth.mfa_challenges (factor_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.mfa_factors TO supabase_auth_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.mfa_challenges TO supabase_auth_admin;

INSERT INTO auth.schema_migrations (version)
VALUES ('20240723100000_add_mfa_factors')
ON CONFLICT (version) DO NOTHING;
