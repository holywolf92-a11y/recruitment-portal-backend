-- Migration 020: Update documents table trigger to handle all document types
-- Purpose: 
-- Update the trigger function that handles flag updates when documents are inserted into the 'documents' table
-- This is used by the split-and-categorize flow
-- This migration is IDEMPOTENT - safe to run multiple times

-- =============================================================================
-- Update the trigger function to handle all document types
-- =============================================================================

CREATE OR REPLACE FUNCTION update_candidate_doc_flags_from_documents()
RETURNS trigger AS $$
DECLARE
  doc_type_lower text;
BEGIN
  doc_type_lower := lower(COALESCE(NEW.doc_type, ''));

  -- Handle all document types
  IF doc_type_lower = 'cv' OR doc_type_lower = 'cv_resume' THEN
    UPDATE candidates
    SET cv_received = true, cv_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'photo' OR doc_type_lower = 'photos' THEN
    UPDATE candidates
    SET photo_received = true, photo_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'passport' THEN
    UPDATE candidates
    SET passport_received = true, passport_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'cnic' OR doc_type_lower = 'national_id' THEN
    UPDATE candidates
    SET cnic_received = true, cnic_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'driving_license' OR doc_type_lower = 'drivers_license' OR doc_type_lower = 'driver_license' THEN
    UPDATE candidates
    SET driving_license_received = true, driving_license_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'police_character_certificate' OR doc_type_lower = 'police_clearance' OR doc_type_lower = 'pcc' THEN
    UPDATE candidates
    SET police_character_received = true, police_character_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'degree' OR doc_type_lower LIKE '%diploma%' OR doc_type_lower LIKE '%transcript%' THEN
    UPDATE candidates
    SET degree_received = true, degree_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower LIKE '%medical%' THEN
    UPDATE candidates
    SET medical_received = true, medical_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'visa' THEN
    UPDATE candidates
    SET visa_received = true, visa_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'certificate' OR doc_type_lower = 'certificates' THEN
    UPDATE candidates
    SET certificate_received = true, certificate_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists from migration 012; it will now use the updated function above.

COMMENT ON FUNCTION update_candidate_doc_flags_from_documents IS 'Automatically updates candidate document flags when documents are inserted into the documents table. Supports: cv_resume, passport, cnic, driving_license, police_character_certificate, degree, medical, visa, certificate, photos';
