-- Migration 027: Split Certificates Category into Specific Categories
-- Date: February 4, 2026
-- Purpose: Add educational_documents, experience_certificates, and navttc_reports categories
--
-- ⚠️ CRITICAL: PostgreSQL enum values CANNOT be reordered after creation
-- ✅ Adding new values at the END only
-- ❌ DO NOT rename/remove/reorder existing enum values

-- Add new enum values AT THE END (PostgreSQL limitation)
ALTER TYPE document_category_enum ADD VALUE IF NOT EXISTS 'educational_documents';
ALTER TYPE document_category_enum ADD VALUE IF NOT EXISTS 'experience_certificates';
ALTER TYPE document_category_enum ADD VALUE IF NOT EXISTS 'navttc_reports';

-- Update display function to include new categories
CREATE OR REPLACE FUNCTION get_document_category_display_name(cat document_category_enum)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE cat
    WHEN 'cv_resume' THEN 'CV / Resume'
    WHEN 'passport' THEN 'Passport'
    WHEN 'cnic' THEN 'CNIC (National ID)'
    WHEN 'driving_license' THEN 'Driving License'
    WHEN 'police_character_certificate' THEN 'Police Certificate'
    WHEN 'educational_documents' THEN 'Educational Documents'
    WHEN 'experience_certificates' THEN 'Experience Certificates'
    WHEN 'navttc_reports' THEN 'NAVTTC Reports'
    WHEN 'certificates' THEN 'Professional Certificates'
    WHEN 'contracts' THEN 'Contracts'
    WHEN 'medical_reports' THEN 'Medical Reports'
    WHEN 'photos' THEN 'Photos'
    WHEN 'other_documents' THEN 'Other Documents'
    ELSE 'Unknown'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Verify new enum values exist
DO $$
DECLARE
  enum_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO enum_count
  FROM pg_enum
  WHERE enumtypid = 'document_category_enum'::regtype
  AND enumlabel IN ('educational_documents', 'experience_certificates', 'navttc_reports');
  
  IF enum_count = 3 THEN
    RAISE NOTICE '✅ Successfully added 3 new document categories';
  ELSE
    RAISE EXCEPTION '❌ Failed to add new document categories (found % instead of 3)', enum_count;
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON TYPE document_category_enum IS 'Document categories for candidate documents. New values added 2026-02-04: educational_documents, experience_certificates, navttc_reports';

-- Migration notes:
-- 1. educational_documents: Degrees, diplomas, transcripts, marksheets, academic certificates
-- 2. experience_certificates: Employment certificates, experience letters, service certificates
-- 3. navttc_reports: NAVTTC vocational training certificates, government technical training
-- 4. certificates (existing): Professional/IT certifications ONLY (CCNA, AWS, PMP, etc.)
-- 5. police_character_certificate (existing): Police clearance, character certificates

-- ⚠️ ROLLBACK NOTES:
-- PostgreSQL does NOT support removing enum values directly.
-- To rollback, you must:
-- 1. Remove all data using the new enum values
-- 2. Drop and recreate the enum type
-- 3. Recreate all tables using the enum
-- This is destructive and should be avoided in production.
-- Instead, if rollback needed, simply don't use the new values.
