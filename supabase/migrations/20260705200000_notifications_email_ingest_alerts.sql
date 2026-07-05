-- Workspace notifications vs admin alerts; email-ingest notification recipients; read state.

ALTER TABLE public.alert_events
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'workspace';

COMMENT ON COLUMN public.alert_events.audience IS
  'workspace = visible to all org members in Notifications; admins = admin console alert email config only.';

CREATE INDEX IF NOT EXISTS idx_alert_events_org_audience_created
  ON public.alert_events (org_id, audience, created_at DESC);

DROP POLICY IF EXISTS "members read alert_events" ON public.alert_events;
CREATE POLICY "members read alert_events" ON public.alert_events
  FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id)
    AND (
      audience = 'workspace'
      OR public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[])
    )
  );

CREATE TABLE IF NOT EXISTS public.email_ingest_notification_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  notify_on_success boolean NOT NULL DEFAULT true,
  notify_on_failure boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_ingest_notification_recipients TO authenticated, service_role;
ALTER TABLE public.email_ingest_notification_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage ingest notification recipients" ON public.email_ingest_notification_recipients;
CREATE POLICY "Admins manage ingest notification recipients" ON public.email_ingest_notification_recipients
  FOR ALL USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[]));

CREATE TABLE IF NOT EXISTS public.user_notification_reads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

GRANT SELECT, INSERT, UPDATE ON public.user_notification_reads TO authenticated, service_role;
ALTER TABLE public.user_notification_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own notification read state" ON public.user_notification_reads;
CREATE POLICY "Users manage own notification read state" ON public.user_notification_reads
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
