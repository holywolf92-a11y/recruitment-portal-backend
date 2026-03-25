BEGIN;

CREATE TABLE IF NOT EXISTS unmatched_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_attachment_id uuid UNIQUE REFERENCES inbox_attachments(id) ON DELETE CASCADE,
  source text DEFAULT 'unknown',
  document_id uuid REFERENCES candidate_documents(id) ON DELETE CASCADE,
  storage_bucket text DEFAULT 'documents',
  storage_path text,
  file_name text,
  document_type text,
  match_reason text DEFAULT 'no_match',
  match_details jsonb,
  extracted_cnic text,
  extracted_email text,
  extracted_phone text,
  extracted_name text,
  extracted_father_name text,
  extracted_metadata jsonb,
  received_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending_link',
  needs_manual_review boolean DEFAULT false,
  review_reasons jsonb,
  linked_candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL,
  linked_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  resolution_action text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE unmatched_documents
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES candidate_documents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS storage_bucket text DEFAULT 'documents',
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS match_reason text DEFAULT 'no_match',
  ADD COLUMN IF NOT EXISTS match_details jsonb,
  ADD COLUMN IF NOT EXISTS extracted_cnic text,
  ADD COLUMN IF NOT EXISTS extracted_email text,
  ADD COLUMN IF NOT EXISTS extracted_phone text,
  ADD COLUMN IF NOT EXISTS extracted_name text,
  ADD COLUMN IF NOT EXISTS extracted_father_name text,
  ADD COLUMN IF NOT EXISTS extracted_metadata jsonb,
  ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending_link',
  ADD COLUMN IF NOT EXISTS needs_manual_review boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reasons jsonb,
  ADD COLUMN IF NOT EXISTS linked_candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS resolution_action text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE unmatched_documents
SET source = COALESCE(NULLIF(source, ''), 'unknown')
WHERE source IS NULL OR source = '';

UPDATE unmatched_documents
SET storage_bucket = COALESCE(NULLIF(storage_bucket, ''), 'documents')
WHERE storage_bucket IS NULL OR storage_bucket = '';

UPDATE unmatched_documents
SET status = COALESCE(NULLIF(status, ''), 'pending_link')
WHERE status IS NULL OR status = '';

UPDATE unmatched_documents
SET needs_manual_review = false
WHERE needs_manual_review IS NULL;

UPDATE unmatched_documents
SET received_at = COALESCE(received_at, created_at, now())
WHERE received_at IS NULL;

UPDATE unmatched_documents
SET created_at = COALESCE(created_at, received_at, now())
WHERE created_at IS NULL;

UPDATE unmatched_documents
SET updated_at = COALESCE(updated_at, created_at, received_at, now())
WHERE updated_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'unmatched_documents'
      AND c.conname = 'unmatched_documents_source_check'
  ) THEN
    ALTER TABLE unmatched_documents DROP CONSTRAINT unmatched_documents_source_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'unmatched_documents'
      AND c.conname = 'unmatched_documents_status_check'
  ) THEN
    ALTER TABLE unmatched_documents DROP CONSTRAINT unmatched_documents_status_check;
  END IF;
END $$;

ALTER TABLE unmatched_documents
  DROP CONSTRAINT IF EXISTS unmatched_documents_source_check,
  DROP CONSTRAINT IF EXISTS unmatched_documents_status_check;

ALTER TABLE unmatched_documents
  ADD CONSTRAINT unmatched_documents_source_check
  CHECK (source IN ('gmail', 'email', 'whatsapp', 'web', 'api', 'unknown', 'manual'));

ALTER TABLE unmatched_documents
  ADD CONSTRAINT unmatched_documents_status_check
  CHECK (status IN ('pending_link', 'linked', 'manual_review', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_unmatched_documents_status ON unmatched_documents(status);
CREATE INDEX IF NOT EXISTS idx_unmatched_documents_inbox ON unmatched_documents(inbox_attachment_id);
CREATE INDEX IF NOT EXISTS idx_unmatched_documents_needs_review ON unmatched_documents(needs_manual_review);
CREATE INDEX IF NOT EXISTS idx_unmatched_documents_source ON unmatched_documents(source);
CREATE INDEX IF NOT EXISTS idx_unmatched_documents_linked_candidate ON unmatched_documents(linked_candidate_id);

COMMIT;