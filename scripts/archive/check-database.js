// Verify all required Supabase tables and columns exist
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

async function checkDatabase() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('🔍 Checking Supabase Database...\n');

  // Check tables
  const tables = ['candidates', 'inbox_messages', 'inbox_attachments', 'parsing_jobs', 'documents'];
  
  for (const table of tables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`❌ ${table}: MISSING or ERROR - ${error.message}`);
      } else {
        console.log(`✅ ${table}: EXISTS (${count} rows)`);
      }
    } catch (err) {
      console.log(`❌ ${table}: ERROR - ${err.message}`);
    }
  }

  console.log('\n🔍 Checking inbox_attachments columns...\n');
  
  // Check inbox_attachments has required columns
  try {
    const { data: attachments, error } = await supabase
      .from('inbox_attachments')
      .select('id, inbox_message_id, storage_bucket, storage_path, file_name, attachment_type, attachment_kind, document_type, received_at, created_at')
      .limit(1);
    
    if (error) {
      console.log(`❌ Column check failed: ${error.message}`);
    } else {
      console.log('✅ All required columns exist in inbox_attachments');
    }
  } catch (err) {
    console.log(`❌ Column check error: ${err.message}`);
  }

  console.log('\n🔍 Checking parsing_jobs...\n');
  
  // Check parsing jobs
  try {
    const { data: jobs, error } = await supabase
      .from('parsing_jobs')
      .select('id, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.log(`❌ parsing_jobs error: ${error.message}`);
    } else {
      console.log(`✅ parsing_jobs table exists with ${jobs.length} recent jobs:`);
      jobs.forEach(job => {
        console.log(`   - Job ${job.id.substring(0, 8)}: ${job.status} (${job.created_at})`);
      });
    }
  } catch (err) {
    console.log(`❌ parsing_jobs error: ${err.message}`);
  }

  console.log('\n🔍 Checking storage buckets...\n');
  
  // Check storage buckets
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    
    if (error) {
      console.log(`❌ Buckets error: ${error.message}`);
    } else {
      console.log('✅ Storage buckets:');
      buckets.forEach(bucket => {
        console.log(`   - ${bucket.id} (${bucket.public ? 'public' : 'private'})`);
      });
      
      const requiredBuckets = ['inbox', 'documents'];
      const missingBuckets = requiredBuckets.filter(b => !buckets.find(bucket => bucket.id === b));
      
      if (missingBuckets.length > 0) {
        console.log(`\n⚠️  Missing buckets: ${missingBuckets.join(', ')}`);
      } else {
        console.log('\n✅ All required buckets exist');
      }
    }
  } catch (err) {
    console.log(`❌ Buckets error: ${err.message}`);
  }

  console.log('\n✅ Database check complete!\n');
}

checkDatabase().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
