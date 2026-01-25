-- Check document and flag status for Javed Khan
-- Run this in Supabase SQL Editor

-- 1. Find the candidate
SELECT id, name, driving_license_received, driving_license_received_at
FROM candidates
WHERE LOWER(name) LIKE '%javed%khan%' OR LOWER(name) LIKE '%javed khan%';

-- 2. Find the driving license document (check exact doc_type value)
SELECT 
  id,
  candidate_id,
  doc_type,
  LOWER(doc_type) as doc_type_lower,
  file_name,
  created_at,
  storage_path
FROM documents
WHERE file_name LIKE '%driving_license%' 
  OR file_name LIKE '%split_driving_license%'
  OR LOWER(doc_type) LIKE '%driving%'
  OR LOWER(doc_type) LIKE '%license%'
ORDER BY created_at DESC
LIMIT 20;

-- 3. Check if trigger function exists and is correct
SELECT 
  proname as function_name,
  prosrc as function_body
FROM pg_proc
WHERE proname = 'update_candidate_doc_flags_from_documents';

-- 4. Check trigger exists and is enabled
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as enabled,
  CASE tgenabled
    WHEN 'O' THEN 'Enabled'
    WHEN 'D' THEN 'Disabled'
    WHEN 'R' THEN 'Replica'
    WHEN 'A' THEN 'Always'
    ELSE 'Unknown'
  END as enabled_status
FROM pg_trigger
WHERE tgname = 'trg_update_candidate_doc_flags_from_documents';

-- 5. Test trigger manually - check what doc_type values exist
SELECT DISTINCT 
  doc_type,
  LOWER(doc_type) as doc_type_lower,
  COUNT(*) as count
FROM documents
WHERE LOWER(doc_type) LIKE '%driving%' 
   OR LOWER(doc_type) LIKE '%license%'
GROUP BY doc_type
ORDER BY count DESC;

-- 6. Manual flag update (if needed) - Replace CANDIDATE_ID_HERE with actual ID from query 1
-- First, find the candidate ID:
/*
SELECT id FROM candidates WHERE LOWER(name) LIKE '%javed%khan%';
*/

-- Then update the flag manually:
/*
UPDATE candidates
SET driving_license_received = true,
    driving_license_received_at = (
      SELECT MAX(created_at) 
      FROM documents 
      WHERE candidate_id = candidates.id 
        AND (LOWER(doc_type) = 'driving_license' 
             OR LOWER(doc_type) = 'drivers_license' 
             OR LOWER(doc_type) = 'driver_license'
             OR file_name LIKE '%driving_license%')
    )
WHERE id = 'CANDIDATE_ID_HERE';
*/
