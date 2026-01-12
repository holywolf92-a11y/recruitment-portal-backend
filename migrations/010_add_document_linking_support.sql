-- Migration 010: Add document linking and classification support

-- Add new columns to inbox_attachments
ALTER TABLE inbox_attachments 
ADD COLUMN IF NOT EXISTS attachment_kind text DEFAULT 'unknown' CHECK (attachment_kind IN ('cv', 'document', 'unknown')),
ADD COLUMN IF NOT EXISTS document_type text CHECK (document_type IN ('passport', 'cnic', 'degree', 'medical', 'visa', 'certificate', 'unknown', null)),
ADD COLUMN IF NOT EXISTS linked_candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT now();

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_inbox_attachments_attachment_kind ON inbox_attachments(attachment_kind);
CREATE INDEX IF NOT EXISTS idx_inbox_attachments_linked_candidate ON inbox_attachments(linked_candidate_id);

-- Create candidate_documents table for matched documents
CREATE TABLE IF NOT EXISTS candidate_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  inbox_attachment_id uuid REFERENCES inbox_attachments(id) ON DELETE SET NULL,
  document_type text NOT NULL CHECK (document_type IN ('passport', 'cnic', 'degree', 'medical', 'visa', 'certificate', 'other')),
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  source text NOT NULL CHECK (source IN ('gmail', 'whatsapp', 'web', 'manual')),
  status text DEFAULT 'received' CHECK (status IN ('received', 'verified', 'expired', 'rejected')),
  received_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_documents_candidate_id ON candidate_documents(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_documents_type ON candidate_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_candidate_documents_status ON candidate_documents(status);

-- Create unmatched_documents table for pending links
CREATE TABLE IF NOT EXISTS unmatched_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_attachment_id uuid NOT NULL REFERENCES inbox_attachments(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  source text NOT NULL CHECK (source IN ('gmail', 'whatsapp', 'web')),
  
  -- Extracted metadata for matching
  extracted_email text,
  extracted_phone text,
  extracted_name text,
  extracted_father_name text,
  extracted_cnic text,
  
  status text DEFAULT 'pending_link' CHECK (status IN ('pending_link', 'linked', 'manual_review')),
  link_attempts int DEFAULT 0,
  needs_manual_review boolean DEFAULT false,
  review_reasons jsonb,
  
  linked_candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL,
  linked_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_documents_status ON unmatched_documents(status);
CREATE INDEX IF NOT EXISTS idx_unmatched_documents_inbox ON unmatched_documents(inbox_attachment_id);
CREATE INDEX IF NOT EXISTS idx_unmatched_documents_needs_review ON unmatched_documents(needs_manual_review);

-- Add document checklist fields to candidates table
ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS passport_received boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS passport_received_at timestamptz,
ADD COLUMN IF NOT EXISTS cnic_received boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS cnic_received_at timestamptz,
ADD COLUMN IF NOT EXISTS degree_received boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS degree_received_at timestamptz,
ADD COLUMN IF NOT EXISTS medical_received boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS medical_received_at timestamptz,
ADD COLUMN IF NOT EXISTS visa_received boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS visa_received_at timestamptz;

-- Add father_name to candidates if not exists (needed for matching)
ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS father_name text;

CREATE INDEX IF NOT EXISTS idx_candidates_father_name ON candidates(father_name) WHERE father_name IS NOT NULL;

-- Create function to update candidate document checklist
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic checklist updates
DROP TRIGGER IF EXISTS trg_update_candidate_checklist ON candidate_documents;
CREATE TRIGGER trg_update_candidate_checklist
  AFTER INSERT ON candidate_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_candidate_document_checklist();

-- Add comments for documentation
COMMENT ON TABLE candidate_documents IS 'Stores documents linked to candidates (passport, CNIC, degrees, etc.)';
COMMENT ON TABLE unmatched_documents IS 'Stores documents that could not be automatically linked to a candidate';
COMMENT ON COLUMN inbox_attachments.attachment_kind IS 'Classification: cv (for parsing) | document (supporting) | unknown';
COMMENT ON COLUMN inbox_attachments.document_type IS 'Type of document if attachment_kind=document';
