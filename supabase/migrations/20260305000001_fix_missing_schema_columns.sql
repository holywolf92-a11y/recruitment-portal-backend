-- Fix missing columns causing CV parsing failures
-- Error 1: column inbox_attachments.parsing_status does not exist
-- Error 2: column parsing_jobs.error_code does not exist

-- ── inbox_attachments: add parsing_status ──────────────────────────────────
ALTER TABLE inbox_attachments
  ADD COLUMN IF NOT EXISTS parsing_status text DEFAULT 'pending';

-- ── parsing_jobs: add missing columns ─────────────────────────────────────
ALTER TABLE parsing_jobs
  ADD COLUMN IF NOT EXISTS error_code    text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS finished_at   timestamptz;

-- Indexes for efficient status queries
CREATE INDEX IF NOT EXISTS inbox_attachments_parsing_status_idx
  ON inbox_attachments (parsing_status);

CREATE INDEX IF NOT EXISTS parsing_jobs_finished_at_idx
  ON parsing_jobs (finished_at DESC)
  WHERE finished_at IS NOT NULL;
