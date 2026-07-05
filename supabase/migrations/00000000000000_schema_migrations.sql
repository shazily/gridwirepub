-- Migration tracking table for idempotent apply-migrations scripts.
-- Named gridwire_schema_migrations to avoid clashing with GoTrue's schema_migrations table.
CREATE TABLE IF NOT EXISTS public.gridwire_schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.gridwire_schema_migrations TO authenticated;
GRANT ALL ON public.gridwire_schema_migrations TO service_role;
