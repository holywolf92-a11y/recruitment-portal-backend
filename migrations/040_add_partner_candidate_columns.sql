ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS partner_name TEXT,
ADD COLUMN IF NOT EXISTS is_partner_candidate BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_candidates_partner_id ON candidates(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_is_partner_candidate ON candidates(is_partner_candidate) WHERE is_partner_candidate = true;

UPDATE candidates
SET is_partner_candidate = true,
    partner_id = CASE
      WHEN NULLIF(split_part(source, '|', 2), '') ~ '^[0-9a-fA-F-]{36}$' THEN NULLIF(split_part(source, '|', 2), '')::uuid
      ELSE partner_id
    END,
    partner_name = COALESCE(NULLIF(split_part(source, '|', 3), ''), partner_name)
WHERE source LIKE 'Partner|%'
  AND (is_partner_candidate = false OR partner_id IS NULL OR partner_name IS NULL);