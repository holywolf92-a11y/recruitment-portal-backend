/**
 * Check where Hamna's CV is stored
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const CANDIDATE_ID = '40d44087-ca8f-4db8-a2ce-43d329efc8cb';

async function checkHamnaCV() {
  console.log('\n🔍 Checking Where Hamna\'s CV is Stored');
  console.log('========================================\n');

  try {
    // 1. Check candidate_documents
    console.log('1. Checking candidate_documents table...');
    const { data: candidateDocs, error: cdError } = await supabase
      .from('candidate_documents')
      .select('*')
      .eq('candidate_id', CANDIDATE_ID);

    if (cdError) {
      console.error('   Error:', cdError.message);
    } else {
      console.log(`   Found ${candidateDocs?.length || 0} documents`);
      candidateDocs?.forEach(doc => {
        console.log(`   - ${doc.file_name} (${doc.category}) - ${doc.verification_status}`);
      });
    }

    // 2. Check inbox_attachments
    console.log('\n2. Checking inbox_attachments table...');
    const { data: inboxAtts, error: iaError } = await supabase
      .from('inbox_attachments')
      .select('*')
      .or(`candidate_id.eq.${CANDIDATE_ID},linked_candidate_id.eq.${CANDIDATE_ID}`);

    if (iaError) {
      console.error('   Error:', iaError.message);
    } else {
      console.log(`   Found ${inboxAtts?.length || 0} attachments`);
      inboxAtts?.forEach(att => {
        console.log(`   - ${att.file_name} (${att.attachment_type}) - candidate_id: ${att.candidate_id}, linked: ${att.linked_candidate_id}`);
      });
    }

    // 3. Check old documents table
    console.log('\n3. Checking documents table (legacy)...');
    const { data: oldDocs, error: odError } = await supabase
      .from('documents')
      .select('*')
      .eq('candidate_id', CANDIDATE_ID)
      .is('deleted_at', null);

    if (odError) {
      console.error('   Error:', odError.message);
    } else {
      console.log(`   Found ${oldDocs?.length || 0} documents`);
      oldDocs?.forEach(doc => {
        console.log(`   - ${doc.file_name} (${doc.doc_type})`);
      });
    }

    // 4. Check candidate flags
    console.log('\n4. Current candidate flags...');
    const { data: candidate, error: cError } = await supabase
      .from('candidates')
      .select('id, name, cv_received, passport_received, certificate_received')
      .eq('id', CANDIDATE_ID)
      .single();

    if (cError) {
      console.error('   Error:', cError.message);
    } else {
      console.log(`   Name: ${candidate.name}`);
      console.log(`   CV Received: ${candidate.cv_received}`);
      console.log(`   Passport Received: ${candidate.passport_received}`);
      console.log(`   Certificate Received: ${candidate.certificate_received}`);
    }

    console.log('\n✅ Check complete!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

checkHamnaCV();
