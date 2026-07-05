-- Admin-console security parity (merged with 20260703120000 hardening).
-- Role changes remain via update_org_member_role(); this tightens invite RPC and
-- locks internal helpers to service_role only.

CREATE OR REPLACE FUNCTION public.invite_member_by_email(_org uuid, _email text, _role app_org_role)
 RETURNS org_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid UUID; _member public.org_members;
BEGIN
  IF NOT public.has_org_role(_org, ARRAY['owner','admin']::public.app_org_role[]) THEN
    RAISE EXCEPTION 'Only owners and admins can add members';
  END IF;
  IF _role IN ('owner','admin') AND NOT public.has_org_role(_org, ARRAY['owner']::public.app_org_role[]) THEN
    RAISE EXCEPTION 'Only owners can grant the owner or admin role';
  END IF;
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No Gridwire account found for %. Ask them to sign up first.', _email;
  END IF;
  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (_org, _uid, _role)
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING * INTO _member;
  RETURN _member;
END; $function$;

-- Helpers must stay EXECUTE-able by authenticated: RLS policies call them on every read.
-- Only revoke direct RPC access from anon/PUBLIC; invite_member_by_email stays service_role-only.
REVOKE EXECUTE ON FUNCTION public.has_org_role(uuid, app_org_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_org_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.shares_org_with(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.invite_member_by_email(uuid, text, app_org_role) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, app_org_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_org_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shares_org_with(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invite_member_by_email(uuid, text, app_org_role) TO service_role;
