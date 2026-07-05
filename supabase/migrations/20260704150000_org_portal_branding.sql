-- Portal branding for deployed instances: custom platform name, logo, and default org
-- shown on the public sign-in landing page.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS portal_platform_name TEXT,
  ADD COLUMN IF NOT EXISTS portal_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS is_portal_default BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.portal_platform_name IS
  'Title shown on the public portal (defaults to organization name).';
COMMENT ON COLUMN public.organizations.portal_logo_url IS
  'HTTPS or data-URL logo for the public portal and sign-in page.';
COMMENT ON COLUMN public.organizations.is_portal_default IS
  'When true, this org branding is used on the unauthenticated portal landing page.';

-- First organization on an instance becomes the portal default.
UPDATE public.organizations o
SET is_portal_default = true
WHERE o.id = (
  SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE is_portal_default = true);

CREATE OR REPLACE FUNCTION public.create_organization(_name TEXT, _slug TEXT)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org public.organizations;
  _set_portal_default BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  _set_portal_default := NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE is_portal_default = true
  );

  INSERT INTO public.organizations (name, slug, created_by, is_portal_default)
  VALUES (_name, _slug, auth.uid(), _set_portal_default)
  RETURNING * INTO _org;

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (_org.id, auth.uid(), 'owner');

  RETURN _org;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_portal_branding()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _o public.organizations%ROWTYPE;
BEGIN
  SELECT * INTO _o
  FROM public.organizations
  WHERE is_portal_default = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF _o.id IS NULL THEN
    SELECT * INTO _o
    FROM public.organizations
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF _o.id IS NULL THEN
    RETURN json_build_object(
      'organization_name', NULL,
      'platform_name', 'Gridwire',
      'logo_url', NULL
    );
  END IF;

  RETURN json_build_object(
    'organization_name', _o.name,
    'platform_name', COALESCE(NULLIF(TRIM(_o.portal_platform_name), ''), _o.name),
    'logo_url', _o.portal_logo_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_portal_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_portal_branding() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_portal_default_org(_org UUID)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.organizations;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_org_role(_org, ARRAY['owner']::public.app_org_role[]) THEN
    RAISE EXCEPTION 'Only organization owners can set the public portal organization';
  END IF;

  UPDATE public.organizations SET is_portal_default = false WHERE is_portal_default = true;
  UPDATE public.organizations
  SET is_portal_default = true
  WHERE id = _org
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_portal_default_org(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_portal_default_org(UUID) TO authenticated;
