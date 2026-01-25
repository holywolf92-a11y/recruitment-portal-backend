-- Migration 019: Fix Document Flags and Nationality Precedence
-- Purpose: 
-- 1. Add driving_license_received and police_character_received columns if missing
-- 2. Update database trigger to handle new document types
-- 3. Ensure flags are set correctly for all document types
-- This migration is IDEMPOTENT - safe to run multiple times

-- =============================================================================
-- PART 1: Add missing flag columns if they don't exist
-- =============================================================================

DO $$
BEGIN
  -- Add driving_license_received column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidates' AND column_name = 'driving_license_received'
  ) THEN
    ALTER TABLE candidates
      ADD COLUMN driving_license_received boolean NOT NULL DEFAULT false,
      ADD COLUMN driving_license_received_at timestamptz;
  END IF;

  -- Add police_character_received column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidates' AND column_name = 'police_character_received'
  ) THEN
    ALTER TABLE candidates
      ADD COLUMN police_character_received boolean NOT NULL DEFAULT false,
      ADD COLUMN police_character_received_at timestamptz;
  END IF;
END $$;

-- =============================================================================
-- PART 2: Update database trigger to handle new document types
-- =============================================================================

CREATE OR REPLACE FUNCTION update_candidate_document_checklist()
RETURNS trigger AS $$
BEGIN
  IF NEW.document_type = 'passport' THEN
    UPDATE candidates
    SET passport_received = true, passport_received_at = NEW.received_at
    WHERE id = NEW.candidate_id;
  ELSIF NEW.document_type = 'cnic' THEN
    UPDATE candidates
    SET cnic_received = true, cnic_received_at = NEW.received_at
    WHERE id = NEW.candidate_id;
  ELSIF NEW.document_type = 'driving_license' THEN
    UPDATE candidates
    SET driving_license_received = true, driving_license_received_at = NEW.received_at
    WHERE id = NEW.candidate_id;
  ELSIF NEW.document_type = 'police_character_certificate' THEN
    UPDATE candidates
    SET police_character_received = true, police_character_received_at = NEW.received_at
    WHERE id = NEW.candidate_id;
  ELSIF NEW.document_type = 'degree' THEN
    UPDATE candidates
    SET degree_received = true, degree_received_at = NEW.received_at
    WHERE id = NEW.candidate_id;
  ELSIF NEW.document_type = 'medical' THEN
    UPDATE candidates
    SET medical_received = true, medical_received_at = NEW.received_at
    WHERE id = NEW.candidate_id;
  ELSIF NEW.document_type = 'visa' THEN
    UPDATE candidates
    SET visa_received = true, visa_received_at = NEW.received_at
    WHERE id = NEW.candidate_id;
  ELSIF NEW.document_type = 'certificate' THEN
    UPDATE candidates
    SET certificate_received = true, certificate_received_at = NEW.received_at
    WHERE id = NEW.candidate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists from migration 010; it will now use the updated function above.

COMMENT ON FUNCTION update_candidate_document_checklist IS 'Automatically updates candidate document flags when candidate_documents are inserted. Supports: passport, cnic, driving_license, police_character_certificate, degree, medical, visa, certificate';
