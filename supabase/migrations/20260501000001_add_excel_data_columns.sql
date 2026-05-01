-- Migration: add excel data columns to candidates table
-- Adds the 7 fields visible in Excel Browser that were missing from the DB

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS religion            text,
  ADD COLUMN IF NOT EXISTS salary_expectation  text,
  ADD COLUMN IF NOT EXISTS date_available      date,
  ADD COLUMN IF NOT EXISTS interview_date      date,
  ADD COLUMN IF NOT EXISTS medical_expiry      date,
  ADD COLUMN IF NOT EXISTS license             text,
  ADD COLUMN IF NOT EXISTS gcc_years           integer;
