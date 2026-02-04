-- Fix candidates who have approved photos but missing profile_photo_url
-- This script finds verified photo documents and updates the candidate's profile_photo_url

-- Show current state
SELECT 
  c.id,
  c.name,
  c.profile_photo_url,
  c.photo_received,
  d.id as doc_id,
  d.file_name,
  d.file_url,
  d.category,
  d.verification_status
FROM candidates c
JOIN candidate_documents d ON d.candidate_id = c.id
WHERE d.category = 'photos'
  AND d.verification_status = 'verified'
  AND (c.profile_photo_url IS NULL OR c.profile_photo_url = '');

-- Update candidates with their approved photo URLs
UPDATE candidates c
SET 
  profile_photo_url = d.file_url,
  photo_received = true,
  updated_at = NOW()
FROM candidate_documents d
WHERE d.candidate_id = c.id
  AND d.category = 'photos'
  AND d.verification_status = 'verified'
  AND (c.profile_photo_url IS NULL OR c.profile_photo_url = '')
RETURNING c.id, c.name, c.profile_photo_url;
