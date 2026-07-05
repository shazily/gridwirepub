
CREATE OR REPLACE FUNCTION public.invite_member_by_email(_org UUID, _email TEXT, _role public.app_org_role)
RETURNS public.org_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID; _member public.org_members;
BEGIN
  IF NOT public.has_org_role(_org, ARRAY['owner','admin']::public.app_org_role[]) THEN
    RAISE EXCEPTION 'Only owners and admins can add members';
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
END; $$;
