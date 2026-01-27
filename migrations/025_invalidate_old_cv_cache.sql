-- Migration: Invalidate old CV cache for new template design
-- Description: This migration deletes all cached CV entries that were generated
--              with the old template before the colorful infographic redesign.
--              This forces regeneration with the new template while maintaining
--              a clean cache system.
-- Date: 2026-01-27
-- Author: CV Generation System

-- Step 1: Log the number of entries to be deleted (for audit purposes)
DO $$
DECLARE
  old_cache_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO old_cache_count FROM generated_cvs;
  RAISE NOTICE 'Found % cached CV entries to invalidate', old_cache_count;
END $$;

-- Step 2: Delete cached CV files from storage
-- Note: Supabase Storage files need to be deleted via API or will remain as orphans
-- This SQL just removes the database records. A cleanup script may be needed for storage.
DELETE FROM generated_cvs
WHERE created_at < NOW() - INTERVAL '1 hour'  -- Only delete entries older than 1 hour
  AND version_hash NOT LIKE '%v2.0-colorful%'; -- Keep any new template versions

-- Step 3: Log completion
DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_count FROM generated_cvs;
  RAISE NOTICE 'Cache invalidation complete. Remaining entries: %', remaining_count;
END $$;

-- Step 4: Add an index on version_hash for faster cache lookups
CREATE INDEX IF NOT EXISTS idx_generated_cvs_version_hash 
ON generated_cvs(version_hash);

-- Step 5: Add an index on created_at for cleanup queries
CREATE INDEX IF NOT EXISTS idx_generated_cvs_created_at 
ON generated_cvs(created_at DESC);

COMMENT ON INDEX idx_generated_cvs_version_hash IS 'Improves cache lookup performance by version hash';
COMMENT ON INDEX idx_generated_cvs_created_at IS 'Enables efficient cleanup of old cached CVs';
