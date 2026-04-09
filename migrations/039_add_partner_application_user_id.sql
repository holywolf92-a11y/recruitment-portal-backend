ALTER TABLE partner_applications
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partner_applications_user_id
ON partner_applications(user_id)
WHERE user_id IS NOT NULL;

UPDATE partner_applications AS pa
SET user_id = u.id,
    updated_at = NOW()
FROM users AS u
WHERE pa.user_id IS NULL
  AND pa.email IS NOT NULL
  AND LOWER(pa.email) = LOWER(u.email);

UPDATE partner_applications AS pa
SET user_id = u.id,
    updated_at = NOW()
FROM users AS u
WHERE pa.user_id IS NULL
  AND pa.phone_number IS NOT NULL
  AND u.phone IS NOT NULL
  AND pa.phone_number = u.phone;

COMMENT ON COLUMN partner_applications.user_id IS 'Supabase auth/app user linked to this partner application for portal self-service updates';