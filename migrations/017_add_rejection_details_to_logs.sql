-- Migration 017: Add Rejection Details to Document Verification Logs
-- Purpose: Store detailed rejection information in audit logs for compliance and debugging
-- This migration is IDEMPOTENT - safe to run multiple times

BEGIN;

-- =============================================================================
-- PART 1: Add rejection detail fields to document_verification_logs
-- =============================================================================

DO $$
BEGIN
  -- Rejection code (standardized rejection reason code)
  -- NOTE: reason_code already exists, but we'll add rejection_code for consistency
  -- Both can coexist - reason_code is legacy, rejection_code is new standardized field
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verification_logs' AND column_name = 'rejection_code'
  ) THEN
    ALTER TABLE document_verification_logs ADD COLUMN rejection_code TEXT;
  END IF;

  -- Human-readable rejection reason
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verification_logs' AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE document_verification_logs ADD COLUMN rejection_reason TEXT;
  END IF;

  -- Error stage (where in the pipeline the error occurred)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verification_logs' AND column_name = 'error_stage'
  ) THEN
    ALTER TABLE document_verification_logs
      ADD COLUMN error_stage TEXT;
  END IF;

  -- Retry semantics
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verification_logs' AND column_name = 'retry_possible'
  ) THEN
    ALTER TABLE document_verification_logs
      ADD COLUMN retry_possible BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verification_logs' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE document_verification_logs
      ADD COLUMN retry_count INT DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verification_logs' AND column_name = 'max_retries'
  ) THEN
    ALTER TABLE document_verification_logs
      ADD COLUMN max_retries INT DEFAULT 2;
  END IF;

  -- Document expiry date (for passport/medical/license/certificate expiry tracking)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verification_logs' AND column_name = 'document_expiry_date'
  ) THEN
    ALTER TABLE document_verification_logs
      ADD COLUMN document_expiry_date DATE;
  END IF;

  -- Rejection context (JSONB for additional mismatch details)
  -- NOTE: metadata already exists, but rejection_context is specifically for rejection details
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verification_logs' AND column_name = 'rejection_context'
  ) THEN
    ALTER TABLE document_verification_logs
      ADD COLUMN rejection_context JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Add CHECK constraint for error_stage (outside DO block to avoid syntax issues)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_document_verification_logs_error_stage'
  ) THEN
    ALTER TABLE document_verification_logs
      ADD CONSTRAINT check_document_verification_logs_error_stage
      CHECK (error_stage IS NULL OR error_stage IN ('OCR', 'Vision', 'Matching', 'Extraction', 'Categorization'));
  END IF;
END $$;

-- =============================================================================
-- PART 2: Add indexes for efficient querying
-- =============================================================================

-- Index for querying rejected documents
CREATE INDEX IF NOT EXISTS idx_verification_logs_rejection_code
  ON document_verification_logs(rejection_code)
  WHERE rejection_code IS NOT NULL;

-- Index for querying by error stage
CREATE INDEX IF NOT EXISTS idx_verification_logs_error_stage
  ON document_verification_logs(error_stage)
  WHERE error_stage IS NOT NULL;

-- Index for retry tracking
CREATE INDEX IF NOT EXISTS idx_verification_logs_retry
  ON document_verification_logs(retry_possible, retry_count)
  WHERE retry_possible = true;

-- =============================================================================
-- PART 3: Add column comments
-- =============================================================================

COMMENT ON COLUMN document_verification_logs.rejection_code IS 'Standardized rejection reason code (CNIC_MISMATCH, PASSPORT_MISMATCH, EXPIRED_PASSPORT, LOW_OCR_CONFIDENCE, etc.). Universal across all document types.';
COMMENT ON COLUMN document_verification_logs.rejection_reason IS 'Human-readable rejection reason message, document-type aware (e.g., "Passport expired on 2023-06-09" vs "CNIC number in passport does not match candidate''s CNIC")';
COMMENT ON COLUMN document_verification_logs.error_stage IS 'Stage in the verification pipeline where error occurred: OCR, Vision, Matching, Extraction, Categorization';
COMMENT ON COLUMN document_verification_logs.retry_possible IS 'Whether this rejection/failure can be retried (e.g., OCR failures can be retried, expired documents cannot)';
COMMENT ON COLUMN document_verification_logs.retry_count IS 'Number of times this document has been retried';
COMMENT ON COLUMN document_verification_logs.max_retries IS 'Maximum number of retries allowed for this document';
COMMENT ON COLUMN document_verification_logs.document_expiry_date IS 'Expiry date of the document (for passport, medical, license, certificate). Used for expiry-based rejection tracking.';
COMMENT ON COLUMN document_verification_logs.rejection_context IS 'Additional context about the rejection: {mismatch_fields: [...], extracted_values: {...}, candidate_values: {...}}';

COMMIT;
