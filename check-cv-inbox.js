const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hncvsextwmvjydcukdwx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCVInbox() {
  console.log('\n🔍 Checking CV Inbox for Adeel Anjum...\n');

  try {
    // Check inbox_attachments for Adeel
    const { data: inboxDocs, error } = await supabase
      .from('inbox_attachments')
      .select('*')
      .eq('candidate_id', '4ce1dd93-50ab-4999-9b9e-7a45277e79c9')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }

    if (!inboxDocs || inboxDocs.length === 0) {
      console.log('❌ No CV inbox records found for Adeel Anjum');
      process.exit(0);
    }

    console.log(`📥 Found ${inboxDocs.length} CV inbox record(s):\n`);

    inboxDocs.forEach((doc, index) => {
      const extractedData = doc.extracted_data || {};
      console.log(`${index + 1}. ${doc.file_name || doc.name}`);
      console.log(`   Candidate ID: ${doc.candidate_id || 'N/A'}`);
      console.log(`   Name extracted: ${extractedData.name || doc.name || 'N/A'}`);
      console.log(`   Email extracted: ${extractedData.email || 'N/A'}`);
      console.log(`   Phone: ${extractedData.phone || 'N/A'}`);
      console.log(`   Created: ${new Date(doc.created_at).toLocaleString()}`);
      console.log(`   Status: ${doc.status || 'N/A'}`);
      console.log('');
    });

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

checkCVInbox();
