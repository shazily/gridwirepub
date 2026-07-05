-- RLS policies call is_org_member/has_org_role/etc. as the authenticated role.
-- Revoking EXECUTE from authenticated breaks org_members reads (empty org list,
-- onboarding loop after create_organization). Keep anon/PUBLIC revoked; restore
-- authenticated so policies evaluate. invite_member_by_email stays service_role-only.

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
