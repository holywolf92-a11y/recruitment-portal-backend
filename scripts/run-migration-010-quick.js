// Run migration 010 to add missing attachment_kind and document_type columns
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('Reading migration 010...');
  const migrationPath = path.join(__dirname, '../migrations/010_add_document_linking_support.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('Executing migration...');
  
  // Execute via RPC (Supabase SQL editor)
  const { data, error } = await supabase.rpc('exec_sql', { sql_string: sql }).catch(err => {
    // If RPC doesn't exist, just note it
    return { error: 'RPC not available - need to run migration via Supabase dashboard SQL editor' };
  });

  if (error) {
    console.log('\n⚠️  Cannot run migration directly via API.');
    console.log('Please run migration 010 manually:');
    console.log('\n1. Go to: https://supabase.com/dashboard/project/hncvsextwmvjydcukdwx/sql/new');
    console.log('2. Paste the contents of: backend/migrations/010_add_document_linking_support.sql');
    console.log('3. Click "Run"');
    console.log('\nOr run these quick-fix SQL statements:\n');
    console.log(`
ALTER TABLE inbox_attachments
ADD COLUMN IF NOT EXISTS attachment_kind text DEFAULT 'unknown' CHECK (attachment_kind IN ('cv', 'document', 'unknown')),
ADD COLUMN IF NOT EXISTS document_type text;

CREATE INDEX IF NOT EXISTS idx_inbox_attachments_attachment_kind ON inbox_attachments(attachment_kind);
CREATE INDEX IF NOT EXISTS idx_inbox_attachments_document_type ON inbox_attachments(document_type);
    `.trim());
  } else {
    console.log('✓ Migration executed successfully');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
