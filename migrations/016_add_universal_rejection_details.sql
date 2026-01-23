-- Migration 016: Universal Rejection Details + Admin Overrides + Retry Semantics
-- Purpose: Store structured rejection reasons for ALL document types, enable admin override audit trail,
--          and add retry counters/limits for failed/low-confidence processing.
-- This migration is IDEMPOTENT - safe to run multiple times.

BEGIN;

-- =============================================================================
-- PART 1: Extend candidate_documents with rejection/override/retry metadata
-- =============================================================================

DO $$
BEGIN
  -- Rejection details (applies to all document types)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'rejection_code'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN rejection_code TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE candidate_documents ADD COLUMN rejection_reason TEXT;
  END IF;

  -- NOTE: mismatch_fields already exists as TEXT[] (migration 014). Keep it as-is.

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'ai_confidence'
  ) THEN
    -- Standardized to 0-1 scale (convert to 0-100 only in UI)
    ALTER TABLE candidate_documents
      ADD COLUMN ai_confidence DECIMAL(3,2) CHECK (ai_confidence >= 0 AND ai_confidence <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'ocr_confidence'
  ) THEN
    -- Standardized to 0-1 scale (convert to 0-100 only in UI)
    ALTER TABLE candidate_documents
      ADD COLUMN ocr_confidence DECIMAL(3,2) CHECK (ocr_confidence >= 0 AND ocr_confidence <= 1);
  END IF;

  -- Verification metadata
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'verified_against'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN verified_against JSONB DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'verification_source'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN verification_source TEXT DEFAULT 'ai_verification';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'error_stage'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN error_stage TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'retry_possible'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN retry_possible BOOLEAN DEFAULT false;
  END IF;

  -- Retry counters/limits (Fix: retry semantics)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN retry_count INT DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'max_retries'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN max_retries INT DEFAULT 2;
  END IF;

  -- Document-specific expiry (passport/medical/license/certificates where applicable)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'document_expiry_date'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN document_expiry_date DATE;
  END IF;

  -- Free-form structured context for debugging and UI
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'rejection_context'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN rejection_context JSONB DEFAULT '{}'::jsonb;
  END IF;

  -- Admin override tracking (applies to any document type)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'override_reason'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN override_reason TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'overridden_by'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN overridden_by UUID REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_documents' AND column_name = 'overridden_at'
  ) THEN
    ALTER TABLE candidate_documents
      ADD COLUMN overridden_at TIMESTAMPTZ;
  END IF;
END $$;

-- =============================================================================
-- PART 2: Constraints (idempotent)
-- =============================================================================

-- verification_source must be one of known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_candidate_documents_verification_source'
  ) THEN
    ALTER TABLE candidate_documents
      ADD CONSTRAINT check_candidate_documents_verification_source
      CHECK (verification_source IN ('ai_verification', 'admin_override', 'manual_review'));
  END IF;
END $$;

-- error_stage must be one of known values (nullable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_candidate_documents_error_stage'
  ) THEN
    ALTER TABLE candidate_documents
      ADD CONSTRAINT check_candidate_documents_error_stage
      CHECK (error_stage IS NULL OR error_stage IN ('OCR', 'Vision', 'Matching', 'Extraction', 'Categorization'));
  END IF;
END $$;

-- retry counters should be sane
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_candidate_documents_retry_counts'
  ) THEN
    ALTER TABLE candidate_documents
      ADD CONSTRAINT check_candidate_documents_retry_counts
      CHECK (
        retry_count >= 0 AND
        max_retries >= 0 AND
        retry_count <= max_retries
      );
  END IF;
END $$;

-- =============================================================================
-- PART 3: Indexes (idempotent)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_candidate_documents_rejection_code
  ON candidate_documents(rejection_code)
  WHERE rejection_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_documents_verification_source
  ON candidate_documents(verification_source);

CREATE INDEX IF NOT EXISTS idx_candidate_documents_document_expiry_date
  ON candidate_documents(document_expiry_date)
  WHERE document_expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_documents_rejected_failed
  ON candidate_documents(verification_status, category)
  WHERE verification_status IN ('rejected_mismatch', 'failed');

-- =============================================================================
-- PART 4: Backfill (best-effort, safe)
-- =============================================================================

-- If older pipeline populated verification_reason_code but not rejection_code, backfill for rejected/failed
UPDATE candidate_documents
SET rejection_code = verification_reason_code
WHERE rejection_code IS NULL
  AND verification_reason_code IS NOT NULL
  AND verification_status IN ('rejected_mismatch', 'failed');

-- If older pipeline stored category confidence in `confidence`, backfill ai_confidence when missing
UPDATE candidate_documents
SET ai_confidence = confidence
WHERE ai_confidence IS NULL
  AND confidence IS NOT NULL;

-- =============================================================================
-- PART 5: Admin override audit table (compliance-grade)
-- =============================================================================

CREATE TABLE IF NOT EXISTS admin_override_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES candidate_documents(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  document_category document_category_enum,

  -- Override details
  action TEXT NOT NULL DEFAULT 'ADMIN_OVERRIDE',
  previous_status TEXT NOT NULL,
  previous_rejection_code TEXT,
  previous_rejection_reason TEXT,
  override_reason TEXT NOT NULL,
  required_role TEXT NOT NULL DEFAULT 'admin', -- 'admin' or 'super_admin'

  -- Admin info
  overridden_by UUID NOT NULL REFERENCES users(id),
  overridden_by_name TEXT, -- denormalized for quick access
  overridden_by_role TEXT, -- role used for override (admin/super_admin)
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Additional context
  override_context JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_admin_override_logs_required_role'
  ) THEN
    ALTER TABLE admin_override_logs
      ADD CONSTRAINT check_admin_override_logs_required_role
      CHECK (required_role IN ('admin', 'super_admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_admin_override_logs_document
  ON admin_override_logs(document_id);

CREATE INDEX IF NOT EXISTS idx_admin_override_logs_candidate
  ON admin_override_logs(candidate_id);

CREATE INDEX IF NOT EXISTS idx_admin_override_logs_category
  ON admin_override_logs(document_category)
  WHERE document_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_override_logs_admin
  ON admin_override_logs(overridden_by);

CREATE INDEX IF NOT EXISTS idx_admin_override_logs_date
  ON admin_override_logs(overridden_at DESC);

-- =============================================================================
-- PART 6: Comments
-- =============================================================================

COMMENT ON COLUMN candidate_documents.rejection_code IS 'Universal rejection reason code (machine-readable). Required for rejected_mismatch/failed.';
COMMENT ON COLUMN candidate_documents.rejection_reason IS 'Human-readable rejection reason message.';
COMMENT ON COLUMN candidate_documents.ai_confidence IS 'AI confidence (0-1) for categorization/decision. Convert to percentage in UI only.';
COMMENT ON COLUMN candidate_documents.ocr_confidence IS 'OCR confidence (0-1). Convert to percentage in UI only.';
COMMENT ON COLUMN candidate_documents.verified_against IS 'JSON with verification target metadata (candidate_id, source document type).';
COMMENT ON COLUMN candidate_documents.verification_source IS 'ai_verification | admin_override | manual_review';
COMMENT ON COLUMN candidate_documents.error_stage IS 'If failed: OCR | Vision | Matching | Extraction | Categorization';
COMMENT ON COLUMN candidate_documents.retry_possible IS 'Whether retry is meaningful (e.g., OCR/vision errors).';
COMMENT ON COLUMN candidate_documents.retry_count IS 'Number of retries attempted.';
COMMENT ON COLUMN candidate_documents.max_retries IS 'Maximum allowed retries (default 2).';
COMMENT ON COLUMN candidate_documents.document_expiry_date IS 'Expiry date for documents with validity period.';
COMMENT ON COLUMN candidate_documents.rejection_context IS 'Extra JSON context for debugging/UI (extracted vs candidate values, etc.).';
COMMENT ON COLUMN candidate_documents.override_reason IS 'Admin justification for overriding verification.';
COMMENT ON COLUMN candidate_documents.overridden_by IS 'Admin user id who overrode verification.';
COMMENT ON COLUMN candidate_documents.overridden_at IS 'Timestamp when admin override occurred.';

COMMENT ON TABLE admin_override_logs IS 'Audit log for admin/super_admin overrides across all document types.';

COMMIT;

