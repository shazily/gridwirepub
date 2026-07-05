BEGIN;

TRUNCATE TABLE public.organizations CASCADE;

TRUNCATE TABLE auth.refresh_tokens CASCADE;
TRUNCATE TABLE auth.sessions CASCADE;
TRUNCATE TABLE auth.mfa_factors CASCADE;
TRUNCATE TABLE auth.mfa_challenges CASCADE;
TRUNCATE TABLE auth.identities CASCADE;
DELETE FROM auth.users;

COMMIT;

SELECT 'users' AS kind, count(*)::text AS n FROM auth.users
UNION ALL SELECT 'organizations', count(*)::text FROM public.organizations
UNION ALL SELECT 'org_members', count(*)::text FROM public.org_members;
