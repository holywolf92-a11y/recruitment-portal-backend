-- Comprehensive fix for candidate_documents source constraint
-- Run this entire script in Supabase SQL Editor

-- 1. Check current constraint definition
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS current_definition
FROM pg_constraint
WHERE conrelid = 'candidate_documents'::regclass
  AND conname = 'candidate_documents_source_check';

-- 2. Drop the constraint
ALTER TABLE candidate_documents 
DROP CONSTRAINT IF EXISTS candidate_documents_source_check;

-- 3. Recreate with explicit array format (PostgreSQL native)
ALTER TABLE candidate_documents 
ADD CONSTRAINT candidate_documents_source_check 
CHECK (source = ANY (ARRAY['gmail'::text, 'whatsapp'::text, 'web'::text, 'manual'::text, 'api'::text, 'email'::text]));

-- 4. Verify the new constraint
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS new_definition
FROM pg_constraint
WHERE conrelid = 'candidate_documents'::regclass
  AND conname = 'candidate_documents_source_check';

-- 5. Test insert with source='web' (should succeed)
DO $$
DECLARE
  test_candidate_id UUID;
  test_doc_id UUID;
BEGIN
  -- Get a candidate
  SELECT id INTO test_candidate_id 
  FROM candidates 
  LIMIT 1;

  IF test_candidate_id IS NOT NULL THEN
    -- Try to insert with source='web'
    INSERT INTO candidate_documents (
      candidate_id,
      document_type,
      storage_bucket,
      storage_path,
      file_name,
      source,
      status,
      verification_status
    ) VALUES (
      test_candidate_id,
      'other',
      'documents',
      'test/constraint-verification-' || NOW()::text || '.txt',
      'constraint-test.txt',
      'web',
      'received',
      'pending_ai'
    )
    RETURNING id INTO test_doc_id;

    RAISE NOTICE 'SUCCESS: Inserted test document with source=web, id=%', test_doc_id;

    -- Clean up
    DELETE FROM candidate_documents WHERE id = test_doc_id;
    RAISE NOTICE 'Test record cleaned up';
  ELSE
    RAISE NOTICE 'No candidates found for testing';
  END IF;
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'FAILED: Constraint still blocking source=web';
    RAISE NOTICE 'Error: %', SQLERRM;
  WHEN OTHERS THEN
    RAISE NOTICE 'Error: %', SQLERRM;
END $$;

-- 6. Show current distinct source values in use
SELECT DISTINCT source, COUNT(*) as count
FROM candidate_documents
GROUP BY source
ORDER BY count DESC;
