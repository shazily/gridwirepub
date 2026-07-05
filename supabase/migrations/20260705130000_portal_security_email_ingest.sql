-- Portal slug aliases, IP allowlist, email ingest foundation.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS portal_slug TEXT,
  ADD COLUMN IF NOT EXISTS portal_access_enforced BOOLEAN NOT NULL DEFAULT false;

UPDATE public.organizations SET portal_slug = slug WHERE portal_slug IS NULL;
ALTER TABLE public.organizations ALTER COLUMN portal_slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_portal_slug_key ON public.organizations (portal_slug);

CREATE TABLE IF NOT EXISTS public.organization_slug_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_slug_aliases_org_idx ON public.organization_slug_aliases (org_id);
GRANT SELECT, INSERT, DELETE ON public.organization_slug_aliases TO authenticated, service_role;
ALTER TABLE public.organization_slug_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage slug aliases" ON public.organization_slug_aliases;
CREATE POLICY "Admins manage slug aliases" ON public.organization_slug_aliases
  FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

CREATE TABLE IF NOT EXISTS public.portal_ip_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cidr TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, cidr)
);
CREATE INDEX IF NOT EXISTS portal_ip_allowlist_org_idx ON public.portal_ip_allowlist (org_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_ip_allowlist TO authenticated, service_role;
ALTER TABLE public.portal_ip_allowlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage portal IP allowlist" ON public.portal_ip_allowlist;
CREATE POLICY "Admins manage portal IP allowlist" ON public.portal_ip_allowlist
  FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

CREATE OR REPLACE FUNCTION public.seed_portal_ip_allowlist(_org_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.portal_ip_allowlist (org_id, cidr, label, is_system) VALUES
    (_org_id, '127.0.0.0/8', 'Loopback', true),
    (_org_id, '10.0.0.0/8', 'Private RFC1918', true),
    (_org_id, '172.16.0.0/12', 'Private RFC1918', true),
    (_org_id, '192.168.0.0/16', 'Private RFC1918', true)
  ON CONFLICT (org_id, cidr) DO NOTHING;
END; $$;

INSERT INTO public.portal_ip_allowlist (org_id, cidr, label, is_system)
SELECT o.id, v.cidr, v.label, true
FROM public.organizations o
CROSS JOIN (VALUES
  ('127.0.0.0/8', 'Loopback'),
  ('10.0.0.0/8', 'Private RFC1918'),
  ('172.16.0.0/12', 'Private RFC1918'),
  ('192.168.0.0/16', 'Private RFC1918')
) AS v(cidr, label)
ON CONFLICT (org_id, cidr) DO NOTHING;

CREATE OR REPLACE FUNCTION public.resolve_org_portal_slug(_slug TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM public.organizations WHERE portal_slug = TRIM(_slug) LIMIT 1),
    (SELECT org_id FROM public.organization_slug_aliases WHERE slug = TRIM(_slug) LIMIT 1)
  );
$$;
GRANT EXECUTE ON FUNCTION public.resolve_org_portal_slug(TEXT) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_public_portal_branding(TEXT);

CREATE OR REPLACE FUNCTION public.get_public_portal_branding(_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org_id UUID;
  _o public.organizations%ROWTYPE;
BEGIN
  IF _slug IS NULL OR TRIM(_slug) = '' THEN RETURN NULL; END IF;
  _org_id := public.resolve_org_portal_slug(_slug);
  IF _org_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _o FROM public.organizations WHERE id = _org_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'slug', _o.portal_slug,
    'organization_name', _o.name,
    'platform_name', COALESCE(NULLIF(TRIM(_o.portal_platform_name), ''), _o.name),
    'logo_url', _o.portal_logo_url,
    'org_id', _o.id
  );
END; $$;

REVOKE ALL ON FUNCTION public.get_public_portal_branding(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_portal_branding(TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.regenerate_portal_slug(_org_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old TEXT;
  _new TEXT;
BEGIN
  IF NOT public.has_org_role(_org_id, ARRAY['owner','admin']::public.app_org_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT portal_slug INTO _old FROM public.organizations WHERE id = _org_id;
  IF _old IS NULL THEN RAISE EXCEPTION 'Organization not found'; END IF;
  _new := _old || '-' || substr(md5(random()::text), 1, 4);
  INSERT INTO public.organization_slug_aliases (org_id, slug) VALUES (_org_id, _old)
  ON CONFLICT (slug) DO NOTHING;
  UPDATE public.organizations SET portal_slug = _new, updated_at = now() WHERE id = _org_id;
  RETURN _new;
END; $$;
GRANT EXECUTE ON FUNCTION public.regenerate_portal_slug(UUID) TO authenticated, service_role;

-- Email ingest
CREATE TABLE IF NOT EXISTS public.email_ingest_mailboxes (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  inbound_address TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.email_ingest_mailboxes TO authenticated, service_role;
ALTER TABLE public.email_ingest_mailboxes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage email mailboxes" ON public.email_ingest_mailboxes;
CREATE POLICY "Admins manage email mailboxes" ON public.email_ingest_mailboxes
  FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

CREATE TABLE IF NOT EXISTS public.email_ingest_sender_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email_pattern TEXT NOT NULL,
  label TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email_pattern)
);
GRANT SELECT, INSERT, DELETE ON public.email_ingest_sender_allowlist TO authenticated, service_role;
ALTER TABLE public.email_ingest_sender_allowlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage sender allowlist" ON public.email_ingest_sender_allowlist;
CREATE POLICY "Admins manage sender allowlist" ON public.email_ingest_sender_allowlist
  FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

CREATE TABLE IF NOT EXISTS public.email_ingest_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject_pattern TEXT,
  attachment_pattern TEXT NOT NULL DEFAULT '*.xlsx',
  target_dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_ingest_templates TO authenticated, service_role;
ALTER TABLE public.email_ingest_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage email templates" ON public.email_ingest_templates;
CREATE POLICY "Admins manage email templates" ON public.email_ingest_templates
  FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

CREATE TABLE IF NOT EXISTS public.email_ingest_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  from_address TEXT NOT NULL,
  subject TEXT,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.email_ingest_messages TO service_role;
GRANT SELECT ON public.email_ingest_messages TO authenticated;
ALTER TABLE public.email_ingest_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view ingest messages" ON public.email_ingest_messages;
CREATE POLICY "Admins view ingest messages" ON public.email_ingest_messages
  FOR SELECT USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

-- Patch create_organization to set portal_slug + seed IPs
CREATE OR REPLACE FUNCTION public.create_organization(_name TEXT, _slug TEXT)
RETURNS public.organizations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org public.organizations;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.organizations (name, slug, portal_slug, created_by)
  VALUES (_name, _slug, _slug, auth.uid()) RETURNING * INTO _org;
  INSERT INTO public.org_members (org_id, user_id, role) VALUES (_org.id, auth.uid(), 'owner');
  PERFORM public.seed_portal_ip_allowlist(_org.id);
  RETURN _org;
END; $$;
