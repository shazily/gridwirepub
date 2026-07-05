-- Replace helper-based organizations SELECT (applied after 20260704170000 on DBs that already ran it).
DROP POLICY IF EXISTS "Users view orgs they belong to" ON public.organizations;
DROP POLICY IF EXISTS "Members view their orgs" ON public.organizations;
CREATE POLICY "Members view their orgs" ON public.organizations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.org_members om
      WHERE om.org_id = organizations.id
        AND om.user_id = auth.uid()
    )
  );
