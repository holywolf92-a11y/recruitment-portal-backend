-- ============================================================
-- WhatsApp Conversational Bot: state machine + new entity tables
-- ============================================================

-- 1. Add bot state columns to existing whatsapp_conversations
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS bot_flow  text    DEFAULT NULL,   -- menu | candidate_intake | employer_intake | partner_onboarding | jobs | social
  ADD COLUMN IF NOT EXISTS bot_step  text    DEFAULT NULL,   -- step within the active flow
  ADD COLUMN IF NOT EXISTS bot_data  jsonb   DEFAULT '{}';   -- collected field values

-- 2. Employer leads (recruitment requests from companies)
CREATE TABLE IF NOT EXISTS public.employer_leads (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number      text        NOT NULL,
  conversation_id   uuid        REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  country           text,
  professions       text,
  quantity          text,
  salary_range      text,
  contract_duration text,
  benefits_included text,        -- 'yes' | 'no' | unset
  city              text,
  status            text        NOT NULL DEFAULT 'new',   -- new | contacted | closed
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employer_leads_phone    ON public.employer_leads (phone_number);
CREATE INDEX IF NOT EXISTS idx_employer_leads_status   ON public.employer_leads (status);
CREATE INDEX IF NOT EXISTS idx_employer_leads_conv     ON public.employer_leads (conversation_id);

-- 3. Partner applications (agents / sub-agencies)
CREATE TABLE IF NOT EXISTS public.partner_applications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number    text        NOT NULL,
  conversation_id uuid        REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  company_name    text,
  city_country    text,
  partner_type    text,          -- sub_agent | company | overseas_recruiter | other
  email           text,
  status          text        NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_applications_phone  ON public.partner_applications (phone_number);
CREATE INDEX IF NOT EXISTS idx_partner_applications_status ON public.partner_applications (status);
CREATE INDEX IF NOT EXISTS idx_partner_applications_conv   ON public.partner_applications (conversation_id);

-- 4. RLS: allow service role full access (same pattern as other tables)
ALTER TABLE public.employer_leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_employer_leads"       ON public.employer_leads;
DROP POLICY IF EXISTS "service_role_partner_applications" ON public.partner_applications;

CREATE POLICY "service_role_employer_leads"
  ON public.employer_leads FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_partner_applications"
  ON public.partner_applications FOR ALL TO service_role USING (true) WITH CHECK (true);
