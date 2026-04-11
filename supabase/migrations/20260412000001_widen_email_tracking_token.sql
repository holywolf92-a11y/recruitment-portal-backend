-- Widen candidates.email_tracking_token from VARCHAR(10) to TEXT
-- Root cause: publicPortalService.ts generates 16-char hex tokens via crypto.randomBytes(8).toString('hex')
-- which exceeds the VARCHAR(10) limit (error code 22001).
-- The WhatsApp bot and email service use 8-char tokens (fits), but public web form did not.
-- Widening to TEXT is the correct fix; all existing 8-char values are preserved.
--
-- Must drop and recreate active_candidates view because Postgres blocks ALTER COLUMN
-- when a view's _RETURN rule depends on that column.

DROP VIEW IF EXISTS public.active_candidates;

ALTER TABLE public.candidates
  ALTER COLUMN email_tracking_token TYPE text;

-- Recreate active_candidates (same definition as 20260225000004_enterprise_hardening.sql)
CREATE OR REPLACE VIEW public.active_candidates AS
  SELECT * FROM public.candidates
  WHERE status IS DISTINCT FROM 'Deleted';

COMMENT ON VIEW public.active_candidates IS
  'All non-deleted candidates. Always query this view instead of the raw '
  'candidates table so soft-deleted records are transparently excluded. '
  'Losers from candidate merges are soft-deleted and excluded here.';
