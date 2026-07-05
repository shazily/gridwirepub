-- RLS policies invoke is_org_member/has_org_role/get_org_role/shares_org_with as the
-- authenticated role. Revoking EXECUTE (e.g. admin_security_parity or a duplicate
-- migration applied after 20260704130000) yields an empty org list and sends every
-- returning user to onboarding. Restore grants; keep anon/PUBLIC revoked.

REVOKE EXECUTE ON FUNCTION public.has_org_role(uuid, app_org_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_org_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.shares_org_with(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, app_org_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_org_with(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, app_org_role[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_org_role(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.shares_org_with(uuid) TO service_role;

-- Belt-and-suspenders: membership + org reads for onboarding without relying solely on helpers.
DROP POLICY IF EXISTS "Users view own membership rows" ON public.org_members;
CREATE POLICY "Users view own membership rows" ON public.org_members
  FOR SELECT
  USING (user_id = auth.uid());

-- Replace helper-based org SELECT so onboarding works even if helper EXECUTE is revoked.
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
