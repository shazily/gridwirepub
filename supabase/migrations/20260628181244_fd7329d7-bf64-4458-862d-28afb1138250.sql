
CREATE OR REPLACE FUNCTION public.shares_org_with(_other UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m1
    JOIN public.org_members m2 ON m1.org_id = m2.org_id
    WHERE m1.user_id = auth.uid() AND m2.user_id = _other
  );
$$;

CREATE POLICY "Members view co-member profiles" ON public.profiles
FOR SELECT USING (public.shares_org_with(id));
