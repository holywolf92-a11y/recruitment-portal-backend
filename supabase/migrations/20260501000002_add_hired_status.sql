-- Migration: Add 'Hired' to candidates status check constraint
-- Existing data has: Applied, Pending, Deployed, Deleted, Cancelled (3 rows)
-- All existing values must be included or the ADD CONSTRAINT will fail.

ALTER TABLE public.candidates
  DROP CONSTRAINT IF EXISTS candidates_status_check;

ALTER TABLE public.candidates
  ADD CONSTRAINT candidates_status_check
  CHECK (status IN ('Applied', 'Pending', 'Deployed', 'Hired', 'Cancelled', 'Deleted'));
