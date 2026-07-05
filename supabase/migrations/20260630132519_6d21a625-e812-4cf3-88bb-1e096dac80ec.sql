-- 1. Restrict alert_events INSERT to backend/service role only
DROP POLICY IF EXISTS "members write alert_events" ON public.alert_events;

-- 2. Restrict connector visibility (config / secret_ref) to owners and admins only.
--    Owners/admins retain full access via the existing "Admins manage connectors" ALL policy.
DROP POLICY IF EXISTS "Members view connectors" ON public.connectors;

-- 3. Least-privilege EXECUTE on SECURITY DEFINER / helper functions.
--    Remove the implicit PUBLIC grant and revoke anon from all helpers.
REVOKE EXECUTE ON FUNCTION public.create_organization(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_org_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_org_role(uuid, app_org_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.shares_org_with(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.invite_member_by_email(uuid, text, app_org_role) FROM PUBLIC, anon;

-- Grant EXECUTE only to authenticated for functions the app genuinely needs
-- (RLS helper functions referenced by policies + authenticated-only RPCs).
GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, app_org_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_org_with(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_member_by_email(uuid, text, app_org_role) TO authenticated;

-- Trigger functions must never be callable directly by API roles.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;