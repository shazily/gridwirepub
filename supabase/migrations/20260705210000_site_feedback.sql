-- Anonymous feedback from the public marketing site (no auth required).

CREATE TABLE IF NOT EXISTS public.site_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  category text NOT NULL DEFAULT 'general',
  message text NOT NULL,
  page_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.site_feedback TO service_role;
ALTER TABLE public.site_feedback ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.site_feedback IS
  'Feedback submitted from the public site; inserts via service role only.';
