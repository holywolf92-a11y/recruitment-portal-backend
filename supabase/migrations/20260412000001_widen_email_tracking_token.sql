-- Widen candidates.email_tracking_token from VARCHAR(10) to TEXT
-- Root cause: publicPortalService.ts generates 16-char hex tokens via crypto.randomBytes(8).toString('hex')
-- which exceeds the VARCHAR(10) limit (error code 22001).
-- The WhatsApp bot and email service use 8-char tokens (fits), but public web form did not.
-- Widening to TEXT is the correct fix; all existing 8-char values are preserved.

ALTER TABLE public.candidates
  ALTER COLUMN email_tracking_token TYPE text;
