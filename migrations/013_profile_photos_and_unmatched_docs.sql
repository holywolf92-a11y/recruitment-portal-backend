-- Migration 013: Profile Photos and Unmatched Documents
-- Purpose: Add profile photo storage fields and unmatched documents table for auto-linking manual review

-- Add profile photo fields to candidates table
ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS profile_photo_bucket TEXT,
ADD COLUMN IF NOT EXISTS profile_photo_path TEXT,
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

-- Add comment for profile photo fields
COMMENT ON COLUMN candidates.profile_photo_bucket IS 'Supabase storage bucket for profile photo (e.g., "documents")';
COMMENT ON COLUMN candidates.profile_photo_path IS 'Storage path to profile photo file (e.g., "candidates/{id}/photo/filename.jpg")';
COMMENT ON COLUMN candidates.profile_photo_url IS 'Optional direct URL to profile photo';

-- Create unmatched_documents table for auto-linking manual review
CREATE TABLE IF NOT EXISTS unmatched_documents (
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

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_unmatched_documents_needs_review 
  ON unmatched_documents(needs_manual_review) 
  WHERE needs_manual_review = TRUE;

CREATE INDEX IF NOT EXISTS idx_unmatched_documents_match_reason 
  ON unmatched_documents(match_reason);

CREATE INDEX IF NOT EXISTS idx_unmatched_documents_document_id 
  ON unmatched_documents(document_id);

-- Add RLS policies for unmatched_documents
ALTER TABLE unmatched_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY unmatched_documents_select ON unmatched_documents
  FOR SELECT USING (true);

CREATE POLICY unmatched_documents_insert ON unmatched_documents
  FOR INSERT WITH CHECK (true);

CREATE POLICY unmatched_documents_update ON unmatched_documents
  FOR UPDATE USING (true);

CREATE POLICY unmatched_documents_delete ON unmatched_documents
  FOR DELETE USING (true);

-- Add comment for unmatched_documents
COMMENT ON TABLE unmatched_documents IS 'Stores documents that could not be automatically linked to candidates during upload. Used for manual review of ambiguous matches, multiple matches, or no matches.';
COMMENT ON COLUMN unmatched_documents.match_reason IS 'Reason document needs manual review: no_match (no candidate found), multiple_matches (2+ candidates matched), ambiguous (low confidence), cross_candidate_conflict (uploaded from candidate A but belongs to candidate B)';
COMMENT ON COLUMN unmatched_documents.match_details IS 'JSON object with match scores and potential candidate IDs for manual review context';
