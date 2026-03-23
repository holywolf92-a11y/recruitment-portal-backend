BEGIN;

DO $$
DECLARE
  existing_definition text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO existing_definition
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'candidates'
    AND c.conname = 'candidates_status_check';

  IF existing_definition IS NOT NULL AND existing_definition NOT ILIKE '%Deleted%' THEN
    ALTER TABLE candidates DROP CONSTRAINT candidates_status_check;
    existing_definition := NULL;
  END IF;

  IF existing_definition IS NULL THEN
    ALTER TABLE candidates
      ADD CONSTRAINT candidates_status_check
      CHECK (status IN ('Applied', 'Pending', 'Deployed', 'Cancelled', 'Deleted'));
  END IF;
END $$;

COMMIT;