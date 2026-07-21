-- Async PDF AI jobs: processing/failed lifecycle + nullable workbook until parse completes.

ALTER TABLE public.pdf_ingest_drafts
  DROP CONSTRAINT IF EXISTS pdf_ingest_drafts_status_check;

-- Include structure-first statuses up front so this migration is safe on DBs that
-- already have pending_structure / extracting rows (later migration expands docs only).
ALTER TABLE public.pdf_ingest_drafts
  ADD CONSTRAINT pdf_ingest_drafts_status_check
  CHECK (status IN (
    'processing',
    'pending_structure',
    'extracting',
    'pending_review',
    'accepted',
    'rejected',
    'failed'
  ));

ALTER TABLE public.pdf_ingest_drafts
  ALTER COLUMN parsed_workbook DROP NOT NULL;

ALTER TABLE public.pdf_ingest_drafts
  ALTER COLUMN parsed_workbook SET DEFAULT '{}'::jsonb;

ALTER TABLE public.pdf_ingest_drafts
  ADD COLUMN IF NOT EXISTS parse_error TEXT,
  ADD COLUMN IF NOT EXISTS parse_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parse_finished_at TIMESTAMPTZ;

COMMENT ON COLUMN public.pdf_ingest_drafts.status IS
  'processing = AI parse in progress; pending_review = ready for human; failed = parse error; accepted/rejected = reviewed.';
