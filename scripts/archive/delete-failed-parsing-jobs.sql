-- Delete failed parsing jobs for Muhammad Usman and Ahmed Sarfarz
-- so they can be reprocessed with the new date parsing fix

-- Check current status
SELECT 
  id,
  attachment_id,
  status,
  created_at,
  (result_json->>'error') as error
FROM parsing_jobs
WHERE id IN (
  '0ae26a26-6d53-4e30-ab4b-196005fa67d1',  -- Muhammad Usman
  '97901e9f-03d7-413a-ae41-16eda16ebb58'   -- Ahmed Sarfarz
);

-- Delete these jobs so they can be reprocessed
DELETE FROM parsing_jobs
WHERE id IN (
  '0ae26a26-6d53-4e30-ab4b-196005fa67d1',  -- Muhammad Usman
  '97901e9f-03d7-413a-ae41-16eda16ebb58'   -- Ahmed Sarfarz
);

-- Verify deletion
SELECT COUNT(*) as remaining_jobs
FROM parsing_jobs
WHERE id IN (
  '0ae26a26-6d53-4e30-ab4b-196005fa67d1',
  '97901e9f-03d7-413a-ae41-16eda16ebb58'
);
