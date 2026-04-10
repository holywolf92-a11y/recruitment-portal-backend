ALTER TABLE employer_leads
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS contact_name TEXT;

CREATE INDEX IF NOT EXISTS idx_employer_leads_user_id ON employer_leads(user_id) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN employer_leads.user_id IS 'Supabase auth/app user linked to this employer lead for portal self-service access';