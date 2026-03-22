CREATE TABLE IF NOT EXISTS hostinger_polling_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'hostinger-imap',
  mailbox TEXT NOT NULL DEFAULT 'INBOX',
  trigger TEXT NOT NULL DEFAULT 'worker'
    CHECK (trigger IN ('worker', 'manual', 'recovery', 'backfill')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')),
  worker_instance_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  unread_count_before INTEGER NOT NULL DEFAULT 0 CHECK (unread_count_before >= 0),
  unread_count_after INTEGER NOT NULL DEFAULT 0 CHECK (unread_count_after >= 0),
  messages_discovered INTEGER NOT NULL DEFAULT 0 CHECK (messages_discovered >= 0),
  messages_processed INTEGER NOT NULL DEFAULT 0 CHECK (messages_processed >= 0),
  messages_matched INTEGER NOT NULL DEFAULT 0 CHECK (messages_matched >= 0),
  messages_unmatched INTEGER NOT NULL DEFAULT 0 CHECK (messages_unmatched >= 0),
  attachment_upload_success_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_upload_success_count >= 0),
  attachment_upload_error_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_upload_error_count >= 0),
  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_code TEXT,
  error_message TEXT,
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hostinger_polling_runs_completed_after_started
    CHECK (completed_at IS NULL OR completed_at >= started_at),
  CONSTRAINT hostinger_polling_runs_duration_non_negative
    CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'source'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'provider'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      RENAME COLUMN source TO provider;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'mailbox'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN mailbox TEXT NOT NULL DEFAULT 'INBOX';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN status TEXT NOT NULL DEFAULT 'running';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'worker_instance_id'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN worker_instance_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'duration_ms'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN duration_ms BIGINT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'unread_count_before'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN unread_count_before INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'unread_count_after'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN unread_count_after INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'messages_discovered'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN messages_discovered INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'messages_processed'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN messages_processed INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'messages_matched'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN messages_matched INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'messages_unmatched'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN messages_unmatched INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'attachment_upload_success_count'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN attachment_upload_success_count INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'attachment_upload_error_count'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN attachment_upload_error_count INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'error_code'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN error_code TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'error_details'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD COLUMN error_details JSONB;
  END IF;

  UPDATE hostinger_polling_runs
  SET provider = COALESCE(NULLIF(provider, ''), 'hostinger-imap')
  WHERE provider IS NULL OR provider = '';

  UPDATE hostinger_polling_runs
  SET mailbox = COALESCE(NULLIF(mailbox, ''), 'INBOX')
  WHERE mailbox IS NULL OR mailbox = '';

  UPDATE hostinger_polling_runs
  SET status = CASE
    WHEN completed_at IS NULL THEN 'running'
    WHEN COALESCE(error_count, 0) > 0 THEN 'completed_with_errors'
    ELSE 'completed'
  END
  WHERE status IS NULL OR status = '';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hostinger_polling_runs_completed_after_started'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD CONSTRAINT hostinger_polling_runs_completed_after_started
      CHECK (completed_at IS NULL OR completed_at >= started_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hostinger_polling_runs_duration_non_negative'
  ) THEN
    ALTER TABLE hostinger_polling_runs
      ADD CONSTRAINT hostinger_polling_runs_duration_non_negative
      CHECK (duration_ms IS NULL OR duration_ms >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_runs_started_at
ON hostinger_polling_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_runs_provider_started_at
ON hostinger_polling_runs(provider, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_runs_status_started_at
ON hostinger_polling_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_runs_running
ON hostinger_polling_runs(started_at DESC)
WHERE status = 'running';