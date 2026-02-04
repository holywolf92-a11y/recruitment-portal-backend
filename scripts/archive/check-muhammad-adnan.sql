-- Check Documents for MR. MUHAMMAD ADNAN
-- Run this in Supabase SQL Editor

-- Step 1: Find the candidate
SELECT 
    id,
    name,
    candidate_code,
    position,
    cnic_received,
    passport_received,
    driving_license_received,
    police_character_received,
    photo_received,
    cv_received
FROM candidates
WHERE name ILIKE '%MUHAMMAD ADNAN%'
ORDER BY created_at DESC
LIMIT 5;

-- Step 2: Check all documents for this candidate (replace CANDIDATE_ID with actual ID from above)
-- Replace 'YOUR_CANDIDATE_ID_HERE' with the actual candidate ID from Step 1
SELECT 
    cd.id,
    cd.file_name,
    cd.category,
    cd.detected_category,
    cd.verification_status,
    cd.verification_reason_code,
    cd.rejection_code,
    cd.rejection_reason,
    cd.confidence,
    cd.ai_processing_completed_at,
    cd.verification_completed_at,
    cd.created_at,
    -- Check if identity fields were extracted
    CASE 
        WHEN cd.extracted_identity_json IS NULL THEN '❌ No identity data'
        WHEN jsonb_object_keys(cd.extracted_identity_json) IS NULL THEN '❌ Empty identity data'
        ELSE '✅ Has identity fields'
    END as identity_status,
    -- Show extracted fields
    jsonb_object_keys(cd.extracted_identity_json) as extracted_fields
FROM candidate_documents cd
WHERE cd.candidate_id = 'YOUR_CANDIDATE_ID_HERE'  -- REPLACE THIS WITH ACTUAL CANDIDATE ID
ORDER BY cd.created_at DESC;

-- Step 3: Check verification logs for this candidate's documents
-- Replace 'YOUR_CANDIDATE_ID_HERE' with the actual candidate ID
SELECT 
    dvl.id,
    dvl.document_id,
    cd.file_name,
    dvl.event_type,
    dvl.event_status,
    dvl.verification_status,
    dvl.reason_code,
    dvl.mismatch_fields,
    dvl.metadata,
    dvl.created_at
FROM document_verification_logs dvl
JOIN candidate_documents cd ON cd.id = dvl.document_id
WHERE cd.candidate_id = 'YOUR_CANDIDATE_ID_HERE'  -- REPLACE THIS WITH ACTUAL CANDIDATE ID
ORDER BY dvl.created_at DESC
LIMIT 50;

-- Step 4: Summary by status
-- Replace 'YOUR_CANDIDATE_ID_HERE' with the actual candidate ID
SELECT 
    verification_status,
    COUNT(*) as count,
    STRING_AGG(DISTINCT category, ', ') as categories
FROM candidate_documents
WHERE candidate_id = 'YOUR_CANDIDATE_ID_HERE'  -- REPLACE THIS WITH ACTUAL CANDIDATE ID
GROUP BY verification_status
ORDER BY count DESC;

-- Step 5: Check why photos are pending
-- Replace 'YOUR_CANDIDATE_ID_HERE' with the actual candidate ID
SELECT 
    cd.id,
    cd.file_name,
    cd.category,
    cd.verification_status,
    cd.verification_reason_code,
    cd.rejection_reason,
    cd.confidence,
    cd.extracted_identity_json,
    cd.ai_processing_completed_at,
    cd.verification_completed_at,
    CASE 
        WHEN cd.verification_status = 'pending_ai' AND cd.ai_processing_completed_at IS NULL THEN '⏳ Waiting for AI processing'
        WHEN cd.verification_status = 'pending_ai' AND cd.ai_processing_completed_at IS NOT NULL THEN '⚠️ AI completed but status not updated'
        WHEN cd.verification_status = 'needs_review' THEN '👀 Needs manual review'
        WHEN cd.verification_status = 'rejected_mismatch' THEN '❌ Rejected - identity mismatch'
        WHEN cd.verification_status = 'failed' THEN '💥 Processing failed'
        ELSE '✅ ' || cd.verification_status
    END as status_explanation
FROM candidate_documents cd
WHERE cd.candidate_id = 'YOUR_CANDIDATE_ID_HERE'  -- REPLACE THIS WITH ACTUAL CANDIDATE ID
AND (cd.category = 'photos' OR cd.detected_category = 'photos' OR cd.file_name ILIKE '%photo%')
ORDER BY cd.created_at DESC;
