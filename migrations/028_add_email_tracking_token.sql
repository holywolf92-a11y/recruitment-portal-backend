-- Migration: Add email_tracking_token to candidates table
-- Purpose: Enable production-grade email reply threading and deduplication
-- Date: 2026-02-08

-- Add email_tracking_token column (unique to prevent duplicates)
ALTER TABLE candidates 
ADD COLUMN IF NOT EXISTS email_tracking_token VARCHAR(10) DEFAULT NULL UNIQUE;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_candidates_email_tracking_token 
ON candidates(email_tracking_token) 
WHERE email_tracking_token IS NOT NULL;

COMMENT ON COLUMN candidates.email_tracking_token IS 'Unique tracking token embedded in outbound emails for reliable reply matching (e.g., FL123456)';
