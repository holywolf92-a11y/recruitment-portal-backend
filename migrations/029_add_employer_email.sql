-- 029_add_employer_email.sql
-- Add email field for employers (primary contact)

ALTER TABLE employers
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Optional: enforce unique emails when provided
CREATE UNIQUE INDEX IF NOT EXISTS uq_employers_email
ON employers(email)
WHERE email IS NOT NULL;
