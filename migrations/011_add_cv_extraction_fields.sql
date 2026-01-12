-- 011_add_cv_extraction_fields.sql
-- Add fields required for AI CV extraction and candidate profiles

BEGIN;

-- Add CV extraction fields to candidates table
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS nationality VARCHAR(100);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS position VARCHAR(255);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS experience_years INTEGER;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS country_of_interest VARCHAR(100);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS skills TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS languages TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS education VARCHAR(255);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS certifications TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS previous_employment TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS passport_expiry DATE;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS professional_summary TEXT;

-- Add extraction metadata columns
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS extraction_confidence JSONB DEFAULT '{}'::jsonb;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS extraction_source VARCHAR(50);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMP;

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_candidates_nationality ON candidates(nationality);
CREATE INDEX IF NOT EXISTS idx_candidates_country_interest ON candidates(country_of_interest);
CREATE INDEX IF NOT EXISTS idx_candidates_experience ON candidates(experience_years);
CREATE INDEX IF NOT EXISTS idx_candidates_position ON candidates(position);

-- Create extraction_history table to track changes
CREATE TABLE IF NOT EXISTS extraction_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  extracted_data JSONB NOT NULL,
  confidence_scores JSONB,
  extracted_at TIMESTAMP DEFAULT NOW(),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  approved BOOLEAN DEFAULT false,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_extraction_history_candidate ON extraction_history(candidate_id);
CREATE INDEX IF NOT EXISTS idx_extraction_history_date ON extraction_history(extracted_at DESC);

COMMIT;
