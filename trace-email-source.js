const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hncvsextwmvjydcukdwx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const supabase = createClient(supabaseUrl, supabaseKey);

async function traceEmailSource() {
  console.log('\n🔍 Tracing email source for Adeel Anjum...\n');

  try {
    // Get ALL documents (including from inbox_attachments which is CV inbox)
    const { data: docs, error: docsError } = await supabase
      .from('candidate_documents')
      .select('id, file_name, category, extracted_identity_json, created_at, verification_status')
      .eq('candidate_id', '4ce1dd93-50ab-4999-9b9e-7a45277e79c9')
      .order('created_at', { ascending: true });

    if (docsError) {
      console.error('❌ Error fetching documents:', docsError.message);
      process.exit(1);
    }

    console.log(`📋 Found ${docs?.length || 0} documents (ordered by upload time):\n`);

    if (docs) {
      docs.forEach((doc, index) => {
        const identity = doc.extracted_identity_json || {};
        const hasEmail = identity.email ? '📧' : '  ';
        console.log(`${index + 1}. ${hasEmail} ${doc.file_name}`);
        console.log(`   Category: ${doc.category}`);
        console.log(`   Status: ${doc.verification_status}`);
        console.log(`   Email extracted: ${identity.email || 'N/A'}`);
        console.log(`   Created: ${new Date(doc.created_at).toLocaleString()}`);
        console.log('');
      });
    }

    // Check inbox_attachments (CV inbox uploads)
    const { data: inboxDocs, error: inboxError } = await supabase
      .from('inbox_attachments')
      .select('id, file_name, attachment_kind, extracted_data, created_at')
      .eq('candidate_id', '4ce1dd93-50ab-4999-9b9e-7a45277e79c9')
      .order('created_at', { ascending: true });

    if (inboxDocs && inboxDocs.length > 0) {
      console.log(`\n📥 CV Inbox uploads (${inboxDocs.length}):\n`);
      inboxDocs.forEach((doc, index) => {
        const data = doc.extracted_data || {};
        const hasEmail = data.email ? '📧' : '  ';
        console.log(`${index + 1}. ${hasEmail} ${doc.file_name}`);
        console.log(`   Type: ${doc.attachment_kind}`);
        console.log(`   Email: ${data.email || 'N/A'}`);
        console.log(`   Created: ${new Date(doc.created_at).toLocaleString()}`);
        console.log('');
      });
    }

    // Get candidate creation/update history
    const { data: candidate } = await supabase
      .from('candidates')
      .select('email, created_at, updated_at, field_sources')
      .eq('id', '4ce1dd93-50ab-4999-9b9e-7a45277e79c9')
      .single();

    if (candidate) {
      console.log(`\n👤 Candidate Record:\n`);
      console.log(`   Email: ${candidate.email}`);
      console.log(`   Created: ${new Date(candidate.created_at).toLocaleString()}`);
      console.log(`   Updated: ${new Date(candidate.updated_at).toLocaleString()}`);
      
      if (candidate.field_sources && candidate.field_sources.email) {
        console.log(`   Email source: ${JSON.stringify(candidate.field_sources.email, null, 2)}`);
      } else {
        console.log(`   Email source: NOT TRACKED (set before field tracking was implemented)`);
      }
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

traceEmailSource();
