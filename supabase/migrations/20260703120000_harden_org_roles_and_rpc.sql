-- Harden org_members role governance, restrict SECURITY DEFINER RPC exposure,
-- and route member role changes through a validated RPC.

-- ===== org_members: drop permissive policies =================================
DROP POLICY IF EXISTS "Admins add members" ON public.org_members;
DROP POLICY IF EXISTS "Admins update members" ON public.org_members;
DROP POLICY IF EXISTS "Admins remove members or self-leave" ON public.org_members;

-- Prevent removing or demoting the last owner of an organization.
CREATE OR REPLACE FUNCTION public.enforce_org_owner_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  owner_count INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      SELECT COUNT(*) INTO owner_count
      FROM public.org_members
      WHERE org_id = OLD.org_id AND role = 'owner' AND id <> OLD.id;
      IF owner_count = 0 THEN
        RAISE EXCEPTION 'Cannot remove the last owner of an organization';
      END IF;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      SELECT COUNT(*) INTO owner_count
      FROM public.org_members
      WHERE org_id = OLD.org_id AND role = 'owner' AND id <> OLD.id;
      IF owner_count = 0 THEN
        RAISE EXCEPTION 'Cannot demote the last owner of an organization';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_members_owner_invariant ON public.org_members;
CREATE TRIGGER trg_org_members_owner_invariant
  BEFORE DELETE OR UPDATE OF role ON public.org_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_org_owner_invariant();

-- INSERT: admins may add members but cannot assign owner/admin; owners may assign any role.
CREATE POLICY "Admins add members" ON public.org_members
  FOR INSERT
  WITH CHECK (
    public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[])
    AND (
      public.has_org_role(org_id, ARRAY['owner']::public.app_org_role[])
      OR role IN ('member','contributor','viewer')
    )
  );

-- DELETE: owners/admins may remove non-owners; owners may remove owners; anyone may self-leave.
CREATE POLICY "Admins remove members or self-leave" ON public.org_members
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR (
      public.has_org_role(org_id, ARRAY['owner','admin']::public.app_org_role[])
      AND (
        role <> 'owner'
        OR public.has_org_role(org_id, ARRAY['owner']::public.app_org_role[])
      )
    )
  );

-- Revoke direct UPDATE — role changes must go through update_org_member_role().
REVOKE UPDATE ON public.org_members FROM authenticated;

-- ===== Validated role-change RPC =============================================
CREATE OR REPLACE FUNCTION public.update_org_member_role(
  _member_id UUID,
  _new_role public.app_org_role
)
RETURNS public.org_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.org_members;
  _caller_role public.app_org_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _row FROM public.org_members WHERE id = _member_id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  _caller_role := public.get_org_role(_row.org_id);
  IF _caller_role IS NULL OR _caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners and admins can change member roles';
  END IF;

  IF _row.role = 'owner' AND _caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can modify owner memberships';
  END IF;

  IF _row.user_id = auth.uid() AND _new_role <> _row.role AND _caller_role = 'admin' THEN
    RAISE EXCEPTION 'Admins cannot change their own role';
  END IF;

  IF _caller_role = 'admin' AND _new_role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Admins cannot assign owner or admin roles';
  END IF;

  IF _new_role = 'owner' AND _caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can assign the owner role';
  END IF;

  UPDATE public.org_members SET role = _new_role WHERE id = _member_id RETURNING * INTO _row;
  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_org_member_role(UUID, public.app_org_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_org_member_role(UUID, public.app_org_role) TO authenticated;

-- ===== RPC hardening =========================================================
-- RLS helpers are referenced by policies only; direct RPC calls are not needed.
REVOKE EXECUTE ON FUNCTION public.is_org_member(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.has_org_role(UUID, public.app_org_role[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_org_role(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.shares_org_with(UUID) FROM authenticated;

-- Unused in the portal UI; revoke to block privilege escalation via email invite.
REVOKE EXECUTE ON FUNCTION public.invite_member_by_email(UUID, TEXT, public.app_org_role) FROM authenticated;

-- Audit writes are server-side only (portal uses service role).
REVOKE EXECUTE ON FUNCTION public.log_audit_event(UUID, TEXT, TEXT, TEXT, UUID, JSONB) FROM authenticated;

-- Intentionally retained for authenticated callers (onboarding + invites):
--   create_organization, create_org_invite, accept_org_invite
-- These remain SECURITY DEFINER with in-function validation.
