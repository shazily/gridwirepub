-- Multiple ingest address aliases per organization (in addition to primary inbound_address).

CREATE TABLE IF NOT EXISTS public.email_ingest_mailbox_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inbound_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_ingest_mailbox_aliases_address_unique UNIQUE (inbound_address),
  CONSTRAINT email_ingest_mailbox_aliases_address_format CHECK (
    inbound_address ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  )
);

CREATE INDEX IF NOT EXISTS email_ingest_mailbox_aliases_org_idx
  ON public.email_ingest_mailbox_aliases (org_id);

COMMENT ON TABLE public.email_ingest_mailbox_aliases IS
  'Extra inbound addresses that route to the same org mailbox (enabled flag lives on email_ingest_mailboxes).';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_ingest_mailbox_aliases TO authenticated, service_role;

ALTER TABLE public.email_ingest_mailbox_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage email mailbox aliases" ON public.email_ingest_mailbox_aliases;
CREATE POLICY "Admins manage email mailbox aliases" ON public.email_ingest_mailbox_aliases
  FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

-- Resolve org from primary address or alias (enabled mailbox only).
CREATE OR REPLACE FUNCTION public.resolve_email_ingest_org(_address TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _addr TEXT;
  _org UUID;
BEGIN
  _addr := lower(trim(COALESCE(_address, '')));
  IF _addr = '' THEN
    RETURN NULL;
  END IF;

  SELECT m.org_id INTO _org
  FROM public.email_ingest_mailboxes m
  WHERE lower(m.inbound_address) = _addr AND m.enabled = true
  LIMIT 1;
  IF _org IS NOT NULL THEN
    RETURN _org;
  END IF;

  SELECT a.org_id INTO _org
  FROM public.email_ingest_mailbox_aliases a
  INNER JOIN public.email_ingest_mailboxes m ON m.org_id = a.org_id
  WHERE lower(a.inbound_address) = _addr AND m.enabled = true
  LIMIT 1;

  RETURN _org;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_email_ingest_org(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_email_ingest_org(TEXT) TO service_role;
