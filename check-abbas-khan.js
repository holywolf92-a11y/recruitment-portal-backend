const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAbbasKhan() {
  console.log('🔍 Checking Abbas Khan (FL-2026-886) data...\n');

  const { data, error } = await supabase
    .from('candidates')
    .select('id, candidate_code, name, education, certifications, internships, previous_employment, experience_years')
    .eq('candidate_code', 'FL-2026-886')
    .single();

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('📊 Current Database Values:');
  console.log('─'.repeat(60));
  console.log('ID:', data.id);
  console.log('Code:', data.candidate_code);
  console.log('Name:', data.name);
  console.log('Education:', data.education);
  console.log('Certifications:', data.certifications);
  console.log('Internships:', data.internships);
  console.log('Previous Employment:', data.previous_employment);
  console.log('Experience Years:', data.experience_years);
  console.log('\n');

  // Check for documents
  const { data: docs } = await supabase
    .from('documents')
    .select('id, original_filename, category, storage_path')
    .eq('candidate_id', data.id)
    .eq('category', 'cv')
    .order('created_at', { ascending: false })
    .limit(1);

  if (docs && docs.length > 0) {
    console.log('📄 Latest CV Document:');
    console.log('─'.repeat(60));
    console.log('Document ID:', docs[0].id);
    console.log('Filename:', docs[0].original_filename);
    console.log('Storage Path:', docs[0].storage_path);
    console.log('\n');
    console.log('💡 To reprocess this CV with new internships logic:');
    console.log('   Trigger CV parsing job for document:', docs[0].id);
  } else {
    console.log('⚠️  No CV document found for this candidate');
  }
}

checkAbbasKhan();
