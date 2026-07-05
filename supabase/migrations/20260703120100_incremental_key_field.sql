-- Key column flag for incremental upserts (one per sheet in the field-mapping wizard).
ALTER TABLE public.dataset_fields
  ADD COLUMN IF NOT EXISTS is_key BOOLEAN NOT NULL DEFAULT false;
