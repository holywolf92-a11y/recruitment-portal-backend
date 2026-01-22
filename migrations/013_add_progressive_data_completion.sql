-- Migration 013: Add Progressive Data Completion Support
-- Adds field source tracking and missing fields calculation

-- Add field_sources JSONB column to track source of each field
ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS field_sources JSONB DEFAULT '{}'::jsonb;

-- Add missing_fields JSONB column to track missing required fields
ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS missing_fields TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add index for faster missing fields queries
CREATE INDEX IF NOT EXISTS idx_candidates_missing_fields 
ON candidates USING GIN (missing_fields);

-- Add index for field_sources queries
CREATE INDEX IF NOT EXISTS idx_candidates_field_sources 
ON candidates USING GIN (field_sources);

-- Create enrichment_logs table for audit trail (optional, for future use)
CREATE TABLE IF NOT EXISTS enrichment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source TEXT NOT NULL, -- 'cv', 'passport', 'driving_license', 'medical', 'certificate', 'manual'
  document_id UUID,
  document_type TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_source CHECK (source IN ('cv', 'passport', 'driving_license', 'medical', 'certificate', 'manual', 'other'))
);

-- Add index for enrichment_logs queries
CREATE INDEX IF NOT EXISTS idx_enrichment_logs_candidate_id 
ON enrichment_logs(candidate_id);

CREATE INDEX IF NOT EXISTS idx_enrichment_logs_created_at 
ON enrichment_logs(created_at DESC);

-- Function to recalculate missing fields for all candidates (can be run periodically)
CREATE OR REPLACE FUNCTION recalculate_all_missing_fields()
RETURNS INTEGER AS $$
DECLARE
  candidate_record RECORD;
  missing_fields_list TEXT[];
  field_value TEXT;
BEGIN
  FOR candidate_record IN SELECT * FROM candidates LOOP
    missing_fields_list := ARRAY[]::TEXT[];
    
    -- Check each Excel Browser field
    -- Basic fields
    IF candidate_record.name IS NULL OR candidate_record.name = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'name');
    END IF;
    
    IF candidate_record.position IS NULL OR candidate_record.position = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'position');
    END IF;
    
    IF candidate_record.date_of_birth IS NULL THEN
      missing_fields_list := array_append(missing_fields_list, 'date_of_birth');
    END IF;
    
    IF candidate_record.nationality IS NULL OR candidate_record.nationality = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'nationality');
    END IF;
    
    IF candidate_record.country_of_interest IS NULL OR candidate_record.country_of_interest = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'country_of_interest');
    END IF;
    
    IF candidate_record.phone IS NULL OR candidate_record.phone = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'phone');
    END IF;
    
    IF candidate_record.email IS NULL OR candidate_record.email = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'email');
    END IF;
    
    IF candidate_record.experience_years IS NULL THEN
      missing_fields_list := array_append(missing_fields_list, 'experience_years');
    END IF;
    
    -- Detailed fields
    IF candidate_record.marital_status IS NULL OR candidate_record.marital_status = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'marital_status');
    END IF;
    
    IF candidate_record.passport_normalized IS NULL OR candidate_record.passport_normalized = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'passport');
    END IF;
    
    IF candidate_record.passport_expiry IS NULL THEN
      missing_fields_list := array_append(missing_fields_list, 'passport_expiry');
    END IF;
    
    IF candidate_record.father_name IS NULL OR candidate_record.father_name = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'father_name');
    END IF;
    
    IF candidate_record.cnic_normalized IS NULL OR candidate_record.cnic_normalized = '' THEN
      missing_fields_list := array_append(missing_fields_list, 'cnic');
    END IF;
    
    -- Update missing_fields
    UPDATE candidates
    SET missing_fields = missing_fields_list
    WHERE id = candidate_record.id;
  END LOOP;
  
  RETURN (SELECT COUNT(*) FROM candidates);
END;
$$ LANGUAGE plpgsql;

-- Comment on columns
COMMENT ON COLUMN candidates.field_sources IS 'Tracks the source document for each field (cv, passport, manual, etc.)';
COMMENT ON COLUMN candidates.missing_fields IS 'Array of field names that are missing, based on Excel Browser fields';
COMMENT ON TABLE enrichment_logs IS 'Audit trail for all field enrichment events';
