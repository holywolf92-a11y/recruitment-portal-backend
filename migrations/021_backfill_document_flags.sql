-- Migration 021: Backfill document flags for existing documents
-- Purpose: Update candidate flags for documents that were inserted before the trigger was fixed
-- This migration is IDEMPOTENT - safe to run multiple times

-- =============================================================================
-- Backfill flags for existing documents
-- =============================================================================

-- Update driving_license_received flags
UPDATE candidates
SET 
  driving_license_received = true,
  driving_license_received_at = COALESCE(
    driving_license_received_at,
    (SELECT MAX(created_at) 
     FROM documents 
     WHERE candidate_id = candidates.id 
       AND (LOWER(doc_type) = 'driving_license' 
            OR LOWER(doc_type) = 'drivers_license' 
            OR LOWER(doc_type) = 'driver_license'
            OR file_name LIKE '%driving_license%')
    )
  )
WHERE id IN (
  SELECT DISTINCT candidate_id 
  FROM documents 
  WHERE (LOWER(doc_type) = 'driving_license' 
         OR LOWER(doc_type) = 'drivers_license' 
         OR LOWER(doc_type) = 'driver_license'
         OR file_name LIKE '%driving_license%')
    AND candidate_id IS NOT NULL
)
AND (driving_license_received = false OR driving_license_received IS NULL);

-- Update cnic_received flags
UPDATE candidates
SET 
  cnic_received = true,
  cnic_received_at = COALESCE(
    cnic_received_at,
    (SELECT MAX(created_at) 
     FROM documents 
     WHERE candidate_id = candidates.id 
       AND (LOWER(doc_type) = 'cnic' 
            OR LOWER(doc_type) = 'national_id'
            OR file_name LIKE '%cnic%'
            OR file_name LIKE '%national_id%')
    )
  )
WHERE id IN (
  SELECT DISTINCT candidate_id 
  FROM documents 
  WHERE (LOWER(doc_type) = 'cnic' 
         OR LOWER(doc_type) = 'national_id'
         OR file_name LIKE '%cnic%'
         OR file_name LIKE '%national_id%')
    AND candidate_id IS NOT NULL
)
AND (cnic_received = false OR cnic_received IS NULL);

-- Update passport_received flags
UPDATE candidates
SET 
  passport_received = true,
  passport_received_at = COALESCE(
    passport_received_at,
    (SELECT MAX(created_at) 
     FROM documents 
     WHERE candidate_id = candidates.id 
       AND LOWER(doc_type) = 'passport'
    )
  )
WHERE id IN (
  SELECT DISTINCT candidate_id 
  FROM documents 
  WHERE LOWER(doc_type) = 'passport'
    AND candidate_id IS NOT NULL
)
AND (passport_received = false OR passport_received IS NULL);

-- Update police_character_received flags
UPDATE candidates
SET 
  police_character_received = true,
  police_character_received_at = COALESCE(
    police_character_received_at,
    (SELECT MAX(created_at) 
     FROM documents 
     WHERE candidate_id = candidates.id 
       AND (LOWER(doc_type) = 'police_character_certificate' 
            OR LOWER(doc_type) = 'police_clearance' 
            OR LOWER(doc_type) = 'pcc'
            OR file_name LIKE '%police%character%'
            OR file_name LIKE '%pcc%')
    )
  )
WHERE id IN (
  SELECT DISTINCT candidate_id 
  FROM documents 
  WHERE (LOWER(doc_type) = 'police_character_certificate' 
         OR LOWER(doc_type) = 'police_clearance' 
         OR LOWER(doc_type) = 'pcc'
         OR file_name LIKE '%police%character%'
         OR file_name LIKE '%pcc%')
    AND candidate_id IS NOT NULL
)
AND (police_character_received = false OR police_character_received IS NULL);

-- Summary query to verify updates
SELECT 
  'driving_license' as doc_type,
  COUNT(*) as candidates_updated
FROM candidates
WHERE driving_license_received = true
  AND driving_license_received_at IS NOT NULL

UNION ALL

SELECT 
  'cnic' as doc_type,
  COUNT(*) as candidates_updated
FROM candidates
WHERE cnic_received = true
  AND cnic_received_at IS NOT NULL

UNION ALL

SELECT 
  'passport' as doc_type,
  COUNT(*) as candidates_updated
FROM candidates
WHERE passport_received = true
  AND passport_received_at IS NOT NULL

UNION ALL

SELECT 
  'police_character' as doc_type,
  COUNT(*) as candidates_updated
FROM candidates
WHERE police_character_received = true
  AND police_character_received_at IS NOT NULL;
