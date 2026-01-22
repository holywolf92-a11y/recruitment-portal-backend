-- 014_cleanup_missing_strings.sql
-- Cleanup script to replace "missing" string values with NULL
-- This fixes the issue where "missing" was stored as actual data instead of NULL

BEGIN;

-- Update candidates table: replace "missing" strings with NULL
UPDATE candidates
SET 
  country_of_interest = NULL
WHERE LOWER(country_of_interest) = 'missing';

UPDATE candidates
SET 
  nationality = NULL
WHERE LOWER(nationality) = 'missing';

UPDATE candidates
SET 
  position = NULL
WHERE LOWER(position) = 'missing';

UPDATE candidates
SET 
  phone = NULL
WHERE LOWER(phone) = 'missing';

UPDATE candidates
SET 
  email = NULL
WHERE LOWER(email) = 'missing';

UPDATE candidates
SET 
  address = NULL
WHERE LOWER(address) = 'missing';

UPDATE candidates
SET 
  father_name = NULL
WHERE LOWER(father_name) = 'missing';

UPDATE candidates
SET 
  marital_status = NULL
WHERE LOWER(marital_status) = 'missing';

-- Note: The following fields are in EXCEL_BROWSER_FIELDS but don't exist in the database yet:
-- religion, salary_expectation, available_from, interview_date, driving_license, gcc_years, medical_expiry
-- If these columns are added in the future, uncomment the corresponding UPDATE statements below

-- UPDATE candidates
-- SET 
--   religion = NULL
-- WHERE LOWER(religion) = 'missing';

-- UPDATE candidates
-- SET 
--   salary_expectation = NULL
-- WHERE LOWER(salary_expectation) = 'missing';

-- UPDATE candidates
-- SET 
--   available_from = NULL
-- WHERE LOWER(available_from) = 'missing';

-- UPDATE candidates
-- SET 
--   interview_date = NULL
-- WHERE LOWER(interview_date) = 'missing';

-- UPDATE candidates
-- SET 
--   driving_license = NULL
-- WHERE LOWER(driving_license) = 'missing';

-- Note: passport_normalized and cnic_normalized are already normalized, 
-- but check just in case
UPDATE candidates
SET 
  passport_normalized = NULL
WHERE LOWER(passport_normalized) = 'missing';

UPDATE candidates
SET 
  cnic_normalized = NULL
WHERE LOWER(cnic_normalized) = 'missing';

-- Recalculate missing_fields for all candidates
-- This will be done by the application after migration, but we can trigger it here
-- Note: The application's updateMissingFields function will handle this automatically

COMMIT;

-- Verification query (run separately to check results)
-- SELECT 
--   candidate_code,
--   name,
--   country_of_interest,
--   nationality,
--   position
-- FROM candidates
-- WHERE 
--   LOWER(country_of_interest) = 'missing' OR
--   LOWER(nationality) = 'missing' OR
--   LOWER(position) = 'missing'
-- LIMIT 10;
