-- Migration 014: AI Document Categorization and Identity Verification
-- Purpose: Add AI-powered document categorization, confidence scoring, and identity matching
-- This migration is IDEMPOTENT - safe to run multiple times

-- =============================================================================
-- PART 1: Create document category enum type
-- =============================================================================

DO $$ 
BEGIN
  -- Create enum type if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_category_enum') THEN
    CREATE TYPE document_category_enum AS ENUM (
      'cv_resume',
      'passport', 
      'certificates',
      'contracts',
      'medical_reports',
      'photos',
      'other_documents'
    );
  END IF;
END $$;

-- =============================================================================
-- PART 2: Create document verification status enum
-- =============================================================================

DO $$ 
BEGIN
  -- Create verification status enum if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_verification_status_enum') THEN
    CREATE TYPE document_verification_status_enum AS ENUM (
      'pending_ai',
      'verified',
      'needs_review',
      'rejected_mismatch',
      'failed'
    );
  END IF;
END $$;

-- =============================================================================
-- PART 3: Add new fields to candidate_documents table
-- =============================================================================

DO $$ 
BEGIN
  -- Add category (final assigned category after AI + review)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'category'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN category document_category_enum;
    -- Backfill existing rows based on document_type
    UPDATE candidate_documents 
    SET category = CASE 
      WHEN document_type = 'passport' THEN 'passport'::document_category_enum
      WHEN document_type = 'cnic' THEN 'other_documents'::document_category_enum
      WHEN document_type = 'degree' THEN 'certificates'::document_category_enum
      WHEN document_type = 'medical' THEN 'medical_reports'::document_category_enum
      WHEN document_type = 'visa' THEN 'other_documents'::document_category_enum
      WHEN document_type = 'certificate' THEN 'certificates'::document_category_enum
      ELSE 'other_documents'::document_category_enum
    END
    WHERE category IS NULL;
  END IF;

  -- Add detected_category (what AI detected)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'detected_category'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN detected_category document_category_enum;
  END IF;

  -- Add confidence (AI confidence score 0-1)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'confidence'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1);
  END IF;

  -- Add verification_status (replaces old status for verification workflow)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'verification_status'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN verification_status document_verification_status_enum DEFAULT 'pending_ai';
    -- Backfill existing rows: assume verified if status='verified', otherwise needs_review
    UPDATE candidate_documents 
    SET verification_status = CASE 
      WHEN status = 'verified' THEN 'verified'::document_verification_status_enum
      WHEN status = 'rejected' THEN 'rejected_mismatch'::document_verification_status_enum
      ELSE 'needs_review'::document_verification_status_enum
    END
    WHERE verification_status IS NULL;
  END IF;

  -- Add extracted_identity_json (stores AI-extracted identity fields, secured)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'extracted_identity_json'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN extracted_identity_json JSONB;
  END IF;

  -- Add verification_reason_code (why it needs review or was rejected)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'verification_reason_code'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN verification_reason_code TEXT;
  END IF;

  -- Add mismatch_fields (array of field names that didn't match)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'mismatch_fields'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN mismatch_fields TEXT[];
  END IF;

  -- Add ai_processing_started_at timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'ai_processing_started_at'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN ai_processing_started_at TIMESTAMPTZ;
  END IF;

  -- Add ai_processing_completed_at timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'ai_processing_completed_at'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN ai_processing_completed_at TIMESTAMPTZ;
  END IF;

  -- Add verification_completed_at timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_documents' AND column_name = 'verification_completed_at'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN verification_completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- =============================================================================
-- PART 4: Create indexes for performance
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_candidate_documents_category 
  ON candidate_documents(category);

CREATE INDEX IF NOT EXISTS idx_candidate_documents_verification_status 
  ON candidate_documents(verification_status);

CREATE INDEX IF NOT EXISTS idx_candidate_documents_pending_ai 
  ON candidate_documents(verification_status) 
  WHERE verification_status = 'pending_ai';

CREATE INDEX IF NOT EXISTS idx_candidate_documents_needs_review 
  ON candidate_documents(verification_status) 
  WHERE verification_status = 'needs_review';

CREATE INDEX IF NOT EXISTS idx_candidate_documents_confidence 
  ON candidate_documents(confidence) 
  WHERE confidence IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_documents_candidate_category 
  ON candidate_documents(candidate_id, category);

-- =============================================================================
-- PART 5: Add column comments for documentation
-- =============================================================================

COMMENT ON COLUMN candidate_documents.category IS 'Final assigned document category after AI detection and optional manual review';
COMMENT ON COLUMN candidate_documents.detected_category IS 'Category detected by AI/ML model';
COMMENT ON COLUMN candidate_documents.confidence IS 'AI confidence score (0.00 to 1.00). Auto-assign if >= 0.70';
COMMENT ON COLUMN candidate_documents.verification_status IS 'Document verification workflow status: pending_ai (awaiting AI), verified (identity matched), needs_review (low confidence or no IDs), rejected_mismatch (belongs to different person), failed (processing error)';
COMMENT ON COLUMN candidate_documents.extracted_identity_json IS 'JSON object with AI-extracted identity fields: {name, cnic, passport_no, email, phone, dob, document_number}. Secured/masked for privacy.';
COMMENT ON COLUMN candidate_documents.verification_reason_code IS 'Reason code for verification status: CNIC_MISMATCH, PASSPORT_MISMATCH, EMAIL_MISMATCH, LOW_CONFIDENCE, NO_ID_FOUND, etc.';
COMMENT ON COLUMN candidate_documents.mismatch_fields IS 'Array of field names that failed identity matching: [cnic, passport_no, email, etc.]';
COMMENT ON COLUMN candidate_documents.ai_processing_started_at IS 'Timestamp when AI categorization job started';
COMMENT ON COLUMN candidate_documents.ai_processing_completed_at IS 'Timestamp when AI categorization job completed';
COMMENT ON COLUMN candidate_documents.verification_completed_at IS 'Timestamp when identity verification completed';

-- =============================================================================
-- PART 6: Create helper function for category display names
-- =============================================================================

CREATE OR REPLACE FUNCTION get_document_category_display_name(cat document_category_enum)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE cat
    WHEN 'cv_resume' THEN 'CV / Resume'
    WHEN 'passport' THEN 'Passport'
    WHEN 'certificates' THEN 'Certificates'
    WHEN 'contracts' THEN 'Contracts'
    WHEN 'medical_reports' THEN 'Medical Reports'
    WHEN 'photos' THEN 'Photos'
    WHEN 'other_documents' THEN 'Other Documents'
    ELSE 'Unknown'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION get_document_category_display_name IS 'Converts document_category_enum to user-friendly display name';
