-- Persist uploaded template file location in object storage.

ALTER TABLE public.email_ingest_templates
  ADD COLUMN IF NOT EXISTS template_storage_ref TEXT;

COMMENT ON COLUMN public.email_ingest_templates.template_storage_ref IS
  'S3/Minio path to the uploaded template spreadsheet (column schema source file)';
