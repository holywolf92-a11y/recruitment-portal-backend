-- Link a candidate profile to a Supabase-authenticated user for self-service edits.

ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_user_id
ON candidates(user_id)
WHERE user_id IS NOT NULL;

COMMENT ON COLUMN candidates.user_id IS 'Supabase auth user linked to this candidate for self-service onboarding edits';