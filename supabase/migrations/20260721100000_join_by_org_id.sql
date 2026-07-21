-- Allow join by organization ID (admin-gated Viewer self-join).
-- auth_config key: allow_join_by_org_id (boolean, default false / absent).

COMMENT ON COLUMN public.organizations.auth_config IS
  'OIDC/SAML + public_app_url, auth_mode (local|sso|hybrid), group_role_mappings [{group,role}], allow_join_by_org_id (boolean).';

-- Resolve org by UUID or portal slug / alias. Returns NULL when not found.
CREATE OR REPLACE FUNCTION public.resolve_org_join_ref(_ref TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _trimmed TEXT;
  _org_id UUID;
BEGIN
  _trimmed := TRIM(COALESCE(_ref, ''));
  IF _trimmed = '' THEN
    RETURN NULL;
  END IF;

  -- UUID form (accept with or without braces / case).
  IF _trimmed ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO _org_id FROM public.organizations WHERE id = _trimmed::uuid;
    IF _org_id IS NOT NULL THEN
      RETURN _org_id;
    END IF;
  END IF;

  RETURN public.resolve_org_portal_slug(_trimmed);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_org_join_ref(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_org_join_ref(TEXT) TO service_role;

-- Preview for /join/:ref — only returns org name when join is enabled.
-- Never distinguishes "not found" vs "join disabled" (anti-enumeration).
CREATE OR REPLACE FUNCTION public.get_join_preview(_ref TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id UUID;
  _o public.organizations%ROWTYPE;
  _allowed BOOLEAN;
BEGIN
  _org_id := public.resolve_org_join_ref(_ref);
  IF _org_id IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT * INTO _o FROM public.organizations WHERE id = _org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  _allowed := COALESCE((_o.auth_config->>'allow_join_by_org_id')::boolean, false);
  IF NOT _allowed THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'org_name', _o.name,
    'org_id', _o.id,
    'portal_slug', _o.portal_slug
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_join_preview(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_join_preview(TEXT) TO service_role;

-- Authenticated self-join as Viewer when allow_join_by_org_id is true.
CREATE OR REPLACE FUNCTION public.join_organization_by_ref(_ref TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id UUID;
  _o public.organizations%ROWTYPE;
  _allowed BOOLEAN;
  _existing public.org_members%ROWTYPE;
  _generic CONSTANT TEXT := 'Unable to join this organization';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '%', _generic;
  END IF;

  _org_id := public.resolve_org_join_ref(_ref);
  IF _org_id IS NULL THEN
    RAISE EXCEPTION '%', _generic;
  END IF;

  SELECT * INTO _o FROM public.organizations WHERE id = _org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', _generic;
  END IF;

  _allowed := COALESCE((_o.auth_config->>'allow_join_by_org_id')::boolean, false);
  IF NOT _allowed THEN
    RAISE EXCEPTION '%', _generic;
  END IF;

  SELECT * INTO _existing
  FROM public.org_members
  WHERE org_id = _org_id AND user_id = auth.uid();

  IF FOUND THEN
    IF _existing.disabled_at IS NOT NULL THEN
      RAISE EXCEPTION '%', _generic;
    END IF;
    RETURN _org_id;
  END IF;

  INSERT INTO public.org_members (org_id, user_id, role, user_type, identity_source)
  VALUES (
    _org_id,
    auth.uid(),
    'viewer'::public.app_org_role,
    'external'::public.org_member_user_type,
    'local'::public.org_member_identity_source
  )
  ON CONFLICT (org_id, user_id) DO NOTHING;

  SELECT * INTO _existing
  FROM public.org_members
  WHERE org_id = _org_id AND user_id = auth.uid();

  IF NOT FOUND OR _existing.disabled_at IS NOT NULL THEN
    RAISE EXCEPTION '%', _generic;
  END IF;

  RETURN _org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_organization_by_ref(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_organization_by_ref(TEXT) TO authenticated;
