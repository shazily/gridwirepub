-- Structure-first PDF wizard: discover layout → approve → extract data.
-- Recurring layouts saved as pdf_ingest_templates for SFTP/folder connectors.

CREATE TABLE IF NOT EXISTS public.pdf_ingest_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  file_name_pattern TEXT NOT NULL DEFAULT '*.pdf',
  structure_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  connector_id UUID REFERENCES public.connectors(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pdf_ingest_templates_org_idx
  ON public.pdf_ingest_templates (org_id, active, created_at DESC);

CREATE INDEX IF NOT EXISTS pdf_ingest_templates_connector_idx
  ON public.pdf_ingest_templates (connector_id)
  WHERE connector_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_ingest_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_ingest_templates TO authenticated;

ALTER TABLE public.pdf_ingest_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members view pdf templates" ON public.pdf_ingest_templates;
CREATE POLICY "Org members view pdf templates" ON public.pdf_ingest_templates
  FOR SELECT USING (
    public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[])
  );

DROP POLICY IF EXISTS "Editors manage pdf templates" ON public.pdf_ingest_templates;
CREATE POLICY "Editors manage pdf templates" ON public.pdf_ingest_templates
  FOR ALL USING (
    public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[])
  );

ALTER TABLE public.pdf_ingest_drafts
  DROP CONSTRAINT IF EXISTS pdf_ingest_drafts_status_check;

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
  ADD COLUMN IF NOT EXISTS structure_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.pdf_ingest_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parse_phase TEXT NOT NULL DEFAULT 'structure';

ALTER TABLE public.pdf_ingest_drafts
  DROP CONSTRAINT IF EXISTS pdf_ingest_drafts_parse_phase_check;

ALTER TABLE public.pdf_ingest_drafts
  ADD CONSTRAINT pdf_ingest_drafts_parse_phase_check
  CHECK (parse_phase IN ('structure', 'extract'));

COMMENT ON TABLE public.pdf_ingest_templates IS
  'Saved PDF table layouts for recurring ingest (upload, SFTP, folder).';

COMMENT ON COLUMN public.pdf_ingest_drafts.structure_snapshot IS
  'AI-discovered (and human-curated) table layout: headers, page hints, sample rows only.';

COMMENT ON COLUMN public.pdf_ingest_drafts.status IS
  'processing=structure discovery; pending_structure=curate layout; extracting=full data load; pending_review=publish gate.';

COMMENT ON COLUMN public.pdf_ingest_drafts.parse_phase IS
  'structure = discover layout; extract = load full table rows after approval.';
