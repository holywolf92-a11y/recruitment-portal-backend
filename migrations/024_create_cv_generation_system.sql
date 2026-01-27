-- Migration 024: Create CV Generation System
-- This migration creates the infrastructure for server-side CV generation with intelligent caching

-- Create generated_cvs table to track all generated CV PDFs
CREATE TABLE IF NOT EXISTS generated_cvs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  format VARCHAR(20) NOT NULL CHECK (format IN ('employer-safe', 'internal', 'standard')),
  template VARCHAR(50) DEFAULT 'professional',
  storage_bucket VARCHAR(100) NOT NULL DEFAULT 'documents',
  storage_path TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT,
  sha256 VARCHAR(64), -- For deduplication
  version_hash VARCHAR(64) NOT NULL, -- Hash of candidate data at generation time
  generated_at TIMESTAMP DEFAULT NOW(),
  generated_by UUID, -- User ID who triggered generation
  expires_at TIMESTAMP, -- Optional expiration for signed URLs
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Unique constraint: one CV per candidate+format+version
  UNIQUE(candidate_id, format, version_hash)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_generated_cvs_candidate_id ON generated_cvs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_generated_cvs_format ON generated_cvs(format);
CREATE INDEX IF NOT EXISTS idx_generated_cvs_version_hash ON generated_cvs(version_hash);
CREATE INDEX IF NOT EXISTS idx_generated_cvs_storage_path ON generated_cvs(storage_path);
CREATE INDEX IF NOT EXISTS idx_generated_cvs_candidate_format ON generated_cvs(candidate_id, format);

-- Function to calculate candidate data hash for cache invalidation
-- This hash changes when candidate data changes, invalidating cached CVs
CREATE OR REPLACE FUNCTION calculate_candidate_version_hash(candidate_id UUID)
RETURNS VARCHAR(64) AS $$
DECLARE
  data_hash VARCHAR(64);
BEGIN
  SELECT encode(
    digest(
      CONCAT(
        COALESCE(name, ''),
        COALESCE(position, ''),
        COALESCE(nationality, ''),
        COALESCE(experience_years::text, ''),
        COALESCE(skills, ''),
        COALESCE(languages, ''),
        COALESCE(education, ''),
        COALESCE(certifications, ''),
        COALESCE(previous_employment, ''),
        COALESCE(professional_summary, ''),
        COALESCE(country_of_interest, ''),
        COALESCE(updated_at::text, '')
      ),
      'sha256'
    ),
    'hex'
  ) INTO data_hash
  FROM candidates
  WHERE id = candidate_id;
  
  RETURN data_hash;
END;
$$ LANGUAGE plpgsql;

-- Function to update last_accessed_at when CV is accessed
CREATE OR REPLACE FUNCTION update_cv_access_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE generated_cvs
  SET 
    access_count = access_count + 1,
    last_accessed_at = NOW(),
    updated_at = NOW()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_generated_cvs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_generated_cvs_updated_at
  BEFORE UPDATE ON generated_cvs
  FOR EACH ROW
  EXECUTE FUNCTION update_generated_cvs_updated_at();

COMMENT ON TABLE generated_cvs IS 'Tracks all generated CV PDFs with caching and version control';
COMMENT ON COLUMN generated_cvs.version_hash IS 'SHA256 hash of candidate data at generation time - used for cache invalidation';
COMMENT ON COLUMN generated_cvs.sha256 IS 'SHA256 hash of PDF file content - used for deduplication';
COMMENT ON FUNCTION calculate_candidate_version_hash IS 'Calculates hash of candidate data to determine if cached CV is still valid';
