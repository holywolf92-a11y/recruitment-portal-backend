/**
 * Direct test to check if we can insert with source='web'
 * Bypasses the backend API to test database constraint directly
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qwlywvutjrtqkayrtukm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bHl3dnV0anJ0cWtheXJ0dWttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNTg0OTk0NywiZXhwIjoyMDUxNDI1OTQ3fQ.xeXP_OdAPyVrMw8UbP1nGF_-FxTe7EWBhxgjVH6snKA';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testDirectInsert() {
  console.log('🧪 Testing direct database insert with source=web\n');

  try {
    // Get a test candidate
    const { data: candidates } = await supabase
      .from('candidates')
      .select('id, full_name')
      .limit(1);

    if (!candidates || candidates.length === 0) {
      console.log('❌ No candidates found in database');
      return;
    }

    const testCandidate = candidates[0];
    console.log(`✅ Found test candidate: ${testCandidate.full_name} (${testCandidate.id})\n`);

    // Try to insert a test document record
    console.log('Attempting insert with source="web"...');
    
    const testDoc = {
      candidate_id: testCandidate.id,
      document_type: 'other',
      storage_bucket: 'documents',
      storage_path: 'test/constraint-test-' + Date.now() + '.txt',
      file_name: 'constraint-test.txt',
      mime_type: 'text/plain',
      source: 'web',
      status: 'received',
      verification_status: 'pending_ai'
    };

    const { data, error } = await supabase
      .from('candidate_documents')
      .insert(testDoc)
      .select();

    if (error) {
      console.log('❌ INSERT FAILED:');
      console.log('Error:', error.message);
      console.log('Code:', error.code);
      console.log('\n📋 The constraint is still blocking "web" value.');
      console.log('Please run this in Supabase SQL Editor:\n');
      console.log('ALTER TABLE candidate_documents DROP CONSTRAINT candidate_documents_source_check;');
      console.log('ALTER TABLE candidate_documents ADD CONSTRAINT candidate_documents_source_check');
      console.log("  CHECK (source IN ('gmail', 'whatsapp', 'web', 'manual', 'api', 'email'));\n");
    } else {
      console.log('✅ INSERT SUCCESSFUL!');
      console.log('Document ID:', data[0].id);
      console.log('\nThe constraint now allows "web" value. ');
      console.log('Railway backend should work after redeployment.\n');

      // Clean up test record
      await supabase
        .from('candidate_documents')
        .delete()
        .eq('id', data[0].id);
      
      console.log('Test record cleaned up.\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testDirectInsert();
