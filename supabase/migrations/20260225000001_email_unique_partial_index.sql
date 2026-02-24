-- P0: Add partial unique index on candidates.email to prevent race-condition duplicates.
-- Uses lower(trim(email)) so matching is case-insensitive.
-- Partial: only active (non-Deleted, non-null, non-empty) candidates are constrained.
--
-- This is the last-line-of-defense: application dedup runs first, but if two
-- parallel jobs both pass the app check simultaneously, the DB will reject
-- the second INSERT/UPDATE with a unique-violation, keeping the data clean.

-- Step 1: Before creating the index, wipe any remaining email dupes by
-- clearing the email on the OLDER duplicate (lower candidate_code wins).
DO $$
BEGIN
  -- Only run if there are actual duplicates to avoid wasted work
  IF EXISTS (
    SELECT 1
    FROM candidates
    WHERE email IS NOT NULL AND trim(email) != '' AND status != 'Deleted'
    GROUP BY lower(trim(email))
    HAVING count(*) > 1
  ) THEN
    -- Null out the email on older duplicates (keep oldest candidate_code's email)
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY lower(trim(email))
          ORDER BY candidate_code ASC, created_at ASC
        ) AS rn
      FROM candidates
      WHERE email IS NOT NULL AND trim(email) != '' AND status != 'Deleted'
    )
    UPDATE candidates
    SET email = NULL
    FROM ranked
    WHERE candidates.id = ranked.id AND ranked.rn > 1;

    RAISE NOTICE 'Cleared duplicate emails before creating unique index';
  END IF;
END $$;

-- Step 2: Create the partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS candidates_email_unique_active
  ON candidates (lower(trim(email)))
  WHERE status IS DISTINCT FROM 'Deleted'
    AND email IS NOT NULL
    AND trim(email) != '';

COMMENT ON INDEX candidates_email_unique_active IS
  'Prevents duplicate active candidates with the same email address. '
  'Case-insensitive. Excludes Deleted candidates and null/empty emails.';
