// Create Supabase storage bucket remotely using service role
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

async function createBucket() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('Creating documents bucket...');
  
  // Create the bucket
  const { data: bucket, error } = await supabase.storage.createBucket('documents', {
    public: false,
    fileSizeLimit: 52428800, // 50MB
  });

  if (error) {
    if (error.message.includes('already exists')) {
      console.log('✓ Bucket already exists');
    } else {
      console.error('Error creating bucket:', error);
      process.exit(1);
    }
  } else {
    console.log('✓ Bucket created successfully');
  }

  // Verify bucket exists
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error('Error listing buckets:', listError);
  } else {
    const docBucket = buckets.find(b => b.id === 'documents');
    if (docBucket) {
      console.log('✓ Bucket verified:', docBucket);
    }
  }

  // Test upload
  console.log('\nTesting upload...');
  const testContent = Buffer.from('test');
  const testPath = `health/${Date.now()}_test.txt`;
  
  const { data: upload, error: uploadError } = await supabase.storage
    .from('documents')
    .upload(testPath, testContent, {
      contentType: 'text/plain',
      upsert: true
    });

  if (uploadError) {
    console.error('✗ Upload test failed:', uploadError);
  } else {
    console.log('✓ Upload test successful:', upload);
  }

  console.log('\n✅ All done!');
}

createBucket().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
