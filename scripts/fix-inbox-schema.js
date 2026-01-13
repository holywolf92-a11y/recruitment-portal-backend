// Add missing columns to inbox_attachments via direct query
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('⚠️  Need to add missing columns to inbox_attachments table');
  console.log('\nPlease run this SQL in Supabase dashboard SQL editor:');
  console.log('URL: https://supabase.com/dashboard/project/hncvsextwmvjydcukdwx/sql/new\n');
  
  const sql = `
-- Add missing columns from migration 010
ALTER TABLE inbox_attachments
ADD COLUMN IF NOT EXISTS attachment_kind text DEFAULT 'unknown' CHECK (attachment_kind IN ('cv', 'document', 'unknown')),
ADD COLUMN IF NOT EXISTS document_type text;

CREATE INDEX IF NOT EXISTS idx_inbox_attachments_attachment_kind ON inbox_attachments(attachment_kind);
CREATE INDEX IF NOT EXISTS idx_inbox_attachments_document_type ON inbox_attachments(document_type);

-- Verify
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'inbox_attachments' 
ORDER BY ordinal_position;
`;
  
  console.log(sql);
  console.log('\n✅ After running the SQL, retry uploading CVs in the UI');
}

main();
