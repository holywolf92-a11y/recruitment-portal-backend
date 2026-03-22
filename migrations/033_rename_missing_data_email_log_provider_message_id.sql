DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'candidate_missing_data_email_log'
      AND column_name = 'gmail_thread_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'candidate_missing_data_email_log'
      AND column_name = 'provider_message_id'
  ) THEN
    ALTER TABLE candidate_missing_data_email_log
      RENAME COLUMN gmail_thread_id TO provider_message_id;
  END IF;
END $$;