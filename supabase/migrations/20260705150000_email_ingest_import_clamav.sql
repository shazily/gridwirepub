-- Email ingest: attachment storage, import outcomes, scan metadata.

ALTER TABLE public.email_ingest_messages
  ADD COLUMN IF NOT EXISTS attachment_storage_ref TEXT,
  ADD COLUMN IF NOT EXISTS dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version_id UUID REFERENCES public.dataset_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scan_detail TEXT,
  ADD COLUMN IF NOT EXISTS ingest_error TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.email_ingest_messages.attachment_storage_ref IS
  'Minio/S3 path to quarantined accepted attachment pending or after import';
COMMENT ON COLUMN public.email_ingest_messages.scan_detail IS
  'ClamAV result: scan_skipped_no_clamav, stream OK, or infection signature';

ALTER TABLE public.email_ingest_templates
  ADD COLUMN IF NOT EXISTS load_mode TEXT NOT NULL DEFAULT 'full'
    CHECK (load_mode IN ('full', 'incremental'));

CREATE INDEX IF NOT EXISTS idx_email_ingest_messages_status
  ON public.email_ingest_messages (org_id, status, created_at DESC);
