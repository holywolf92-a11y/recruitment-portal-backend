-- Migration 018: Add Missing Critical Document Categories
-- Purpose: Add CNIC, Driving License, and Police Character Certificate as first-class document types
-- This migration is IDEMPOTENT - safe to run multiple times

-- =============================================================================
-- PART 1: Add new values to document_category_enum
-- NOTE: ALTER TYPE ADD VALUE must be committed before use, so we do them separately
-- =============================================================================

-- Add 'cnic' to enum if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'cnic' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'document_category_enum')
  ) THEN
    ALTER TYPE document_category_enum ADD VALUE 'cnic';
  END IF;
END $$;

-- Add 'driving_license' to enum if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'driving_license' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'document_category_enum')
  ) THEN
    ALTER TYPE document_category_enum ADD VALUE 'driving_license';
  END IF;
END $$;

-- Add 'police_character_certificate' to enum if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'police_character_certificate' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'document_category_enum')
  ) THEN
    ALTER TYPE document_category_enum ADD VALUE 'police_character_certificate';
  END IF;
END $$;

-- =============================================================================
-- PART 2: Update document_type CHECK constraint to include new types
-- =============================================================================

DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'candidate_documents_document_type_check'
  ) THEN
    ALTER TABLE candidate_documents DROP CONSTRAINT candidate_documents_document_type_check;
  END IF;

  -- Add updated constraint with new document types
  ALTER TABLE candidate_documents 
    ADD CONSTRAINT candidate_documents_document_type_check 
    CHECK (document_type IN (
      'passport', 
      'cnic', 
      'driving_license',
      'police_character_certificate',
      'degree', 
      'medical', 
      'visa', 
      'certificate', 
      'other'
    ));
END $$;

-- =============================================================================
-- PART 3: Update get_document_category_display_name() function
-- =============================================================================

CREATE OR REPLACE FUNCTION get_document_category_display_name(cat document_category_enum)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE cat
    WHEN 'cv_resume' THEN 'CV / Resume'
    WHEN 'passport' THEN 'Passport'
    WHEN 'cnic' THEN 'CNIC (National ID)'
    WHEN 'driving_license' THEN 'Driving License'
    WHEN 'police_character_certificate' THEN 'Police Character Certificate'
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

-- =============================================================================
-- PART 4: Backfill existing CNIC documents to use 'cnic' category
-- NOTE: This is optional data migration. If enum values were just added in this
-- migration run, they may not be usable until committed. This will run successfully
-- on subsequent runs or can be run manually after migration completes.
-- =============================================================================

-- Attempt to update existing CNIC documents
-- This will succeed if enum values are already committed, or on a subsequent run
DO $$
BEGIN
  -- Try to update - will fail silently if enum not yet usable (safe to skip)
  BEGIN
    UPDATE candidate_documents 
    SET category = 'cnic'::document_category_enum,
        detected_category = 'cnic'::document_category_enum
    WHERE document_type = 'cnic' 
      AND (category IS NULL OR category::text = 'other_documents');
  EXCEPTION
    WHEN OTHERS THEN
      -- Enum value not yet usable - this is OK, will be updated on next run or manually
      RAISE NOTICE 'Skipping CNIC category backfill - enum values may need to be committed first. Error: %', SQLERRM;
  END;
END $$;

-- =============================================================================
-- PART 5: Add comments for new categories
-- =============================================================================

COMMENT ON TYPE document_category_enum IS 'Document categories: cv_resume, passport, cnic, driving_license, police_character_certificate, certificates, contracts, medical_reports, photos, other_documents';
