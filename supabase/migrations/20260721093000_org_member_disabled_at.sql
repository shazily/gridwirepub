-- Soft-disable for org memberships (admin Team & access).
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.org_members.disabled_at IS
  'When set, membership is disabled for this org (user cannot use workspace access).';

-- Service-role inserts for admin-created local users still need authenticated SELECT of new cols.
-- No RLS change required: disabled_at is readable by existing member policies.
