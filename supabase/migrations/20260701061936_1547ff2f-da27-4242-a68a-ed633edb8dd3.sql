-- 1. Per-field hash algorithm choice
CREATE TYPE public.field_hash_algo AS ENUM ('sha256','sha512','sha3_256','sha3_512','hmac_sha256','hmac_sha512');

ALTER TABLE public.dataset_fields
  ADD COLUMN IF NOT EXISTS hash_algo public.field_hash_algo NOT NULL DEFAULT 'sha256';

-- 2. Access-control audit log
CREATE TABLE public.audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id UUID,
  actor_label TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  dataset_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_org_created ON public.audit_events (org_id, created_at DESC);
CREATE INDEX idx_audit_events_dataset ON public.audit_events (dataset_id);

GRANT SELECT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and admins read audit events"
  ON public.audit_events FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

-- 3. Security-definer logger for control-plane events
CREATE OR REPLACE FUNCTION public.log_audit_event(
  _org UUID,
  _action TEXT,
  _resource_type TEXT DEFAULT NULL,
  _resource_id TEXT DEFAULT NULL,
  _dataset_id UUID DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(_org) THEN
    RAISE EXCEPTION 'Not authorized to write audit events for this organization';
  END IF;
  INSERT INTO public.audit_events (org_id, actor_id, actor_label, action, resource_type, resource_id, dataset_id, metadata)
  VALUES (
    _org,
    auth.uid(),
    (SELECT display_name FROM public.profiles WHERE id = auth.uid()),
    _action,
    _resource_type,
    _resource_id,
    _dataset_id,
    COALESCE(_metadata, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(UUID, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(UUID, TEXT, TEXT, TEXT, UUID, JSONB) TO authenticated;