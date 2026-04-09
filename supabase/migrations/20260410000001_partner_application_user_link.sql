ALTER TABLE public.partner_applications
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partner_applications_user_id
ON public.partner_applications(user_id)
WHERE user_id IS NOT NULL;

UPDATE public.partner_applications AS pa
SET user_id = u.id,
    updated_at = NOW()
FROM public.users AS u
WHERE pa.user_id IS NULL
  AND pa.email IS NOT NULL
  AND LOWER(pa.email) = LOWER(u.email);

UPDATE public.partner_applications AS pa
SET user_id = u.id,
    updated_at = NOW()
FROM public.users AS u
WHERE pa.user_id IS NULL
  AND pa.phone_number IS NOT NULL
  AND u.phone IS NOT NULL
  AND pa.phone_number = u.phone;

COMMENT ON COLUMN public.partner_applications.user_id IS 'Supabase auth/app user linked to this partner application for portal self-service updates';