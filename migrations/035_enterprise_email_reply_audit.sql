DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_poll_run_trigger') THEN
    CREATE TYPE email_poll_run_trigger AS ENUM ('worker', 'manual', 'recovery', 'backfill');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_poll_run_status') THEN
    CREATE TYPE email_poll_run_status AS ENUM ('running', 'completed', 'completed_with_errors', 'failed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_poll_run_item_status') THEN
    CREATE TYPE email_poll_run_item_status AS ENUM ('pending', 'duplicate', 'matched', 'unmatched', 'failed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_reply_match_status') THEN
    CREATE TYPE email_reply_match_status AS ENUM ('matched', 'unmatched', 'failed');
  END IF;
END $$;

ALTER TABLE hostinger_polling_runs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ;

UPDATE hostinger_polling_runs
SET last_heartbeat_at = COALESCE(last_heartbeat_at, started_at)
WHERE last_heartbeat_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'trigger'
      AND udt_name = 'text'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'hostinger_polling_runs_trigger_check'
    ) THEN
      ALTER TABLE hostinger_polling_runs DROP CONSTRAINT hostinger_polling_runs_trigger_check;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'trigger'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE hostinger_polling_runs ALTER COLUMN trigger DROP DEFAULT;
    ALTER TABLE hostinger_polling_runs ALTER COLUMN trigger TYPE email_poll_run_trigger USING trigger::email_poll_run_trigger;
    ALTER TABLE hostinger_polling_runs ALTER COLUMN trigger SET DEFAULT 'worker'::email_poll_run_trigger;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'status'
      AND udt_name = 'text'
  ) THEN
    DROP INDEX IF EXISTS idx_hostinger_polling_runs_running;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'hostinger_polling_runs_status_check'
    ) THEN
      ALTER TABLE hostinger_polling_runs DROP CONSTRAINT hostinger_polling_runs_status_check;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'hostinger_polling_runs'
      AND column_name = 'status'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE hostinger_polling_runs ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE hostinger_polling_runs ALTER COLUMN status TYPE email_poll_run_status USING status::email_poll_run_status;
    ALTER TABLE hostinger_polling_runs ALTER COLUMN status SET DEFAULT 'running'::email_poll_run_status;
  END IF;
END $$;

ALTER TABLE hostinger_polling_runs
  ALTER COLUMN last_heartbeat_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_runs_heartbeat
ON hostinger_polling_runs(last_heartbeat_at DESC);

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_runs_running
ON hostinger_polling_runs(started_at DESC)
WHERE status = 'running'::email_poll_run_status;

CREATE TABLE IF NOT EXISTS mailbox_polling_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  last_seen_uid BIGINT NOT NULL DEFAULT 0 CHECK (last_seen_uid >= 0),
  last_seen_message_id TEXT,
  last_seen_received_at TIMESTAMPTZ,
  last_poll_run_id UUID REFERENCES hostinger_polling_runs(id) ON DELETE SET NULL,
  last_poll_started_at TIMESTAMPTZ,
  last_poll_completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mailbox_polling_checkpoints_provider_mailbox_unique UNIQUE (provider, mailbox)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_polling_checkpoints_provider_mailbox
ON mailbox_polling_checkpoints(provider, mailbox);

INSERT INTO mailbox_polling_checkpoints (
  provider,
  mailbox,
  last_seen_uid,
  last_seen_message_id,
  last_seen_received_at,
  metadata
)
SELECT
  'hostinger-imap',
  'INBOX',
  COALESCE(MAX(CASE WHEN COALESCE(payload->>'uid', '') ~ '^[0-9]+$' THEN (payload->>'uid')::BIGINT ELSE 0 END), 0) AS last_seen_uid,
  (
    ARRAY_REMOVE(
      ARRAY_AGG(
        CASE
          WHEN COALESCE(payload->>'uid', '') ~ '^[0-9]+$' THEN payload->>'messageId'
          ELSE NULL
        END
        ORDER BY CASE WHEN COALESCE(payload->>'uid', '') ~ '^[0-9]+$' THEN (payload->>'uid')::BIGINT ELSE 0 END DESC
      ),
      NULL
    )
  )[1] AS last_seen_message_id,
  MAX(received_at) AS last_seen_received_at,
  jsonb_build_object('seeded_from', 'inbox_messages', 'seeded_at', now())
FROM inbox_messages
WHERE source = 'hostinger-imap'
ON CONFLICT (provider, mailbox)
DO UPDATE SET
  last_seen_uid = GREATEST(mailbox_polling_checkpoints.last_seen_uid, EXCLUDED.last_seen_uid),
  last_seen_message_id = COALESCE(EXCLUDED.last_seen_message_id, mailbox_polling_checkpoints.last_seen_message_id),
  last_seen_received_at = COALESCE(EXCLUDED.last_seen_received_at, mailbox_polling_checkpoints.last_seen_received_at),
  metadata = mailbox_polling_checkpoints.metadata || EXCLUDED.metadata,
  updated_at = now();

CREATE TABLE IF NOT EXISTS hostinger_polling_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES hostinger_polling_runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'hostinger-imap',
  mailbox TEXT NOT NULL DEFAULT 'INBOX',
  message_uid BIGINT,
  provider_message_id TEXT,
  external_message_id TEXT,
  inbox_message_id UUID REFERENCES inbox_messages(id) ON DELETE SET NULL,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  matched_by TEXT,
  status email_poll_run_item_status NOT NULL DEFAULT 'pending',
  attachment_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_count >= 0),
  attachment_upload_success_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_upload_success_count >= 0),
  attachment_upload_error_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_upload_error_count >= 0),
  received_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hostinger_polling_run_items_run_uid_unique UNIQUE (run_id, message_uid)
);

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_run_items_run_id
ON hostinger_polling_run_items(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_run_items_status
ON hostinger_polling_run_items(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_run_items_candidate
ON hostinger_polling_run_items(candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_run_items_provider_mailbox_uid
ON hostinger_polling_run_items(provider, mailbox, message_uid DESC);

CREATE TABLE IF NOT EXISTS email_reply_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  mailbox TEXT NOT NULL DEFAULT 'INBOX',
  message_uid BIGINT,
  provider_message_id TEXT,
  external_message_id TEXT,
  inbox_message_id UUID REFERENCES inbox_messages(id) ON DELETE SET NULL,
  run_id UUID REFERENCES hostinger_polling_runs(id) ON DELETE SET NULL,
  run_item_id UUID REFERENCES hostinger_polling_run_items(id) ON DELETE SET NULL,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  match_status email_reply_match_status NOT NULL,
  matched_by TEXT,
  tracking_token TEXT,
  from_email TEXT,
  from_display TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  body_preview TEXT,
  attachment_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_count >= 0),
  attachment_upload_success_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_upload_success_count >= 0),
  attachment_upload_error_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_upload_error_count >= 0),
  received_at TIMESTAMPTZ,
  in_reply_to TEXT,
  reference_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  correlation_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_reply_events_provider_mailbox_uid
ON email_reply_events(provider, mailbox, message_uid)
WHERE message_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_reply_events_candidate_received_at
ON email_reply_events(candidate_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_reply_events_match_status_received_at
ON email_reply_events(match_status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_reply_events_run_id
ON email_reply_events(run_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_email_reply_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'email_reply_events is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_reply_events_immutable ON email_reply_events;

CREATE TRIGGER trg_email_reply_events_immutable
BEFORE UPDATE OR DELETE ON email_reply_events
FOR EACH ROW
EXECUTE FUNCTION prevent_email_reply_event_mutation();

INSERT INTO email_reply_events (
  provider,
  mailbox,
  message_uid,
  provider_message_id,
  external_message_id,
  inbox_message_id,
  candidate_id,
  match_status,
  matched_by,
  tracking_token,
  from_email,
  from_display,
  to_email,
  subject,
  body_text,
  body_preview,
  attachment_count,
  received_at,
  in_reply_to,
  reference_ids,
  correlation_ids,
  error_code,
  error_message,
  created_at
)
SELECT
  COALESCE(NULLIF(payload->>'provider', ''), source) AS provider,
  'INBOX' AS mailbox,
  CASE WHEN COALESCE(payload->>'uid', '') ~ '^[0-9]+$' THEN (payload->>'uid')::BIGINT ELSE NULL END AS message_uid,
  NULLIF(payload->>'messageId', '') AS provider_message_id,
  external_message_id,
  id AS inbox_message_id,
  NULLIF(payload->>'candidateId', '')::UUID AS candidate_id,
  CASE
    WHEN COALESCE(payload->>'matched', 'false') = 'true' THEN 'matched'::email_reply_match_status
    ELSE 'unmatched'::email_reply_match_status
  END AS match_status,
  NULLIF(payload->>'matchedBy', '') AS matched_by,
  NULLIF((regexp_match(COALESCE(payload->>'subject', '') || E'\n' || COALESCE(payload->>'bodyText', ''), '\\[#([A-Z]{2}\\d{6})\\]', 'i'))[1], '') AS tracking_token,
  NULLIF(payload->>'from', '') AS from_email,
  NULLIF(payload->>'from', '') AS from_display,
  NULLIF(payload->>'to', '') AS to_email,
  NULLIF(payload->>'subject', '') AS subject,
  NULLIF(payload->>'bodyText', '') AS body_text,
  LEFT(COALESCE(payload->>'bodyText', ''), 1000) AS body_preview,
  COALESCE(NULLIF(payload->>'attachmentCount', '')::INTEGER, 0) AS attachment_count,
  received_at,
  NULLIF(payload->>'inReplyTo', '') AS in_reply_to,
  COALESCE(payload->'references', '[]'::jsonb) AS reference_ids,
  jsonb_build_object(
    'candidateId', payload->>'candidateId',
    'matchedBy', payload->>'matchedBy',
    'providerMessageId', payload->>'messageId'
  ) AS correlation_ids,
  CASE WHEN status = 'failed' THEN 'LEGACY_UNMATCHED_REPLY' ELSE NULL END AS error_code,
  CASE WHEN status = 'failed' THEN 'Backfilled from inbox_messages failed status' ELSE NULL END AS error_message,
  received_at AS created_at
FROM inbox_messages
WHERE source = 'hostinger-imap'
  AND payload IS NOT NULL
  AND (payload ? 'messageId')
  AND NOT EXISTS (
    SELECT 1
    FROM email_reply_events existing
    WHERE existing.provider = COALESCE(NULLIF(inbox_messages.payload->>'provider', ''), inbox_messages.source)
      AND existing.mailbox = 'INBOX'
      AND (
        (
          CASE
            WHEN COALESCE(inbox_messages.payload->>'uid', '') ~ '^[0-9]+$' THEN (inbox_messages.payload->>'uid')::BIGINT
            ELSE NULL
          END
        ) IS NOT NULL
        AND existing.message_uid = (
          CASE
            WHEN COALESCE(inbox_messages.payload->>'uid', '') ~ '^[0-9]+$' THEN (inbox_messages.payload->>'uid')::BIGINT
            ELSE NULL
          END
        )
      )
  );