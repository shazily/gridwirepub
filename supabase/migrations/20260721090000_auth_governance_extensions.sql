-- Auth governance extensions: member user_type / identity_source + RPCs.
-- auth_config JSONB keys (documented): public_app_url, auth_mode, group_role_mappings.

DO $$ BEGIN
  CREATE TYPE public.org_member_user_type AS ENUM ('internal', 'external');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.org_member_identity_source AS ENUM ('local', 'sso');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS user_type public.org_member_user_type NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS identity_source public.org_member_identity_source NOT NULL DEFAULT 'local';

COMMENT ON COLUMN public.org_members.user_type IS 'internal = workforce; external = partner/contractor.';
COMMENT ON COLUMN public.org_members.identity_source IS 'local = password; sso = IdP-provisioned.';
COMMENT ON COLUMN public.organizations.auth_config IS
  'OIDC/SAML + public_app_url, auth_mode (local|sso|hybrid), group_role_mappings [{group,role}].';

-- Allow admins to set user_type (role changes stay on update_org_member_role).
CREATE OR REPLACE FUNCTION public.update_org_member_user_type(
  _member_id UUID,
  _user_type public.org_member_user_type
)
RETURNS public.org_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.org_members;
  _caller_role public.app_org_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _row FROM public.org_members WHERE id = _member_id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  _caller_role := public.get_org_role(_row.org_id);
  IF _caller_role IS NULL OR _caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners and admins can change member user type';
  END IF;

  UPDATE public.org_members SET user_type = _user_type WHERE id = _member_id RETURNING * INTO _row;
  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_org_member_user_type(UUID, public.org_member_user_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_org_member_user_type(UUID, public.org_member_user_type) TO authenticated;

-- Public portal branding: expose non-secret auth mode for sign-in UX.
DROP FUNCTION IF EXISTS public.get_public_portal_branding(TEXT);

CREATE OR REPLACE FUNCTION public.get_public_portal_branding(_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id UUID;
  _o public.organizations%ROWTYPE;
  _auth JSONB;
  _mode TEXT;
BEGIN
  IF _slug IS NULL OR TRIM(_slug) = '' THEN
    RETURN NULL;
  END IF;
  _org_id := public.resolve_org_portal_slug(_slug);
  IF _org_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO _o FROM public.organizations WHERE id = _org_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  _auth := COALESCE(_o.auth_config, '{}'::jsonb);
  _mode := COALESCE(NULLIF(trim(_auth->>'auth_mode'), ''), 'hybrid');
  IF _mode NOT IN ('local', 'sso', 'hybrid') THEN
    _mode := 'hybrid';
  END IF;

  RETURN jsonb_build_object(
    'slug', _o.portal_slug,
    'organization_name', _o.name,
    'platform_name', COALESCE(NULLIF(TRIM(_o.portal_platform_name), ''), _o.name),
    'logo_url', _o.portal_logo_url,
    'org_id', _o.id,
    'auth_mode', _mode,
    'sso_configured', (
      COALESCE(NULLIF(trim(_auth->>'oidc_issuer'), ''), '') <> ''
      OR COALESCE(NULLIF(trim(_auth->>'saml_metadata_url'), ''), '') <> ''
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_portal_branding(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_portal_branding(TEXT) TO anon, authenticated, service_role;
