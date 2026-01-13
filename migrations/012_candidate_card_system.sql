-- 012_candidate_card_system.sql
-- Fields + triggers needed to support the Candidate Card System (January 2026 spec)

BEGIN;

-- =========================
-- Candidate lifecycle fields
-- =========================
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Applied'
    CHECK (status IN ('Applied', 'Pending', 'Deployed', 'Cancelled')),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'Manual'
    CHECK (source IN ('WhatsApp', 'Email', 'Form', 'Manual')),
  ADD COLUMN IF NOT EXISTS ai_score numeric(3,1),
  ADD COLUMN IF NOT EXISTS auto_extracted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_source ON candidates(source);

-- =========================
-- Candidate card doc flags
-- =========================
-- These are card-view convenience flags; underlying docs still live in documents/candidate_documents.
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS cv_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cv_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS photo_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS certificate_received_at timestamptz;

-- Extend existing candidate_documents trigger function to support certificate.
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

-- Trigger already exists from migration 010; keep it as-is (it will now run the updated function).

-- documents table trigger to set cv/photo/certificate flags when app uploads into documents.
CREATE OR REPLACE FUNCTION update_candidate_doc_flags_from_documents()
RETURNS trigger AS $$
DECLARE
  doc_type_lower text;
BEGIN
  doc_type_lower := lower(COALESCE(NEW.doc_type, ''));

  IF doc_type_lower = 'cv' THEN
    UPDATE candidates
    SET cv_received = true, cv_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'photo' THEN
    UPDATE candidates
    SET photo_received = true, photo_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  ELSIF doc_type_lower = 'certificate' THEN
    UPDATE candidates
    SET certificate_received = true, certificate_received_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.candidate_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_candidate_doc_flags_from_documents ON documents;
CREATE TRIGGER trg_update_candidate_doc_flags_from_documents
  AFTER INSERT ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_candidate_doc_flags_from_documents();

COMMIT;
