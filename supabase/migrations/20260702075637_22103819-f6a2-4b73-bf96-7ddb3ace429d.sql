-- Remove the ability for anonymous (unauthenticated) database roles to directly
-- execute the SECURITY DEFINER function get_invite_preview. The invite preview
-- for signed-out visitors is now served through a token-gated server function
-- that runs with the service role, so no public EXECUTE grant is required.
REVOKE EXECUTE ON FUNCTION public.get_invite_preview(TEXT) FROM anon, PUBLIC;
-- Authenticated users no longer need direct execute either; the app calls the
-- server function for previews. Keep service_role able to execute it server-side.
REVOKE EXECUTE ON FUNCTION public.get_invite_preview(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(TEXT) TO service_role;