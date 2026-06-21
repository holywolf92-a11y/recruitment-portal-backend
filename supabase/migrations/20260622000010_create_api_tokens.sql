-- ============================================================================
-- api_tokens — long-lived personal access tokens for the Chrome extension
-- (and future programmatic clients). Token format: fal_ext_<32-char base32>.
-- Stored as SHA-256 hex; plaintext shown to the user exactly once at issuance.
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,                     -- SHA-256 hex of plaintext
  token_prefix text NOT NULL,                     -- e.g. 'fal_ext_a1b2c3d4' (first 16 chars) for UI display
  name         text NOT NULL,                     -- user-given label, e.g. 'Chrome — work laptop'
  scope        text NOT NULL DEFAULT 'extension', -- room for future scopes
  last_used_at timestamptz,
  expires_at   timestamptz,                       -- NULL = non-expiring
  revoked_at   timestamptz,                       -- soft-delete preserves audit trail
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Hot-path lookup: when authenticate() sees a fal_ext_ token it hashes and
-- looks it up. Partial index on active rows keeps this O(1) at scale.
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_active_hash_idx
  ON api_tokens (token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS api_tokens_active_user_idx
  ON api_tokens (user_id, created_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
-- No RLS policies — service-role only. The backend uses supabaseAdminClient()
-- which bypasses RLS; the frontend never touches this table directly.

COMMENT ON TABLE  api_tokens             IS 'Long-lived per-user bearer tokens for the Chrome extension. SHA-256-hashed, soft-deleted on revoke.';
COMMENT ON COLUMN api_tokens.token_hash  IS 'SHA-256 hex digest of the plaintext token. Plaintext is never stored.';
COMMENT ON COLUMN api_tokens.token_prefix IS 'First 16 chars of the plaintext for UI display (so users can identify which token in their list).';
COMMENT ON COLUMN api_tokens.scope       IS 'Reserved for future per-token capabilities (e.g. extension, ci, readonly).';
