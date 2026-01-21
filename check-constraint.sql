-- Check current candidate_documents source constraint
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'candidate_documents'::regclass
  AND conname LIKE '%source%';

-- Also show a sample of current source values
SELECT DISTINCT source 
FROM candidate_documents
LIMIT 10;
