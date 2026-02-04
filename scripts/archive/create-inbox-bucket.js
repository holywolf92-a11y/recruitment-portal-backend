// Create Supabase 'inbox' storage bucket
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('Creating inbox bucket...');
  
  const { data: bucket, error } = await supabase.storage.createBucket('inbox', {
    public: false,
    fileSizeLimit: 52428800, // 50MB
  });

  if (error) {
    if (error.message.includes('already exists')) {
      console.log('✓ inbox bucket already exists');
    } else {
      console.error('✗ Error creating inbox bucket:', error);
      process.exit(1);
    }
  } else {
    console.log('✓ inbox bucket created successfully');
  }

  // Verify
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error('Error listing buckets:', listError);
  } else {
    console.log('\n✓ Current buckets:', buckets.map(b => b.id).join(', '));
  }

  console.log('\n✅ Done');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
