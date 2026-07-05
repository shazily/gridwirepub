-- Revert 20260704190000: EXISTS self-join on org_members causes infinite recursion in RLS.
-- Co-member reads require is_org_member(); keep EXECUTE granted via 20260704170000.
DROP POLICY IF EXISTS "Members view co-members" ON public.org_members;
CREATE POLICY "Members view co-members" ON public.org_members
  FOR SELECT
  USING (public.is_org_member(org_id));
