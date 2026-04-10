ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS payment_amount INTEGER NOT NULL DEFAULT 0;

UPDATE candidates
SET payment_amount = 0
WHERE payment_amount IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'candidates_payment_amount_nonnegative'
  ) THEN
    ALTER TABLE candidates
    ADD CONSTRAINT candidates_payment_amount_nonnegative
    CHECK (payment_amount >= 0);
  END IF;
END $$;