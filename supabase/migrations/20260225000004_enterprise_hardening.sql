-- ============================================================================
-- P3: Enterprise Hardening
-- ============================================================================
-- Changes in this migration:
--
-- 1. candidate_merges.pre_merge_snapshot   — forensic snapshot of both records
--                                           BEFORE any writes happen
-- 2. active_candidates VIEW                — soft-delete enforcement at DB layer
-- 3. candidates.last_match_confidence      — persisted confidence score per match
-- 4. candidates.last_match_signals         — persisted signal breakdown per match
-- 5. merge_candidates_atomic()             — PL/pgSQL function that executes the
--                                           entire merge inside ONE transaction
--                                           with SELECT ... FOR UPDATE row locking
-- ============================================================================

-- ── 1. Pre-merge snapshot column ─────────────────────────────────────────────
ALTER TABLE candidate_merges
  ADD COLUMN IF NOT EXISTS pre_merge_snapshot jsonb;

COMMENT ON COLUMN candidate_merges.pre_merge_snapshot IS
  'Full JSON snapshot of both candidates captured BEFORE any merge writes. '
  'Supports forensic audit, rollback analysis, and legal review. '
  'Shape: { "winner_before": {...}, "loser_before": {...} }';

-- ── 2. Soft-delete enforcement view ──────────────────────────────────────────
CREATE OR REPLACE VIEW active_candidates AS
  SELECT * FROM candidates
  WHERE status IS DISTINCT FROM 'Deleted';

COMMENT ON VIEW active_candidates IS
  'All non-deleted candidates. Always query this view instead of the raw '
  'candidates table so soft-deleted records are transparently excluded. '
  'Losers from candidate merges are soft-deleted and excluded here.';

-- ── 3 & 4. Confidence persistence columns ────────────────────────────────────
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS last_match_confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS last_match_signals    jsonb;

COMMENT ON COLUMN candidates.last_match_confidence IS
  'Final probabilistic confidence score (0.000–0.999) of the most recent '
  'matching event that linked a document to this candidate. '
  'Stored to make auto-merge decisions explainable after the fact.';

COMMENT ON COLUMN candidates.last_match_signals IS
  'Signal breakdown of the most recent match event, e.g. '
  '{"cnic":1.0,"phone":0.92,"name":0.88}. '
  'Used by the admin audit view and by monitoring dashboards.';

-- Index to query confidence distribution
CREATE INDEX IF NOT EXISTS candidates_match_confidence_idx
  ON candidates (last_match_confidence)
  WHERE last_match_confidence IS NOT NULL;

-- ── 5. Atomic merge function with row-level locking ──────────────────────────
-- This function is called by mergeCandidateService.ts via db.rpc(...)
-- It runs entirely inside a single transaction:
--   a) SELECT ... FOR UPDATE on both candidates (prevents concurrent merges)
--   b) Apply winner field updates
--   c) Relink inbox_attachments
--   d) Move candidate_documents
--   e) Delete duplicate documents from loser
--   f) Soft-delete loser
--   g) Insert audit row with snapshot
-- Returns jsonb: { audit_id, attachments_relinked, docs_moved }

CREATE OR REPLACE FUNCTION merge_candidates_atomic(
  p_winner_id          uuid,
  p_loser_id           uuid,
  p_winner_updates     jsonb,      -- computed in TS: { field: value, ... }
  p_docs_to_move       uuid[],     -- computed in TS: doc IDs to move to winner
  p_docs_to_delete     uuid[],     -- computed in TS: duplicate doc IDs to delete
  p_merged_by          text,
  p_strategy           text,
  p_pre_merge_snapshot jsonb,      -- { winner_before: {...}, loser_before: {...} }
  p_field_overrides    jsonb,      -- { field: { from, to } } diff for audit
  p_review_reasons     text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_audit_id             uuid;
  v_attachments_relinked int := 0;
  v_docs_moved           int := 0;
  v_key                  text;
  v_val                  text;
  v_update_sql           text;
  v_update_parts         text[] := ARRAY[]::text[];
BEGIN
  -- ── a) Row-level lock: prevents two concurrent merges on the same pair ──
  --       Both rows are locked for the duration of this transaction.
  PERFORM id
    FROM candidates
    WHERE id IN (p_winner_id, p_loser_id)
    FOR UPDATE;  -- blocks any other transaction trying to touch these rows

  IF NOT FOUND THEN
    RAISE EXCEPTION 'One or both candidates not found: % %', p_winner_id, p_loser_id;
  END IF;

  -- Guard: loser must not already be deleted (double-merge guard)
  IF EXISTS (
    SELECT 1 FROM candidates WHERE id = p_loser_id AND status = 'Deleted'
  ) THEN
    RAISE EXCEPTION 'Loser candidate % is already deleted — merge aborted', p_loser_id;
  END IF;

  -- ── b) Apply winner field updates (dynamic, from TypeScript payload) ───
  IF p_winner_updates IS NOT NULL AND p_winner_updates <> '{}'::jsonb THEN
    -- Build safe dynamic UPDATE via explicit allow-list (prevents SQL injection)
    FOR v_key, v_val IN
      SELECT key, value
      FROM jsonb_each_text(p_winner_updates)
      WHERE key = ANY(ARRAY[
        'father_name','date_of_birth','cnic','cnic_normalized','passport',
        'passport_normalized','passport_expiry','nationality','gender',
        'marital_status','address','phone','email','position',
        'experience_years','country_of_interest','education','skills',
        'languages','certifications','previous_employment',
        'professional_summary','profile_photo_url',
        'profile_photo_bucket','profile_photo_path'
      ])
    LOOP
      v_update_parts := v_update_parts
        || (quote_ident(v_key) || ' = ' || quote_nullable(v_val));
    END LOOP;

    IF array_length(v_update_parts, 1) > 0 THEN
      v_update_sql :=
        'UPDATE candidates SET updated_at = now(), '
        || array_to_string(v_update_parts, ', ')
        || ' WHERE id = ' || quote_literal(p_winner_id);
      EXECUTE v_update_sql;
    END IF;
  END IF;

  -- ── c) Relink inbox_attachments from loser → winner ────────────────────
  UPDATE inbox_attachments
     SET candidate_id = p_winner_id
   WHERE candidate_id = p_loser_id;

  GET DIAGNOSTICS v_attachments_relinked = ROW_COUNT;

  -- ── d) Move candidate_documents from loser → winner ────────────────────
  IF array_length(p_docs_to_move, 1) > 0 THEN
    UPDATE candidate_documents
       SET candidate_id = p_winner_id
     WHERE id = ANY(p_docs_to_move);

    GET DIAGNOSTICS v_docs_moved = ROW_COUNT;
  END IF;

  -- ── e) Delete loser's duplicate documents ──────────────────────────────
  IF array_length(p_docs_to_delete, 1) > 0 THEN
    DELETE FROM candidate_documents
     WHERE id = ANY(p_docs_to_delete);
  END IF;

  -- ── f) Soft-delete the loser ────────────────────────────────────────────
  UPDATE candidates
     SET status     = 'Deleted',
         updated_at = now()
   WHERE id = p_loser_id;

  -- ── g) Insert immutable audit row ──────────────────────────────────────
  INSERT INTO candidate_merges (
    winner_id, loser_id, merged_by, merge_strategy,
    field_overrides, review_reasons, pre_merge_snapshot
  ) VALUES (
    p_winner_id, p_loser_id, p_merged_by, p_strategy,
    p_field_overrides, p_review_reasons, p_pre_merge_snapshot
  )
  RETURNING id INTO v_audit_id;

  -- ── Return result summary ───────────────────────────────────────────────
  RETURN jsonb_build_object(
    'audit_id',             v_audit_id,
    'attachments_relinked', v_attachments_relinked,
    'docs_moved',           v_docs_moved
  );

EXCEPTION
  -- Any error automatically rolls back all changes (Postgres default)
  WHEN OTHERS THEN
    RAISE EXCEPTION 'merge_candidates_atomic failed: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION merge_candidates_atomic IS
  'Atomically merges two candidate records inside a single transaction. '
  'Uses SELECT FOR UPDATE row-level locking to prevent concurrent merges. '
  'Called by mergeCandidateService.ts via supabase.rpc().';

-- Grant execution to service role (used by the backend)
GRANT EXECUTE ON FUNCTION merge_candidates_atomic TO service_role;
