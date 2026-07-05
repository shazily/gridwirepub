-- Enterprise governance: storage, quotas, teams, auth config, lineage, contracts, ownership.

-- ===== Organizations: storage, auth, quotas ==================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS storage_config JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT NOT NULL DEFAULT 10737418240,
  ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auth_config JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS smtp_config JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sms_config JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mfa_required_roles TEXT[] NOT NULL DEFAULT ARRAY['owner','admin']::TEXT[],
  ADD COLUMN IF NOT EXISTS max_upload_bytes BIGINT NOT NULL DEFAULT 52428800;

COMMENT ON COLUMN public.organizations.storage_config IS
  'Object storage profile: provider (minio|s3|azure), endpoint, bucket, prefix, region.';
COMMENT ON COLUMN public.organizations.storage_quota_bytes IS 'Org-wide storage pool in bytes.';
COMMENT ON COLUMN public.organizations.auth_config IS 'OIDC/SAML IdP metadata (encrypted at app layer when secrets present).';

-- ===== Teams (nested quota delegation) ========================================
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_quota_bytes BIGINT,
  storage_used_bytes BIGINT NOT NULL DEFAULT 0,
  lead_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view teams" ON public.teams FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "Admins manage teams" ON public.teams FOR ALL
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));
CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT;

-- ===== Storage allocations & usage ============================================
CREATE TYPE public.storage_allocation_target AS ENUM ('org', 'team', 'user', 'invite');

CREATE TABLE IF NOT EXISTS public.storage_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_type public.storage_allocation_target NOT NULL,
  target_id UUID NOT NULL,
  quota_bytes BIGINT NOT NULL CHECK (quota_bytes >= 0),
  allocated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, target_type, target_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_allocations TO authenticated;
GRANT ALL ON public.storage_allocations TO service_role;
ALTER TABLE public.storage_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage storage allocations" ON public.storage_allocations FOR ALL
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));
CREATE POLICY "Members view storage allocations" ON public.storage_allocations FOR SELECT
  USING (public.is_org_member(org_id));

CREATE TABLE IF NOT EXISTS public.storage_usage_events (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  version_id UUID REFERENCES public.dataset_versions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  bytes_delta BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.storage_usage_events TO authenticated;
GRANT ALL ON public.storage_usage_events TO service_role;
ALTER TABLE public.storage_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view storage usage" ON public.storage_usage_events FOR SELECT
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

ALTER TABLE public.org_invites
  ADD COLUMN IF NOT EXISTS max_upload_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS max_file_bytes BIGINT;

-- ===== Dataset ownership & blob refs ==========================================
ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS data_steward_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.dataset_versions
  ADD COLUMN IF NOT EXISTS parquet_ref TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ===== Lineage ================================================================
CREATE TYPE public.lineage_node_type AS ENUM (
  'source_file', 'connector', 'dataset', 'version', 'field', 'transform', 'api_consumer', 'user'
);
CREATE TYPE public.lineage_relationship AS ENUM (
  'uploaded_by', 'derived_from', 'mapped_to', 'type_changed', 'formula_in',
  'published_as', 'consumed_by', 'ingested_from'
);

CREATE TABLE IF NOT EXISTS public.lineage_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  node_type public.lineage_node_type NOT NULL,
  label TEXT NOT NULL,
  ref_type TEXT,
  ref_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lineage_nodes_org_ref ON public.lineage_nodes (org_id, ref_type, ref_id);

CREATE TABLE IF NOT EXISTS public.lineage_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES public.lineage_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES public.lineage_nodes(id) ON DELETE CASCADE,
  relationship public.lineage_relationship NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_org ON public.lineage_edges (org_id, created_at DESC);

GRANT SELECT ON public.lineage_nodes TO authenticated;
GRANT SELECT ON public.lineage_edges TO authenticated;
GRANT ALL ON public.lineage_nodes TO service_role;
GRANT ALL ON public.lineage_edges TO service_role;
ALTER TABLE public.lineage_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lineage_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view lineage nodes" ON public.lineage_nodes FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "Members view lineage edges" ON public.lineage_edges FOR SELECT
  USING (public.is_org_member(org_id));

-- ===== Data contracts =========================================================
CREATE TABLE IF NOT EXISTS public.dataset_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  version_id UUID REFERENCES public.dataset_versions(id) ON DELETE SET NULL,
  contract_version TEXT NOT NULL DEFAULT '1.0.0',
  contract_body JSONB NOT NULL,
  format TEXT NOT NULL DEFAULT 'odcs' CHECK (format IN ('odcs', 'json_schema')),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_dataset_contracts_dataset ON public.dataset_contracts (dataset_id, published_at DESC);
GRANT SELECT ON public.dataset_contracts TO authenticated;
GRANT ALL ON public.dataset_contracts TO service_role;
ALTER TABLE public.dataset_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view contracts" ON public.dataset_contracts FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "Editors manage contracts" ON public.dataset_contracts FOR ALL
  USING (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','member']::public.app_org_role[]));

-- ===== Audit: insert-only =====================================================
CREATE OR REPLACE FUNCTION public.audit_events_insert_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'audit_events is insert-only';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_events_insert_only ON public.audit_events;
CREATE TRIGGER trg_audit_events_insert_only
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_events_insert_only();

CREATE OR REPLACE FUNCTION public.lineage_edges_insert_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'lineage_edges is insert-only';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lineage_edges_insert_only ON public.lineage_edges;
CREATE TRIGGER trg_lineage_edges_insert_only
  BEFORE UPDATE OR DELETE ON public.lineage_edges
  FOR EACH ROW EXECUTE FUNCTION public.lineage_edges_insert_only();

-- ===== Storage quota RPC ======================================================
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
  END IF;

  IF _user_id IS NOT NULL THEN
    SELECT * INTO _member FROM public.org_members WHERE org_id = _org_id AND user_id = _user_id;
    _team_id := _member.team_id;
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

REVOKE ALL ON FUNCTION public.check_storage_quota(UUID, UUID, BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_storage_quota(UUID, UUID, BIGINT, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_storage_usage(
  _org_id UUID,
  _user_id UUID,
  _bytes_delta BIGINT,
  _event_type TEXT,
  _team_id UUID DEFAULT NULL,
  _dataset_id UUID DEFAULT NULL,
  _version_id UUID DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.storage_usage_events (
    org_id, team_id, user_id, dataset_id, version_id, event_type, bytes_delta, metadata
  ) VALUES (
    _org_id, _team_id, _user_id, _dataset_id, _version_id, _event_type, _bytes_delta, _metadata
  );
  UPDATE public.organizations
  SET storage_used_bytes = GREATEST(0, storage_used_bytes + _bytes_delta)
  WHERE id = _org_id;
  IF _team_id IS NOT NULL THEN
    UPDATE public.teams
    SET storage_used_bytes = GREATEST(0, storage_used_bytes + _bytes_delta)
    WHERE id = _team_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_storage_usage(UUID, UUID, BIGINT, TEXT, UUID, UUID, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_storage_usage(UUID, UUID, BIGINT, TEXT, UUID, UUID, UUID, JSONB) TO service_role;
