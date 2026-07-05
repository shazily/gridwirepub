CREATE TYPE public.api_access AS ENUM ('secure','public');
ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS api_access public.api_access NOT NULL DEFAULT 'secure';
ALTER TYPE public.field_masking ADD VALUE IF NOT EXISTS 'encrypt';