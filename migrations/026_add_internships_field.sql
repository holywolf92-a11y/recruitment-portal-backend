-- 026_add_internships_field.sql
-- Add internships field to candidates table

BEGIN;

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS internships TEXT;

COMMIT;
