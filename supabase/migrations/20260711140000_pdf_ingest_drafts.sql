-- AI PDF ingest drafts: stage ParsedWorkbook for mandatory human review before publish.

CREATE TABLE IF NOT EXISTS public.pdf_ingest_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('upload', 'email', 'connector')),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'accepted', 'rejected')),
  file_name TEXT NOT NULL,
  file_storage_ref TEXT,
  file_bytes_hash TEXT,
  parsed_workbook JSONB NOT NULL,
  confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_model TEXT,
  page_count INT,
  email_message_id UUID,
  connector_id UUID REFERENCES public.connectors(id) ON DELETE SET NULL,
  target_dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  created_by UUID,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pdf_ingest_drafts_org_status_idx
  ON public.pdf_ingest_drafts (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS pdf_ingest_drafts_email_msg_idx
  ON public.pdf_ingest_drafts (email_message_id)
  WHERE email_message_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.pdf_ingest_drafts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.pdf_ingest_drafts TO authenticated;

ALTER TABLE public.pdf_ingest_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members view pdf drafts" ON public.pdf_ingest_drafts;
CREATE POLICY "Org members view pdf drafts" ON public.pdf_ingest_drafts
  FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id FROM public.org_members om WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Editors update pdf drafts" ON public.pdf_ingest_drafts;
CREATE POLICY "Editors update pdf drafts" ON public.pdf_ingest_drafts
  FOR UPDATE TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id FROM public.org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin', 'member', 'contributor')
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT om.org_id FROM public.org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin', 'member', 'contributor')
    )
  );

DROP POLICY IF EXISTS "Editors insert pdf drafts" ON public.pdf_ingest_drafts;
CREATE POLICY "Editors insert pdf drafts" ON public.pdf_ingest_drafts
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT om.org_id FROM public.org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin', 'member', 'contributor')
    )
  );

COMMENT ON TABLE public.pdf_ingest_drafts IS
  'AI-parsed PDF tables awaiting human review before publishVersionServer.';
