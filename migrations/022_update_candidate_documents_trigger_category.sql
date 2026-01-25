-- Migration 022: Update candidate_documents trigger to check category field
-- Purpose: 
-- The trigger currently only checks document_type, but documents can also be categorized
-- via the category field. This migration updates the trigger to check both fields.
-- This migration is IDEMPOTENT - safe to run multiple times

CREATE OR REPLACE FUNCTION update_candidate_document_checklist()
RETURNS trigger AS $$
DECLARE
  doc_type_val text;
  category_val text;
BEGIN
  -- Get values (check both document_type and category)
  doc_type_val := COALESCE(NEW.document_type, '');
  category_val := COALESCE(NEW.category::text, '');

  -- Check document_type first, then category, then file_name as fallback
  IF doc_type_val = 'passport' OR category_val = 'passport' THEN
    UPDATE candidates
    SET passport_received = true, passport_received_at = COALESCE(NEW.received_at, NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_val = 'cnic' OR category_val = 'cnic' OR category_val = 'national_id' THEN
    UPDATE candidates
    SET cnic_received = true, cnic_received_at = COALESCE(NEW.received_at, NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_val = 'driving_license' OR category_val = 'driving_license' 
        OR LOWER(COALESCE(NEW.file_name, '')) LIKE '%driving_license%' THEN
    UPDATE candidates
    SET driving_license_received = true, driving_license_received_at = COALESCE(NEW.received_at, NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_val = 'police_character_certificate' OR category_val = 'police_character_certificate' 
        OR category_val = 'police_clearance' OR category_val = 'pcc' THEN
    UPDATE candidates
    SET police_character_received = true, police_character_received_at = COALESCE(NEW.received_at, NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_val = 'degree' OR category_val LIKE '%degree%' OR category_val LIKE '%diploma%' THEN
    UPDATE candidates
    SET degree_received = true, degree_received_at = COALESCE(NEW.received_at, NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_val = 'medical' OR category_val LIKE '%medical%' THEN
    UPDATE candidates
    SET medical_received = true, medical_received_at = COALESCE(NEW.received_at, NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_val = 'visa' OR category_val = 'visa' THEN
    UPDATE candidates
    SET visa_received = true, visa_received_at = COALESCE(NEW.received_at, NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_val = 'certificate' OR category_val = 'certificates' OR category_val = 'certificate' THEN
    UPDATE candidates
    SET certificate_received = true, certificate_received_at = COALESCE(NEW.received_at, NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists from migration 010; it will now use the updated function above.

COMMENT ON FUNCTION update_candidate_document_checklist IS 'Automatically updates candidate document flags when candidate_documents are inserted. Checks document_type, category, and file_name. Supports: passport, cnic, driving_license, police_character_certificate, degree, medical, visa, certificate';
