-- Idempotency support table
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash text NOT NULL UNIQUE,
    resource_type text NOT NULL,
    request_hash text NOT NULL,
    attachment_hash text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    response_body jsonb,
    response_status integer,
    error jsonb,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_status ON idempotency_keys(status);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys(expires_at);
