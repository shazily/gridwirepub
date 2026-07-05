
-- ===== Enums =====
CREATE TYPE public.app_org_role AS ENUM ('owner','admin','member','viewer');
CREATE TYPE public.dataset_source_type AS ENUM ('upload','sftp','nfs','folder');
CREATE TYPE public.dataset_status AS ENUM ('draft','published','archived');
CREATE TYPE public.load_mode AS ENUM ('full','incremental');
CREATE TYPE public.field_masking AS ENUM ('none','mask','hash');
CREATE TYPE public.connector_type AS ENUM ('sftp','nfs','folder');

-- ===== updated_at helper =====
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

-- ===== Profiles =====
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== Organizations =====
CREATE TABLE public.organizations (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_org_updated BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.org_members (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_org_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

-- ===== Security-definer helpers (avoid RLS recursion) =====
CREATE OR REPLACE FUNCTION public.is_org_member(_org UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = _org AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org UUID, _roles public.app_org_role[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = _org AND user_id = auth.uid() AND role = ANY(_roles));
$$;

CREATE OR REPLACE FUNCTION public.get_org_role(_org UUID)
RETURNS public.app_org_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.org_members WHERE org_id = _org AND user_id = auth.uid();
$$;

-- Organizations policies
CREATE POLICY "Members view their orgs" ON public.organizations FOR SELECT USING (public.is_org_member(id));
CREATE POLICY "Owners/admins update org" ON public.organizations FOR UPDATE USING (public.has_org_role(id, ARRAY['owner','admin']::public.app_org_role[]));
CREATE POLICY "Owners delete org" ON public.organizations FOR DELETE USING (public.has_org_role(id, ARRAY['owner']::public.app_org_role[]));

-- org_members policies
CREATE POLICY "Members view co-members" ON public.org_members FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "Admins add members" ON public.org_members FOR INSERT WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));
CREATE POLICY "Admins update members" ON public.org_members FOR UPDATE USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));
CREATE POLICY "Admins remove members or self-leave" ON public.org_members FOR DELETE USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]) OR user_id = auth.uid());

-- Create organization + owner membership atomically
CREATE OR REPLACE FUNCTION public.create_organization(_name TEXT, _slug TEXT)
RETURNS public.organizations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org public.organizations;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.organizations (name, slug, created_by)
  VALUES (_name, _slug, auth.uid()) RETURNING * INTO _org;
  INSERT INTO public.org_members (org_id, user_id, role) VALUES (_org.id, auth.uid(), 'owner');
  RETURN _org;
END; $$;

-- ===== Datasets =====
CREATE TABLE public.datasets (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  source_type public.dataset_source_type NOT NULL DEFAULT 'upload',
  status public.dataset_status NOT NULL DEFAULT 'draft',
  current_version_id UUID,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datasets TO authenticated;
GRANT ALL ON public.datasets TO service_role;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_datasets_updated BEFORE UPDATE ON public.datasets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "Members view datasets" ON public.datasets FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "Members create datasets" ON public.datasets FOR INSERT WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[]));
CREATE POLICY "Members update datasets" ON public.datasets FOR UPDATE USING (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[]));
CREATE POLICY "Admins delete datasets" ON public.datasets FOR DELETE USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

CREATE TABLE public.dataset_versions (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  file_name TEXT,
  file_ref TEXT,
  sheet_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  schema_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  load_mode public.load_mode NOT NULL DEFAULT 'full',
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  diff_summary JSONB,
  has_macros BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, version_no)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dataset_versions TO authenticated;
GRANT ALL ON public.dataset_versions TO service_role;
ALTER TABLE public.dataset_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view versions" ON public.dataset_versions FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "Members create versions" ON public.dataset_versions FOR INSERT WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[]));
CREATE POLICY "Members update versions" ON public.dataset_versions FOR UPDATE USING (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[]));
CREATE POLICY "Admins delete versions" ON public.dataset_versions FOR DELETE USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

CREATE TABLE public.dataset_fields (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES public.dataset_versions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sheet_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  api_name TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'string',
  nullable BOOLEAN NOT NULL DEFAULT true,
  is_pii BOOLEAN NOT NULL DEFAULT false,
  masking public.field_masking NOT NULL DEFAULT 'none',
  position INTEGER NOT NULL DEFAULT 0,
  included BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dataset_fields TO authenticated;
GRANT ALL ON public.dataset_fields TO service_role;
ALTER TABLE public.dataset_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view fields" ON public.dataset_fields FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "Members manage fields" ON public.dataset_fields FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[]));

CREATE TABLE public.dataset_rows (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES public.dataset_versions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sheet_name TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_dataset_rows_version_sheet ON public.dataset_rows (version_id, sheet_name, row_index);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dataset_rows TO authenticated;
GRANT ALL ON public.dataset_rows TO service_role;
ALTER TABLE public.dataset_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view rows" ON public.dataset_rows FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "Members manage rows" ON public.dataset_rows FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[]));

-- ===== API keys =====
CREATE TABLE public.api_keys (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read']::text[],
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view api keys" ON public.api_keys FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "Admins manage api keys" ON public.api_keys FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

-- ===== Consumption events =====
CREATE TABLE public.consumption_events (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 200,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_consumption_org_created ON public.consumption_events (org_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumption_events TO authenticated;
GRANT ALL ON public.consumption_events TO service_role;
ALTER TABLE public.consumption_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view consumption" ON public.consumption_events FOR SELECT USING (public.is_org_member(org_id));

-- ===== Connectors =====
CREATE TABLE public.connectors (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type public.connector_type NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ref TEXT,
  schedule TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.connectors TO authenticated;
GRANT ALL ON public.connectors TO service_role;
ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_connectors_updated BEFORE UPDATE ON public.connectors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "Members view connectors" ON public.connectors FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "Admins manage connectors" ON public.connectors FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

-- ===== Alerts =====
CREATE TABLE public.alerts (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  recipients TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view alerts" ON public.alerts FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "Admins manage alerts" ON public.alerts FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));
