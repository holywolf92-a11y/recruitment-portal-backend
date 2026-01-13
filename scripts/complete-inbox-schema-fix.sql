-- Complete schema fix for inbox_attachments
-- Add all missing columns from migrations 009 and 010

ALTER TABLE inbox_attachments
ADD COLUMN IF NOT EXISTS attachment_kind text DEFAULT 'unknown' CHECK (attachment_kind IN ('cv', 'document', 'unknown')),
ADD COLUMN IF NOT EXISTS document_type text,
ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_inbox_attachments_attachment_kind ON inbox_attachments(attachment_kind);
CREATE INDEX IF NOT EXISTS idx_inbox_attachments_document_type ON inbox_attachments(document_type);
CREATE INDEX IF NOT EXISTS idx_inbox_attachments_received_at ON inbox_attachments(received_at);

-- Verify all columns exist
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'inbox_attachments' 
ORDER BY ordinal_position;
