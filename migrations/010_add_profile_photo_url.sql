-- Migration: Add profile_photo_url to candidates table
-- Description: Store extracted profile photo URL from CV parsing

-- Add profile_photo_url column to candidates table
ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN candidates.profile_photo_url IS 'URL of candidate profile photo extracted from CV (Supabase Storage)';
