ALTER TABLE public.employer_leads
ADD COLUMN IF NOT EXISTS company_name TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS duty_hours TEXT,
ADD COLUMN IF NOT EXISTS comments TEXT,
ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.partner_applications
ADD COLUMN IF NOT EXISTS applicant_name TEXT,
ADD COLUMN IF NOT EXISTS district TEXT,
ADD COLUMN IF NOT EXISTS cnic TEXT,
ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.whatsapp_form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  conversation_id UUID REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  flow_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  submission_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_form_submissions_phone ON public.whatsapp_form_submissions(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_form_submissions_flow ON public.whatsapp_form_submissions(flow_type);
CREATE INDEX IF NOT EXISTS idx_whatsapp_form_submissions_entity ON public.whatsapp_form_submissions(entity_type, entity_id);

ALTER TABLE public.whatsapp_form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_whatsapp_form_submissions" ON public.whatsapp_form_submissions;

CREATE POLICY "service_role_whatsapp_form_submissions"
  ON public.whatsapp_form_submissions FOR ALL TO service_role USING (true) WITH CHECK (true);