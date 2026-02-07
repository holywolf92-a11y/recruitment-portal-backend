-- 030_missing_data_email_loop.sql
-- Store Gmail thread identity + missing-data email loop state

ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
ADD COLUMN IF NOT EXISTS gmail_from_email TEXT,
ADD COLUMN IF NOT EXISTS gmail_last_message_id TEXT,
ADD COLUMN IF NOT EXISTS gmail_last_subject TEXT,
ADD COLUMN IF NOT EXISTS missing_data_email_status TEXT DEFAULT 'inactive',
ADD COLUMN IF NOT EXISTS missing_data_email_attempts INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS missing_data_email_last_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS missing_data_email_next_send_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS missing_data_email_last_snapshot_hash TEXT,
ADD COLUMN IF NOT EXISTS missing_data_email_last_reply_processed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_gmail_thread_id
ON candidates(gmail_thread_id)
WHERE gmail_thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_missing_data_email_next_send_at
ON candidates(missing_data_email_next_send_at)
WHERE missing_data_email_next_send_at IS NOT NULL;

-- Optional audit log of outbound missing-data emails
CREATE TABLE IF NOT EXISTS candidate_missing_data_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  gmail_thread_id TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  missing_fields JSONB,
  missing_docs JSONB,
  attempt_no INTEGER,
  trigger TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
