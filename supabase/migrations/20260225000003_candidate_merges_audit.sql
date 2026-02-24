-- P2: Candidate merge audit trail
--
-- Every time two candidate records are merged (winner survives, loser soft-deleted)
-- a row is written here so the operation is fully auditable.
--
-- winner_id  — the candidate that survives (keeps its candidate_code)
-- loser_id   — the candidate that was soft-deleted and folded into the winner
-- merged_by  — user identifier (e.g. 'admin', user UUID, or 'system')
-- merge_strategy — how field conflicts were resolved:
--                  'winner_wins'   = winner fields kept for all conflicts
--                  'loser_wins'    = loser fields used where winner was empty
--                  'manual'        = caller provided explicit field_overrides
-- field_overrides — JSONB diff of which fields were overwritten and from what value
-- review_reasons  — copy of needsManualReview reasons that triggered the merge

CREATE TABLE IF NOT EXISTS candidate_merges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  winner_id        uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  loser_id         uuid NOT NULL,        -- NOT a FK — loser will be soft-deleted
  merged_by        text NOT NULL DEFAULT 'system',
  merge_strategy   text NOT NULL DEFAULT 'winner_wins'
                      CHECK (merge_strategy IN ('winner_wins', 'loser_wins', 'manual')),
  field_overrides  jsonb,
  review_reasons   text[],
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Fast lookups when auditing a specific candidate's merge history
CREATE INDEX IF NOT EXISTS candidate_merges_winner_idx ON candidate_merges (winner_id);
CREATE INDEX IF NOT EXISTS candidate_merges_loser_idx  ON candidate_merges (loser_id);

COMMENT ON TABLE candidate_merges IS
  'Immutable audit log of every candidate-merge operation. '
  'One row per merge event; winner survives, loser is soft-deleted.';
