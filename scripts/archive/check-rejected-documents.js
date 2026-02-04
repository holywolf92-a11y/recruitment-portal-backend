/**
 * Quick Test Script - Check for Rejected Documents
 * Run: node scripts/check-rejected-documents.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkRejectedDocuments() {
  console.log('\n🔍 Checking for Rejected Documents...\n');
  
  // Check for rejected documents
  const { data: rejectedDocs, error } = await supabase
    .from('candidate_documents')
    .select('id, file_name, verification_status, rejection_code, candidate_id, created_at')
    .in('verification_status', ['rejected_mismatch', 'failed'])
    .limit(10);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`📊 Found ${rejectedDocs?.length || 0} rejected documents:\n`);
  
  if (rejectedDocs && rejectedDocs.length > 0) {
    rejectedDocs.forEach((doc, index) => {
      console.log(`${index + 1}. ${doc.file_name || 'Unknown'}`);
      console.log(`   Status: ${doc.verification_status}`);
      console.log(`   Rejection Code: ${doc.rejection_code || 'N/A'}`);
      console.log(`   Document ID: ${doc.id}`);
      console.log(`   Candidate ID: ${doc.candidate_id}`);
      console.log(`   Created: ${doc.created_at}`);
      console.log('');
    });
    
    console.log('✅ These documents can be used for testing admin override!\n');
  } else {
    console.log('⚠️  No rejected documents found.');
    console.log('💡 To test: Upload a wrong passport/document to trigger rejection.\n');
  }

  // Check for overridden documents
  const { data: overriddenDocs } = await supabase
    .from('candidate_documents')
    .select('id, file_name, verification_source, overridden_by, overridden_at')
    .eq('verification_source', 'admin_override')
    .limit(5);

  console.log(`📊 Found ${overriddenDocs?.length || 0} overridden documents:\n`);
  
  if (overriddenDocs && overriddenDocs.length > 0) {
    overriddenDocs.forEach((doc, index) => {
      console.log(`${index + 1}. ${doc.file_name || 'Unknown'}`);
      console.log(`   Overridden By: ${doc.overridden_by || 'N/A'}`);
      console.log(`   Overridden At: ${doc.overridden_at || 'N/A'}`);
      console.log('');
    });
  } else {
    console.log('⚠️  No overridden documents found yet.');
    console.log('💡 Override a rejected document to test the badge feature.\n');
  }
}

checkRejectedDocuments().catch(console.error);
