const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hncvsextwmvjydcukdwx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAdeelDocuments() {
  console.log('\n📄 Checking Adeel Anjum documents...\n');

  try {
    const { data, error } = await supabase
      .from('candidate_documents')
      .select('id, candidate_id, file_name, category, verification_status, extracted_identity_json, created_at')
      .eq('candidate_id', '4ce1dd93-50ab-4999-9b9e-7a45277e79c9');

    if (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      console.log('ℹ️  No documents found for Adeel Anjum');
      process.exit(0);
    }

    console.log(`📋 Found ${data.length} document(s):\n`);

    data.forEach((doc, index) => {
      const identity = doc.extracted_identity_json || {};
      console.log(`${index + 1}. ${doc.file_name}`);
      console.log(`   Category: ${doc.category}`);
      console.log(`   Status: ${doc.verification_status}`);
      console.log(`   Extracted Email: ${identity.email || 'N/A'}`);
      console.log(`   Created: ${new Date(doc.created_at).toLocaleString()}`);
      console.log('');
    });

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

checkAdeelDocuments();
