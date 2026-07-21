-- Unique usernames for marketing local signup / sign-in.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

COMMENT ON COLUMN public.profiles.username IS
  'Public login handle (unique, case-insensitive). Optional for SSO-provisioned users.';

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_uidx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

-- Keep profile username in sync from auth metadata on signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _username TEXT;
  _display TEXT;
BEGIN
  _username := NULLIF(lower(trim(COALESCE(NEW.raw_user_meta_data->>'username', ''))), '');
  _display := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'username'), ''),
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.profiles (id, display_name, username)
  VALUES (NEW.id, _display, _username)
  ON CONFLICT (id) DO UPDATE
    SET
      display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
      username = COALESCE(EXCLUDED.username, public.profiles.username);

  RETURN NEW;
END;
$$;

-- Resolve username → email for password sign-in (service_role / SECURITY DEFINER only).
CREATE OR REPLACE FUNCTION public.resolve_login_email(_identifier TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _id TEXT := lower(trim(COALESCE(_identifier, '')));
  _email TEXT;
BEGIN
  IF _id = '' THEN
    RETURN NULL;
  END IF;

  IF position('@' in _id) > 0 THEN
    SELECT u.email INTO _email
    FROM auth.users u
    WHERE lower(u.email) = _id
    LIMIT 1;
    RETURN _email;
  END IF;

  SELECT u.email INTO _email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.username IS NOT NULL
    AND lower(p.username) = _id
  LIMIT 1;

  RETURN _email;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_login_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(TEXT) TO service_role;

-- Username availability check for signup UX (does not reveal email).
CREATE OR REPLACE FUNCTION public.is_username_available(_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _u TEXT := lower(trim(COALESCE(_username, '')));
BEGIN
  IF _u = '' OR length(_u) < 3 OR length(_u) > 32 THEN
    RETURN false;
  END IF;
  IF _u !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.username IS NOT NULL AND lower(p.username) = _u
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_username_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO anon, authenticated, service_role;
