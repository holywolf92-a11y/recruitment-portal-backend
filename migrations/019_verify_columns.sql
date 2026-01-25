-- Verification Query for Migration 019
-- Run this in your Supabase SQL Editor or PostgreSQL client

-- Check if the new columns exist
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'candidates' 
AND column_name IN (
    'driving_license_received', 
    'driving_license_received_at',
    'police_character_received', 
    'police_character_received_at'
)
ORDER BY column_name;

-- Expected Result: Should return 4 rows
-- driving_license_received | boolean | NO | false
-- driving_license_received_at | timestamp with time zone | YES | NULL
-- police_character_received | boolean | NO | false
-- police_character_received_at | timestamp with time zone | YES | NULL

-- Also verify the trigger function was updated
SELECT 
    proname as function_name,
    CASE 
        WHEN prosrc LIKE '%driving_license%' THEN '✅ Contains driving_license'
        ELSE '❌ Missing driving_license'
    END as driving_license_check,
    CASE 
        WHEN prosrc LIKE '%police_character_certificate%' THEN '✅ Contains police_character_certificate'
        ELSE '❌ Missing police_character_certificate'
    END as police_character_check
FROM pg_proc 
WHERE proname = 'update_candidate_document_checklist';

-- Expected Result: Should return 1 row with both checks showing ✅
