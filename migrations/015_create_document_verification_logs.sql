-- Migration 015: Document Verification Audit Logs
-- Purpose: Complete audit trail for AI categorization and identity verification
-- This migration is IDEMPOTENT - safe to run multiple times

-- =============================================================================
-- PART 1: Create document_verification_logs table
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_verification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Request tracing
  request_id UUID NOT NULL, -- trace_id for linking related events
  
  -- Entity references
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  document_id UUID REFERENCES candidate_documents(id) ON DELETE SET NULL,
  uploaded_by_user_id TEXT, -- user who uploaded the document
  
  -- Event metadata
  event_type TEXT NOT NULL CHECK (event_type IN (
    'upload_started',
    'upload_completed',
    'ai_scan_started',
    'ai_scan_completed',
    'ai_scan_failed',
    'identity_verification_started',
    'identity_verification_completed',
    'verification_status_changed',
    'manual_review_requested',
    'manual_review_completed',
    'error'
  )),
  event_status TEXT CHECK (event_status IN ('success', 'failure', 'pending')),
  
  -- File metadata
  file_name TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  storage_bucket TEXT,
  storage_path TEXT,
  
  -- AI categorization results
  detected_category document_category_enum,
  confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  ocr_confidence DECIMAL(3,2) CHECK (ocr_confidence >= 0 AND ocr_confidence <= 1),
  
  -- Identity extraction (MASKED for privacy)
  extracted_fields JSONB, -- {name: "***", cnic: "*****-*******-*", email: "***@***", phone: "***", etc.}
  
  -- Verification decision
  verification_status document_verification_status_enum,
  reason_code TEXT, -- CNIC_MISMATCH, PASSPORT_MISMATCH, LOW_CONFIDENCE, NO_ID_FOUND, etc.
  mismatch_fields TEXT[], -- ['cnic', 'passport_no']
  
  -- Matching details (for audit)
  matching_result JSONB, -- {matched: true/false, matched_on: ['cnic'], confidence: 0.95, candidate_fields: {...}}
  
  -- Raw AI response (secured, server-side only)
  raw_ai_response JSONB,
  
  -- Error details
  error_message TEXT,
  error_stack TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  upload_time TIMESTAMPTZ,
  scan_start_time TIMESTAMPTZ,
  scan_end_time TIMESTAMPTZ,
  verify_time TIMESTAMPTZ,
  
  -- Additional context
  metadata JSONB -- flexible field for additional context
);

-- =============================================================================
-- PART 2: Create indexes for performance and querying
-- =============================================================================

-- Primary query patterns
CREATE INDEX IF NOT EXISTS idx_verification_logs_request_id 
  ON document_verification_logs(request_id);

CREATE INDEX IF NOT EXISTS idx_verification_logs_candidate_id 
  ON document_verification_logs(candidate_id) 
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verification_logs_document_id 
  ON document_verification_logs(document_id) 
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verification_logs_event_type 
  ON document_verification_logs(event_type);

CREATE INDEX IF NOT EXISTS idx_verification_logs_verification_status 
  ON document_verification_logs(verification_status) 
  WHERE verification_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verification_logs_created_at 
  ON document_verification_logs(created_at DESC);

-- Compound indexes for common filters
CREATE INDEX IF NOT EXISTS idx_verification_logs_candidate_event 
  ON document_verification_logs(candidate_id, event_type, created_at DESC) 
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verification_logs_document_timeline 
  ON document_verification_logs(document_id, created_at ASC) 
  WHERE document_id IS NOT NULL;

-- Query for errors
CREATE INDEX IF NOT EXISTS idx_verification_logs_errors 
  ON document_verification_logs(event_type, created_at DESC) 
  WHERE event_status = 'failure' OR event_type = 'error';

-- Query for pending AI jobs
CREATE INDEX IF NOT EXISTS idx_verification_logs_pending_ai 
  ON document_verification_logs(event_type, created_at ASC) 
  WHERE event_type = 'ai_scan_started' AND event_status = 'pending';

-- =============================================================================
-- PART 3: Add table and column comments
-- =============================================================================

COMMENT ON TABLE document_verification_logs IS 'Complete audit trail for document upload, AI categorization, and identity verification. Each log entry represents a single event in the verification workflow.';

COMMENT ON COLUMN document_verification_logs.request_id IS 'Trace ID for linking all events related to a single document upload request';
COMMENT ON COLUMN document_verification_logs.event_type IS 'Type of event being logged: upload_started, upload_completed, ai_scan_started, ai_scan_completed, ai_scan_failed, identity_verification_started, identity_verification_completed, verification_status_changed, manual_review_requested, manual_review_completed, error';
COMMENT ON COLUMN document_verification_logs.event_status IS 'Outcome of the event: success, failure, pending';
COMMENT ON COLUMN document_verification_logs.detected_category IS 'Category detected by AI (cv_resume, passport, certificates, etc.)';
COMMENT ON COLUMN document_verification_logs.confidence IS 'AI confidence score for category detection (0.00 to 1.00)';
COMMENT ON COLUMN document_verification_logs.ocr_confidence IS 'OCR/text extraction confidence score (0.00 to 1.00)';
COMMENT ON COLUMN document_verification_logs.extracted_fields IS 'MASKED identity fields extracted by AI: {name, cnic, passport_no, email, phone, dob}. Sensitive data is masked for privacy: CNIC shows as *****-*******-*, passport as ****1234';
COMMENT ON COLUMN document_verification_logs.verification_status IS 'Final verification status: pending_ai, verified, needs_review, rejected_mismatch, failed';
COMMENT ON COLUMN document_verification_logs.reason_code IS 'Reason for verification decision: CNIC_MISMATCH, PASSPORT_MISMATCH, EMAIL_MISMATCH, LOW_CONFIDENCE, NO_ID_FOUND, MULTIPLE_CANDIDATES, etc.';
COMMENT ON COLUMN document_verification_logs.mismatch_fields IS 'Array of field names that failed identity matching: [cnic, passport_no, email]';
COMMENT ON COLUMN document_verification_logs.matching_result IS 'JSON object with detailed matching logic results: {matched: bool, matched_on: [field names], confidence: 0-1, candidate_fields: {...}}';
COMMENT ON COLUMN document_verification_logs.raw_ai_response IS 'Complete raw response from AI service. SECURED - server-side only, never exposed to frontend';
COMMENT ON COLUMN document_verification_logs.error_message IS 'Human-readable error message if event_status=failure';
COMMENT ON COLUMN document_verification_logs.error_stack IS 'Stack trace for debugging (secured, server-side only)';

-- =============================================================================
-- PART 4: Create helper view for timeline queries
-- =============================================================================

CREATE OR REPLACE VIEW document_verification_timeline AS
SELECT 
  dvl.id,
  dvl.request_id,
  dvl.document_id,
  dvl.candidate_id,
  c.name AS candidate_name,
  dvl.event_type,
  dvl.event_status,
  dvl.file_name,
  dvl.detected_category,
  get_document_category_display_name(dvl.detected_category) AS category_display_name,
  dvl.confidence,
  dvl.verification_status,
  dvl.reason_code,
  dvl.mismatch_fields,
  dvl.created_at,
  dvl.upload_time,
  dvl.scan_start_time,
  dvl.scan_end_time,
  dvl.verify_time,
  -- Calculate processing durations
  EXTRACT(EPOCH FROM (dvl.scan_end_time - dvl.scan_start_time)) AS scan_duration_seconds,
  EXTRACT(EPOCH FROM (dvl.verify_time - dvl.scan_end_time)) AS verification_duration_seconds,
  EXTRACT(EPOCH FROM (dvl.created_at - dvl.upload_time)) AS total_processing_seconds
FROM document_verification_logs dvl
LEFT JOIN candidates c ON dvl.candidate_id = c.id
ORDER BY dvl.created_at DESC;

COMMENT ON VIEW document_verification_timeline IS 'User-friendly view of document verification events with candidate names and processing durations';

-- =============================================================================
-- PART 5: Create function to log verification events
-- =============================================================================

CREATE OR REPLACE FUNCTION log_verification_event(
  p_request_id UUID,
  p_event_type TEXT,
  p_document_id UUID DEFAULT NULL,
  p_candidate_id UUID DEFAULT NULL,
  p_event_status TEXT DEFAULT 'success',
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO document_verification_logs (
    request_id,
    event_type,
    document_id,
    candidate_id,
    event_status,
    metadata,
    created_at
  ) VALUES (
    p_request_id,
    p_event_type,
    p_document_id,
    p_candidate_id,
    p_event_status,
    p_metadata,
    NOW()
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION log_verification_event IS 'Helper function to create verification log entries. Returns log entry ID.';

-- =============================================================================
-- PART 6: Enable RLS (if needed)
-- =============================================================================

-- Note: Adjust RLS policies based on your security requirements
-- For now, allowing authenticated users to read logs

-- ALTER TABLE document_verification_logs ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY verification_logs_select ON document_verification_logs
--   FOR SELECT USING (true);

-- CREATE POLICY verification_logs_insert ON document_verification_logs
--   FOR INSERT WITH CHECK (true);
