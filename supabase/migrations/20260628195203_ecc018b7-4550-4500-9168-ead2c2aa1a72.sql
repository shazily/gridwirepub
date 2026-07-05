ALTER TABLE public.connectors ADD COLUMN IF NOT EXISTS dataset_id uuid REFERENCES public.datasets(id) ON DELETE SET NULL;
ALTER TABLE public.connectors ADD COLUMN IF NOT EXISTS last_test_at timestamptz;

CREATE TABLE public.connector_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES public.connectors(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'poll',
  status text NOT NULL DEFAULT 'queued',
  message text,
  files_found int NOT NULL DEFAULT 0,
  files_ingested int NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.connector_runs TO authenticated;
GRANT ALL ON public.connector_runs TO service_role;
ALTER TABLE public.connector_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read connector_runs" ON public.connector_runs FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "managers write connector_runs" ON public.connector_runs FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));
CREATE POLICY "managers delete connector_runs" ON public.connector_runs FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

CREATE TABLE public.alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'info',
  email_status text NOT NULL DEFAULT 'skipped',
  recipients text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_events TO authenticated;
GRANT ALL ON public.alert_events TO service_role;
ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read alert_events" ON public.alert_events FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "members write alert_events" ON public.alert_events FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));