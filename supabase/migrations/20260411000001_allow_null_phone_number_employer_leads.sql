-- Allow phone_number to be NULL in employer_leads
-- Employer portal users may not have a phone number at the time of posting a requirement.
ALTER TABLE public.employer_leads
  ALTER COLUMN phone_number DROP NOT NULL;
