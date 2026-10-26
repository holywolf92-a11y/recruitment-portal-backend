-- 045: generic multi-mailbox IMAP polling (info@ CV intake + Hostinger replies)
--
-- Run once in the Supabase SQL editor before deploying the backend that uses it.
-- Safe to re-run.
--
-- * mailbox_polling_checkpoints gains UIDVALIDITY tracking and a lease-style single-runner lock.
-- * Run items gain 'ingested' and 'skipped' outcomes for CV intake mailboxes.
-- * Lock functions are callable only by the backend (service_role).
-- * RLS is switched on for the poller tables. The backend uses the service-role key, which
--   bypasses RLS; without it the anon key could read or rewrite checkpoints and locks.

DO $$
BEGIN
  IF to_regclass('public.mailbox_polling_checkpoints') IS NULL
     OR to_regclass('public.hostinger_polling_run_items') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'hostinger_polling_runs' AND column_name = 'last_heartbeat_at'
     ) THEN
    RAISE EXCEPTION 'Polling tables missing: run migrations/034_create_hostinger_polling_runs.sql and migrations/035_enterprise_email_reply_audit.sql first (both are safe to re-run), then this file.';
  END IF;
END $$;

ALTER TABLE mailbox_polling_checkpoints
  ADD COLUMN IF NOT EXISTS uid_validity BIGINT,
  ADD COLUMN IF NOT EXISTS lock_owner TEXT,
  ADD COLUMN IF NOT EXISTS lock_acquired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMPTZ;

ALTER TYPE email_poll_run_item_status ADD VALUE IF NOT EXISTS 'ingested';
ALTER TYPE email_poll_run_item_status ADD VALUE IF NOT EXISTS 'skipped';

CREATE INDEX IF NOT EXISTS idx_hostinger_polling_runs_provider_mailbox_started_at
ON hostinger_polling_runs(provider, mailbox, started_at DESC);

CREATE OR REPLACE FUNCTION try_acquire_mailbox_poll_lock(
  p_provider TEXT,
  p_mailbox TEXT,
  p_owner TEXT,
  p_ttl_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO mailbox_polling_checkpoints (provider, mailbox, last_seen_uid, metadata)
  VALUES (p_provider, p_mailbox, 0, '{}'::jsonb)
  ON CONFLICT (provider, mailbox) DO NOTHING;

  -- Take the lock when it is free or expired; the same owner renews its lease.
  UPDATE mailbox_polling_checkpoints
  SET lock_owner = p_owner,
      lock_acquired_at = CASE WHEN lock_owner = p_owner THEN COALESCE(lock_acquired_at, now()) ELSE now() END,
      lock_expires_at = now() + make_interval(secs => GREATEST(p_ttl_seconds, 30))
  WHERE provider = p_provider
    AND mailbox = p_mailbox
    AND (lock_owner IS NULL OR lock_owner = p_owner OR lock_expires_at IS NULL OR lock_expires_at < now());

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION release_mailbox_poll_lock(
  p_provider TEXT,
  p_mailbox TEXT,
  p_owner TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE mailbox_polling_checkpoints
  SET lock_owner = NULL,
      lock_acquired_at = NULL,
      lock_expires_at = NULL
  WHERE provider = p_provider
    AND mailbox = p_mailbox
    AND lock_owner = p_owner;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION try_acquire_mailbox_poll_lock(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_mailbox_poll_lock(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_acquire_mailbox_poll_lock(TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_mailbox_poll_lock(TEXT, TEXT, TEXT) TO service_role;

ALTER TABLE mailbox_polling_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostinger_polling_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostinger_polling_run_items ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
