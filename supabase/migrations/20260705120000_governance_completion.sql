-- Governance completion: row limits, invite upload caps, accepted invite tracking.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS max_rows_per_sheet BIGINT NOT NULL DEFAULT 5000;

COMMENT ON COLUMN public.organizations.max_rows_per_sheet IS
  'Hard cap on parsed rows per sheet at ingest (replaces global 5000 default).';

ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS accepted_invite_id UUID REFERENCES public.org_invites(id) ON DELETE SET NULL;

-- Extend invite creation with upload caps.
CREATE OR REPLACE FUNCTION public.create_org_invite(
  _org UUID,
  _role public.app_org_role DEFAULT 'contributor',
  _note TEXT DEFAULT NULL,
  _expires_at TIMESTAMPTZ DEFAULT NULL,
  _max_uses INTEGER DEFAULT NULL,
  _max_upload_bytes BIGINT DEFAULT NULL,
  _max_file_bytes BIGINT DEFAULT NULL
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
  INSERT INTO public.org_invites (
    org_id, token, role, note, expires_at, max_uses, max_upload_bytes, max_file_bytes
  )
  VALUES (_org, _token, _role, _note, _expires_at, _max_uses, _max_upload_bytes, _max_file_bytes)
  RETURNING * INTO _invite;
  RETURN _invite;
END;
$$;

REVOKE ALL ON FUNCTION public.create_org_invite(UUID, public.app_org_role, TEXT, TIMESTAMPTZ, INTEGER, BIGINT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_org_invite(UUID, public.app_org_role, TEXT, TIMESTAMPTZ, INTEGER, BIGINT, BIGINT) TO authenticated;

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

  INSERT INTO public.org_members (org_id, user_id, role, accepted_invite_id)
  VALUES (_inv.org_id, auth.uid(), _inv.role, _inv.id)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET accepted_invite_id = COALESCE(public.org_members.accepted_invite_id, EXCLUDED.accepted_invite_id);

  UPDATE public.org_invites SET use_count = use_count + 1 WHERE id = _inv.id;
  RETURN _inv.org_id;
END;
$$;

-- Invite cumulative upload cap in quota check.
CREATE OR REPLACE FUNCTION public.check_storage_quota(
  _org_id UUID,
  _user_id UUID,
  _bytes BIGINT,
  _invite_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org RECORD;
  _team_id UUID;
  _team RECORD;
  _member RECORD;
  _invite RECORD;
  _user_used BIGINT;
  _invite_used BIGINT;
BEGIN
  IF _bytes < 0 THEN
    RAISE EXCEPTION 'bytes must be non-negative';
  END IF;

  SELECT * INTO _org FROM public.organizations WHERE id = _org_id;
  IF _org.id IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF (_org.storage_used_bytes + _bytes) > _org.storage_quota_bytes THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'org_quota_exceeded',
      'used', _org.storage_used_bytes, 'quota', _org.storage_quota_bytes);
  END IF;

  IF _invite_id IS NOT NULL THEN
    SELECT * INTO _invite FROM public.org_invites WHERE id = _invite_id AND org_id = _org_id;
    IF _invite.id IS NOT NULL AND _invite.max_file_bytes IS NOT NULL AND _bytes > _invite.max_file_bytes THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'invite_file_limit',
        'limit', _invite.max_file_bytes);
    END IF;
    IF _invite.id IS NOT NULL AND _invite.max_upload_bytes IS NOT NULL THEN
      SELECT COALESCE(SUM(bytes_delta), 0) INTO _invite_used
      FROM public.storage_usage_events
      WHERE org_id = _org_id
        AND metadata->>'invite_id' = _invite_id::text;
      IF (_invite_used + _bytes) > _invite.max_upload_bytes THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'invite_upload_limit',
          'used', _invite_used, 'quota', _invite.max_upload_bytes);
      END IF;
    END IF;
  END IF;

  IF _user_id IS NOT NULL THEN
    SELECT * INTO _member FROM public.org_members WHERE org_id = _org_id AND user_id = _user_id;
    _team_id := _member.team_id;
    IF _member.accepted_invite_id IS NOT NULL AND _invite_id IS NULL THEN
      SELECT * INTO _invite FROM public.org_invites WHERE id = _member.accepted_invite_id;
      IF _invite.max_file_bytes IS NOT NULL AND _bytes > _invite.max_file_bytes THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'invite_file_limit',
          'limit', _invite.max_file_bytes);
      END IF;
    END IF;
    IF _member.storage_quota_bytes IS NOT NULL THEN
      SELECT COALESCE(SUM(bytes_delta), 0) INTO _user_used
      FROM public.storage_usage_events WHERE org_id = _org_id AND user_id = _user_id;
      IF (_user_used + _bytes) > _member.storage_quota_bytes THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'user_quota_exceeded',
          'used', _user_used, 'quota', _member.storage_quota_bytes);
      END IF;
    END IF;
  END IF;

  IF _team_id IS NOT NULL THEN
    SELECT * INTO _team FROM public.teams WHERE id = _team_id;
    IF _team.storage_quota_bytes IS NOT NULL
       AND (_team.storage_used_bytes + _bytes) > _team.storage_quota_bytes THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'team_quota_exceeded',
        'used', _team.storage_used_bytes, 'quota', _team.storage_quota_bytes);
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;
