-- Per-organization portal URLs: /portal/{slug}. Drop instance-wide default org selection.

CREATE OR REPLACE FUNCTION public.create_organization(_name TEXT, _slug TEXT)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org public.organizations;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES (_name, _slug, auth.uid())
  RETURNING * INTO _org;

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (_org.id, auth.uid(), 'owner');

  RETURN _org;
END;
$$;

DROP FUNCTION IF EXISTS public.get_public_portal_branding();

CREATE OR REPLACE FUNCTION public.get_public_portal_branding(_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _o public.organizations%ROWTYPE;
BEGIN
  IF _slug IS NULL OR TRIM(_slug) = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _o
  FROM public.organizations
  WHERE slug = TRIM(_slug)
  LIMIT 1;

  IF _o.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'slug', _o.slug,
    'organization_name', _o.name,
    'platform_name', COALESCE(NULLIF(TRIM(_o.portal_platform_name), ''), _o.name),
    'logo_url', _o.portal_logo_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_portal_branding(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_portal_branding(TEXT) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.set_portal_default_org(UUID);
