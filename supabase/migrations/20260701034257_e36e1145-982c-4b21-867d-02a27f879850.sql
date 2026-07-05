
-- ===== Invites =====
CREATE TABLE public.org_invites (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  role public.app_org_role NOT NULL DEFAULT 'contributor',
  note TEXT,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TIMESTAMPTZ,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_invites_org ON public.org_invites (org_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_invites TO authenticated;
GRANT ALL ON public.org_invites TO service_role;
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;
-- Only owners/admins can see or manage invite links for their org.
CREATE POLICY "Admins manage invites" ON public.org_invites FOR ALL
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

-- ===== Create invite (owner/admin) =====
CREATE OR REPLACE FUNCTION public.create_org_invite(
  _org UUID,
  _role public.app_org_role DEFAULT 'contributor',
  _note TEXT DEFAULT NULL,
  _expires_at TIMESTAMPTZ DEFAULT NULL,
  _max_uses INTEGER DEFAULT NULL
) RETURNS public.org_invites
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _invite public.org_invites; _token TEXT;
BEGIN
  IF NOT public.has_org_role(_org, ARRAY['owner','admin']::public.app_org_role[]) THEN
    RAISE EXCEPTION 'Only owners and admins can create invite links';
  END IF;
  IF _role NOT IN ('contributor','member','viewer') THEN
    RAISE EXCEPTION 'Invite role must be contributor, member or viewer';
  END IF;
  _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.org_invites (org_id, token, role, note, expires_at, max_uses)
  VALUES (_org, _token, _role, _note, _expires_at, _max_uses)
  RETURNING * INTO _invite;
  RETURN _invite;
END; $$;

-- ===== Public invite preview (safe subset only) =====
CREATE OR REPLACE FUNCTION public.get_invite_preview(_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv public.org_invites; _org public.organizations;
BEGIN
  SELECT * INTO _inv FROM public.org_invites WHERE token = _token;
  IF _inv.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;
  IF _inv.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
  END IF;
  IF _inv.expires_at IS NOT NULL AND _inv.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;
  IF _inv.max_uses IS NOT NULL AND _inv.use_count >= _inv.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'used_up');
  END IF;
  SELECT * INTO _org FROM public.organizations WHERE id = _inv.org_id;
  RETURN jsonb_build_object('valid', true, 'org_name', _org.name, 'role', _inv.role);
END; $$;

-- ===== Redeem invite (any authenticated user) =====
CREATE OR REPLACE FUNCTION public.accept_org_invite(_token TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv public.org_invites;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _inv FROM public.org_invites WHERE token = _token FOR UPDATE;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF _inv.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Invite has been revoked'; END IF;
  IF _inv.expires_at IS NOT NULL AND _inv.expires_at < now() THEN RAISE EXCEPTION 'Invite has expired'; END IF;
  IF _inv.max_uses IS NOT NULL AND _inv.use_count >= _inv.max_uses THEN RAISE EXCEPTION 'Invite has reached its usage limit'; END IF;

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (_inv.org_id, auth.uid(), _inv.role)
  ON CONFLICT (org_id, user_id) DO NOTHING;

  UPDATE public.org_invites SET use_count = use_count + 1 WHERE id = _inv.id;
  RETURN _inv.org_id;
END; $$;

-- Lock down execute privileges (match existing hardened pattern).
REVOKE EXECUTE ON FUNCTION public.create_org_invite(UUID, public.app_org_role, TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_org_invite(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_invite_preview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_org_invite(UUID, public.app_org_role, TEXT, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_org_invite(TEXT) TO authenticated;
-- Preview is intentionally callable by unauthenticated visitors landing on an
-- invite link. It only ever returns the org name + role for a known secret token.
GRANT EXECUTE ON FUNCTION public.get_invite_preview(TEXT) TO anon, authenticated;

-- ===== Widen dataset write policies to include contributors =====
DROP POLICY "Members create datasets" ON public.datasets;
CREATE POLICY "Members create datasets" ON public.datasets FOR INSERT
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[]));
DROP POLICY "Members update datasets" ON public.datasets;
CREATE POLICY "Members update datasets" ON public.datasets FOR UPDATE
  USING (public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[]));

DROP POLICY "Members create versions" ON public.dataset_versions;
CREATE POLICY "Members create versions" ON public.dataset_versions FOR INSERT
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[]));
DROP POLICY "Members update versions" ON public.dataset_versions;
CREATE POLICY "Members update versions" ON public.dataset_versions FOR UPDATE
  USING (public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[]));

DROP POLICY "Members manage fields" ON public.dataset_fields;
CREATE POLICY "Members manage fields" ON public.dataset_fields FOR ALL
  USING (public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[]));

DROP POLICY "Members manage rows" ON public.dataset_rows;
CREATE POLICY "Members manage rows" ON public.dataset_rows FOR ALL
  USING (public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','member','contributor']::public.app_org_role[]));
