-- Migration 013: Profile Photos and Unmatched Documents
-- Purpose: Add profile photo storage fields and unmatched documents table for auto-linking manual review
-- This migration is IDEMPOTENT - safe to run multiple times

-- =============================================================================
-- PART 1: Add profile photo fields to candidates table
-- =============================================================================

DO $$ 
BEGIN
  -- Add profile_photo_bucket if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidates' AND column_name = 'profile_photo_bucket'
  ) THEN
    ALTER TABLE candidates ADD COLUMN profile_photo_bucket TEXT;
  END IF;

  -- Add profile_photo_path if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidates' AND column_name = 'profile_photo_path'
  ) THEN
    ALTER TABLE candidates ADD COLUMN profile_photo_path TEXT;
  END IF;

  -- Add profile_photo_url if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidates' AND column_name = 'profile_photo_url'
  ) THEN
    ALTER TABLE candidates ADD COLUMN profile_photo_url TEXT;
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON COLUMN candidates.profile_photo_bucket IS 'Supabase storage bucket for profile photo (e.g., "documents")';
COMMENT ON COLUMN candidates.profile_photo_path IS 'Storage path to profile photo file (e.g., "candidates/{id}/photo/filename.jpg")';
COMMENT ON COLUMN candidates.profile_photo_url IS 'Optional direct URL to profile photo';

-- =============================================================================
-- PART 2: Drop and recreate unmatched_documents table (if it exists partially)
-- =============================================================================

-- Drop table if it exists from previous failed migration
DROP TABLE IF EXISTS unmatched_documents CASCADE;

-- Create fresh unmatched_documents table
CREATE TABLE unmatched_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES candidate_documents(id) ON DELETE CASCADE,
  
  -- Match attempt metadata
  match_reason TEXT NOT NULL, -- 'no_match' | 'multiple_matches' | 'ambiguous' | 'cross_candidate_conflict'
  match_details JSONB, -- Store potential matches and their scores
  
  -- Document classification
  document_type TEXT, -- From DocumentClassifier
  extracted_cnic TEXT,
  extracted_email TEXT,
  extracted_phone TEXT,
  extracted_name TEXT,
  extracted_father_name TEXT,
  
  -- Manual review
  needs_manual_review BOOLEAN DEFAULT TRUE,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  resolution_action TEXT, -- 'linked_to_candidate' | 'created_new_candidate' | 'rejected'
  linked_candidate_id UUID REFERENCES candidates(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- PART 3: Add indexes for performance
-- =============================================================================

CREATE INDEX idx_unmatched_documents_needs_review 
  ON unmatched_documents(needs_manual_review) 
  WHERE needs_manual_review = TRUE;

CREATE INDEX idx_unmatched_documents_match_reason 
  ON unmatched_documents(match_reason);

CREATE INDEX idx_unmatched_documents_document_id 
  ON unmatched_documents(document_id);

-- =============================================================================
-- PART 4: Enable RLS and add policies
-- =============================================================================

ALTER TABLE unmatched_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY unmatched_documents_select ON unmatched_documents
  FOR SELECT USING (true);

CREATE POLICY unmatched_documents_insert ON unmatched_documents
  FOR INSERT WITH CHECK (true);

CREATE POLICY unmatched_documents_update ON unmatched_documents
  FOR UPDATE USING (true);

CREATE POLICY unmatched_documents_delete ON unmatched_documents
  FOR DELETE USING (true);

-- =============================================================================
-- PART 5: Add table comments
-- =============================================================================

COMMENT ON TABLE unmatched_documents IS 'Stores documents that could not be automatically linked to candidates during upload. Used for manual review of ambiguous matches, multiple matches, or no matches.';
COMMENT ON COLUMN unmatched_documents.match_reason IS 'Reason document needs manual review: no_match (no candidate found), multiple_matches (2+ candidates matched), ambiguous (low confidence), cross_candidate_conflict (uploaded from candidate A but belongs to candidate B)';
COMMENT ON COLUMN unmatched_documents.match_details IS 'JSON object with match scores and potential candidate IDs for manual review context';
