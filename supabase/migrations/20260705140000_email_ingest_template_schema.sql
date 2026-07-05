-- Email ingest templates: uploaded Excel/CSV defines expected column schema.

ALTER TABLE public.email_ingest_templates
  ADD COLUMN IF NOT EXISTS schema_snapshot JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS template_file_name TEXT,
  ADD COLUMN IF NOT EXISTS sheet_name TEXT;

COMMENT ON COLUMN public.email_ingest_templates.schema_snapshot IS
  'Expected columns from uploaded template: { sheet_name, columns: [{ api_name, original_name, data_type }] }';

ALTER TABLE public.email_ingest_messages
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.email_ingest_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT;
