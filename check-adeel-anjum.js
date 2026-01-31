const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hncvsextwmvjydcukdwx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAdeelAnjum() {
  console.log('\n🔍 Checking Adeel Anjum records in database...\n');

  try {
    // Get all Adeel Anjum records (including deleted)
    const { data, error } = await supabase
      .from('candidates')
      .select('id, name, status, email, cv_received, certificate_received, created_at, updated_at')
      .ilike('name', '%adeel%');

    if (error) {
      console.error('❌ Database error:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      console.log('❌ No Adeel Anjum records found in database');
      process.exit(1);
    }

    console.log(`📋 Found ${data.length} Adeel Anjum record(s):\n`);

    data.forEach((record, index) => {
      const statusColor = record.status === 'Deleted' ? '🗑️ ' : '✅ ';
      console.log(`${index + 1}. ${statusColor}${record.name}`);
      console.log(`   ID: ${record.id}`);
      console.log(`   Status: ${record.status || 'Active'}`);
      console.log(`   Email: ${record.email || 'N/A'}`);
      console.log(`   CV Received: ${record.cv_received ? '✅ YES' : '❌ NO'}`);
      console.log(`   Certificate Received: ${record.certificate_received ? '✅ YES' : '❌ NO'}`);
      console.log(`   Created: ${new Date(record.created_at).toLocaleString()}`);
      console.log(`   Updated: ${new Date(record.updated_at).toLocaleString()}`);
      console.log('');
    });

    // Count by status
    const deleted = data.filter(d => d.status === 'Deleted').length;
    const active = data.filter(d => d.status !== 'Deleted').length;

    console.log(`📊 Summary:`);
    console.log(`   Active records: ${active}`);
    console.log(`   Deleted records: ${deleted}`);
    console.log(`   Total: ${data.length}\n`);

    // Check for issues
    if (deleted > 0 && active > 0) {
      console.log('⚠️  WARNING: Found both active AND deleted records!');
      console.log('   The new fixes should prevent the UI from showing deleted records.');
      const activeRec = data.find(d => d.status !== 'Deleted');
      console.log(`   Active record (should be shown): ${activeRec.email}\n`);
    }

    if (active === 0 && deleted > 0) {
      console.log('ℹ️  All records are deleted. When you re-upload, a new active record should be created.\n');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

checkAdeelAnjum();
